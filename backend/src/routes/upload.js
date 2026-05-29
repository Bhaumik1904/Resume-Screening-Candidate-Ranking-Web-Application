const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { createJob, createCandidate } = require('../db/queries');
const { extractText, extractCandidateName } = require('../services/fileParser');

const router = express.Router();

// ─── Multer Storage Config ─────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
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
//   - resumes: File[] (PDF/DOC/DOCX)
//   - jobTitle: string (optional)
//   - jobDescription: string (JD text)
//   - jdFile: File (optional, instead of jobDescription text)
router.post('/', upload.fields([{ name: 'resumes', maxCount: 20 }, { name: 'jdFile', maxCount: 1 }]),
  async (req, res) => {
    try {
      const { jobTitle, jobDescription } = req.body;
      const resumeFiles = req.files?.resumes || [];
      const jdFiles = req.files?.jdFile || [];

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

      // Parse and store each resume
      const candidateRecords = [];
      const errors = [];

      for (const file of resumeFiles) {
        try {
          const rawText = await extractText(file.path, file.mimetype);
          const name = extractCandidateName(rawText);

          const candidate = await createCandidate({
            jobId: job.id,
            name,
            email: null,
            fileName: file.originalname,
            filePath: file.path,
            fileType: path.extname(file.originalname).toLowerCase().replace('.', ''),
            rawText,
          });

          candidateRecords.push({
            candidateId: candidate.id,
            name: candidate.name,
            fileName: file.originalname,
          });
        } catch (parseErr) {
          errors.push({ file: file.originalname, error: parseErr.message });
        }
      }

      res.status(201).json({
        jobId: job.id,
        jobTitle: job.title,
        candidatesUploaded: candidateRecords.length,
        candidates: candidateRecords,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully uploaded ${candidateRecords.length} resume(s). Ready to analyze.`,
      });
    } catch (err) {
      console.error('[Upload Route] Error:', err);
      res.status(500).json({ error: 'Upload failed. Please try again.', details: err.message });
    }
  }
);

module.exports = router;
