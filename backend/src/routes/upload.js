const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createJob, createCandidate } = require('../db/queries');
const { extractText, extractCandidateName } = require('../services/fileParser');

const router = express.Router();

// ─── Multer Storage Config ─────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, unique);
  },
});

const fileFilter = (_req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  const allowedExt = ['.pdf', '.doc', '.docx', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Only PDF, DOC, DOCX, TXT allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 }, // 10MB per file, max 20 files
});

// ─── POST /api/upload ─────────────────────────────────────────────────────────
// Accepts: multipart/form-data with:
//   - resumes: File[] (PDF/DOC/DOCX/TXT)
//   - jobTitle: string (optional)
//   - jobDescription: string (JD text)
//   - jdFile: File (optional, instead of jobDescription text)
//
// Strategy: Store ALL candidates immediately with whatever text we can extract
// synchronously (pdf-parse for text-based PDFs, full text for DOCX/TXT).
// Image-based PDFs that return no text are stored with raw_text = '' and
// will be OCR-processed by Gemini Vision during the analyze step instead.
// This prevents upload failures caused by Gemini Vision rate limits.
router.post('/', upload.fields([{ name: 'resumes', maxCount: 20 }, { name: 'jdFile', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { jobTitle, jobDescription } = req.body;
      const resumeFiles = req.files?.resumes || [];
      const jdFiles    = req.files?.jdFile   || [];

      // Resolve JD text from text field or uploaded file
      let jdText = jobDescription || '';
      if (jdFiles.length > 0 && !jdText) {
        jdText = await extractText(jdFiles[0].path, jdFiles[0].mimetype);
      }

      if (!jdText || jdText.trim().length < 20) {
        return res.status(400).json({ error: 'Job description is required (min 20 characters).' });
      }

      if (resumeFiles.length === 0) {
        return res.status(400).json({ error: 'At least one resume file is required.' });
      }

      // Create the job record
      const job = await createJob(jobTitle || 'Untitled Position', jdText.trim());

      const candidateRecords = [];

      for (const file of resumeFiles) {
        // Try fast text extraction (pdf-parse / mammoth / fs.readFile).
        // Skip Gemini Vision here — it will be called during the analyze step
        // where we have proper rate-limit handling (sequential + retry).
        let rawText = '';
        let name    = 'Unknown Candidate';

        try {
          rawText = await extractTextFast(file.path, file.mimetype);
          name    = extractCandidateName(rawText);
        } catch (parseErr) {
          // Image-based PDF — stored with empty raw_text, Vision OCR deferred to analyze
          console.warn(`[Upload] Could not extract text from "${file.originalname}" synchronously. Will use Vision OCR during analysis.`);
        }

        // Always create the candidate record regardless of whether text was extracted
        const candidate = await createCandidate({
          jobId:    job.id,
          name,
          email:    null,
          fileName: file.originalname,
          filePath: file.path,
          fileType: path.extname(file.originalname).toLowerCase().replace('.', ''),
          rawText,
        });

        candidateRecords.push({
          candidateId: candidate.id,
          name:        candidate.name,
          fileName:    file.originalname,
          hasText:     rawText.length > 50,
        });

        console.log(`[Upload] Stored "${file.originalname}" → candidate ${candidate.id} (${rawText.length} chars)`);
      }

      res.status(201).json({
        jobId:               job.id,
        jobTitle:            job.title,
        candidatesUploaded:  candidateRecords.length,
        candidates:          candidateRecords,
        message: `Successfully uploaded ${candidateRecords.length} resume(s). Ready to analyze.`,
      });
    } catch (err) {
      console.error('[Upload Route] Error:', err);
      res.status(500).json({ error: 'Upload failed. Please try again.', details: err.message });
    }
  }
);

module.exports = router;


// ─── Fast (non-Gemini) text extraction ────────────────────────────────────────
// Only uses pdf-parse, mammoth, and fs — no API calls, never throws on image PDFs.
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const MIN_TEXT = 100; // chars below this = image-based PDF, skip

const extractTextFast = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || mimeType === 'text/plain') {
    return fs.readFileSync(filePath, 'utf-8').replace(/\s\s+/g, ' ').trim();
  }

  if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.doc'  ||
    mimeType === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ path: filePath });
    return (result.value || '').replace(/\s\s+/g, ' ').trim();
  }

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const buf  = fs.readFileSync(filePath);
    const data = await pdfParse(buf);
    const text = (data.text || '').trim();

    if (text.length < MIN_TEXT) {
      // Image-based PDF — signal to the caller to defer Vision OCR to analyze step
      throw new Error('image-based PDF');
    }
    return text.replace(/\s\s+/g, ' ').trim();
  }

  throw new Error(`Unsupported file type: ${ext}`);
};
