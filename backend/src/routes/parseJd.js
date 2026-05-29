const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { extractText } = require('../services/fileParser');

const router = express.Router();

// ─── Multer Storage Config ─────────────────────────────────────────────────────
const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const fileFilter = (_req, file, cb) => {
  const allowedExt = ['.pdf', '.doc', '.docx', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExt.includes(ext)) cb(null, true);
  else cb(new Error(`Unsupported file type: ${ext}. Only PDF, DOCX, TXT allowed.`), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// ─── POST /api/parse-jd ───────────────────────────────────────────────────────
// Accepts a single JD file, extracts the text, returns it for preview.
// The file is deleted from disk after parsing (no persistence needed).
router.post('/', upload.single('jdFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;

  try {
    const text = await extractText(filePath, req.file.mimetype);

    if (!text || text.trim().length < 20) {
      return res.status(422).json({
        error: 'Could not extract readable text from this file. Please try a different format.',
      });
    }

    res.json({
      filename: req.file.originalname,
      text: text.trim(),
      chars: text.trim().length,
    });
  } catch (err) {
    res.status(422).json({ error: err.message || 'Failed to parse the JD file.' });
  } finally {
    // Always delete the temp file
    fs.unlink(filePath, () => {});
  }
});

module.exports = router;
