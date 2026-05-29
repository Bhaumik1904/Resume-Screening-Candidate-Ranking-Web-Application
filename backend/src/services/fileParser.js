const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extract raw text from a resume file (PDF, DOC, DOCX)
 * @param {string} filePath - Absolute path to the file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} Extracted text content
 */
const extractText = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let rawText = '';
    if (ext === '.pdf' || mimeType === 'application/pdf') {
      rawText = await parsePDF(filePath);
    } else if (
      ext === '.docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.doc' || mimeType === 'application/msword'
    ) {
      rawText = await parseDOCX(filePath);
    } else if (ext === '.txt' || mimeType === 'text/plain') {
      rawText = fs.readFileSync(filePath, 'utf-8');
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    // Normalize whitespace (remove multiple empty lines and spaces) to help AI analysis
    return rawText.replace(/\s\s+/g, ' ').trim();
  } catch (err) {
    console.error(`[FileParser] Failed to parse ${filePath}:`, err.message);
    throw new Error(`Could not extract text from file: ${err.message}`);
  }
};

/**
 * Parse a PDF file and extract its text
 */
const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return (data.text || '').trim();
};

/**
 * Parse a DOCX (or DOC) file and extract its text
 */
const parseDOCX = async (filePath) => {
  const result = await mammoth.extractRawText({ path: filePath });
  if (result.messages && result.messages.length > 0) {
    result.messages.forEach((m) => {
      if (m.type === 'warning') console.warn(`[FileParser] mammoth warning: ${m.message}`);
    });
  }
  return (result.value || '').trim();
};

/**
 * Try to extract the candidate's name from raw text
 * Uses heuristic: first non-empty line that looks like a name
 */
const extractCandidateName = (rawText) => {
  if (!rawText) return 'Unknown Candidate';

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines.slice(0, 8)) {
    // A name line: 2-4 words, mostly alpha characters, no special chars
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
