const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extract raw text from a resume file (PDF, DOC, DOCX, TXT).
 * For image-based PDFs, returns an empty string — the analyze route
 * will handle those with combined Vision OCR + scoring in one Gemini call.
 */
const extractText = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      return await parsePDF(filePath);
    }
    if (
      ext === '.docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.doc' ||
      mimeType === 'application/msword'
    ) {
      return await parseDOCX(filePath);
    }
    if (ext === '.txt' || mimeType === 'text/plain') {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
    throw new Error(`Unsupported file type: ${ext}`);
  } catch (err) {
    console.error(`[FileParser] Failed to parse ${path.basename(filePath)}:`, err.message);
    return ''; // Return empty string; let the analyze phase handle it with Vision
  }
};

/**
 * Parse a text-based PDF file and extract its text content
 */
const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  const text = (data.text || '').replace(/\s\s+/g, ' ').trim();
  return text;
};

/**
 * Parse a DOCX (or DOC) file and extract its text
 */
const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  return (result.value || '').replace(/\s\s+/g, ' ').trim();
};

/**
 * Try to extract the candidate's name from raw text using heuristics.
 */
const extractCandidateName = (rawText) => {
  if (!rawText) return 'Unknown Candidate';

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines.slice(0, 10)) {
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
