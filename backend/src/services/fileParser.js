const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Minimum characters before we consider a PDF as image-based (no text layer)
const MIN_TEXT_LENGTH = 80;

/**
 * Extract raw text from a resume file (PDF, DOC, DOCX, TXT).
 * For image-based PDFs, returns an empty string — the analyze route will
 * handle OCR+scoring in a single combined Gemini Vision call instead.
 * @param {string} filePath - Absolute path to the file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} Extracted text content (empty string for image PDFs)
 */
const extractText = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let rawText = '';

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      rawText = await parsePDF(filePath);
      // If too little text, signal to the analyzer to use Vision OCR instead
      if (rawText.length < MIN_TEXT_LENGTH) {
        console.log(`[FileParser] Image-based PDF detected (${rawText.length} chars). Vision OCR will handle it during analysis.`);
        return ''; // Empty string triggers vision path in analyze route
      }
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

    // Normalize whitespace to help AI analysis
    return rawText.replace(/\s\s+/g, ' ').trim();
  } catch (err) {
    console.error(`[FileParser] Failed to parse ${path.basename(filePath)}:`, err.message);
    throw new Error(err.message || `Could not extract text from file.`);
  }
};

/**
 * Parse a text-based PDF file using pdf-parse
 */
const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return (data.text || '').trim();
};

/**
 * Parse a DOCX (or DOC) file and extract its text using mammoth
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
