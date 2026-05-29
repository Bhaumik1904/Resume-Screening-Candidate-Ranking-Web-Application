const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Minimum characters before we consider a PDF as image-based (no text layer)
const MIN_TEXT_LENGTH = 80;

/**
 * Extract raw text from a resume file (PDF, DOC, DOCX, TXT)
 * For image-based PDFs (JPG/PNG converted to PDF), falls back to Gemini Vision OCR.
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

      // If almost no text was extracted, this is likely an image-based PDF
      if (rawText.length < MIN_TEXT_LENGTH) {
        console.log(`[FileParser] PDF appears to be image-based (extracted ${rawText.length} chars). Attempting Gemini Vision OCR...`);
        rawText = await ocrWithGemini(filePath, 'application/pdf');
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

    if (!rawText || rawText.trim().length < 20) {
      throw new Error('Could not extract readable text from this file. Please upload a text-based PDF or DOCX instead of an image.');
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
 * OCR fallback using Gemini Vision for image-based PDFs (JPG/PNG converted to PDF)
 * Sends the file as base64 to Gemini and asks it to extract all resume text.
 * @param {string} filePath - Absolute path to the file
 * @param {string} mimeType - MIME type to send to Gemini
 * @returns {Promise<string>} Extracted text from the image
 */
const ocrWithGemini = async (filePath, mimeType) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set. Cannot perform OCR on image-based PDF.');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const result = await model.generateContent([
    {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    },
    `This is a resume document. Please extract ALL text from it exactly as it appears.
Include: candidate name, contact info, all job titles, company names, dates, skills, education, certifications, and any other text.
Format it clearly with line breaks between sections.
Output ONLY the extracted text — no commentary, no formatting instructions, just the raw resume content.`,
  ]);

  const extracted = result.response.text().trim();
  console.log(`[FileParser] Gemini Vision OCR extracted ${extracted.length} characters.`);
  return extracted;
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
