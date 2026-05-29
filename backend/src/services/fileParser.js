const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Minimum chars to consider a PDF as text-based
const MIN_TEXT_LENGTH = 80;

/**
 * Extract raw text from a resume file (PDF, DOCX, DOC, TXT).
 * NOTE: Image-based PDFs (scanned / JPG-to-PDF) are NOT supported.
 *       Please upload text-based PDFs or DOCX files.
 * @param {string} filePath - Absolute path to the file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} Extracted text content
 */
const extractText = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  let rawText = '';

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    rawText = await parsePDF(filePath);
    if (rawText.length < MIN_TEXT_LENGTH) {
      throw new Error(
        'This PDF appears to be image-based or scanned (no readable text found). ' +
        'Please upload a text-based PDF or DOCX file instead.'
      );
    }
  } else if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.doc' ||
    mimeType === 'application/msword'
  ) {
    rawText = await parseDOCX(filePath);
  } else if (ext === '.txt' || mimeType === 'text/plain') {
    rawText = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error(`Unsupported file type: ${ext}. Please upload PDF, DOCX, or TXT.`);
  }

  if (!rawText || rawText.trim().length < 20) {
    throw new Error('Could not extract readable text from this file. Please try a different format.');
  }

  return rawText.replace(/\s\s+/g, ' ').trim();
};

const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return (data.text || '').trim();
};

const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value || '').trim();
};

/**
 * Heuristically extract candidate name from the first few lines of resume text.
 */
const extractCandidateName = (rawText) => {
  if (!rawText) return 'Unknown Candidate';

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines.slice(0, 8)) {
    const words = line.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 5 &&
      /^[A-Za-z\s.\-']+$/.test(line) &&
      line.length < 60
    ) {
      return line;
    }
  }

  return lines[0]?.substring(0, 60) || 'Unknown Candidate';
};

module.exports = { extractText, extractCandidateName };
