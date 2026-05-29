const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Minimum characters to consider a PDF "text-based" vs image-based
const MIN_TEXT_LENGTH = 100;

/**
 * Extract raw text from a resume file (PDF, DOC, DOCX, TXT)
 * For image-based PDFs (scanned/rendered), falls back to Gemini Vision OCR.
 */
const extractText = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let rawText = '';

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      rawText = await parsePDF(filePath);

      // If pdf-parse returned almost nothing, the PDF is image-based — use Gemini Vision
      if (rawText.trim().length < MIN_TEXT_LENGTH) {
        console.log(`[FileParser] PDF has minimal text (${rawText.trim().length} chars). Switching to Gemini Vision OCR...`);
        rawText = await extractTextFromImagePDF(filePath);
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

    if (!rawText || rawText.trim().length < 30) {
      throw new Error('Could not extract readable text from this file. Please ensure the PDF is not password-protected or corrupted.');
    }

    // Normalize whitespace
    return rawText.replace(/\s\s+/g, ' ').trim();
  } catch (err) {
    console.error(`[FileParser] Failed to parse ${path.basename(filePath)}:`, err.message);
    throw new Error(`Could not extract text from "${path.basename(filePath)}": ${err.message}`);
  }
};

/**
 * Parse a text-based PDF file and extract its text
 */
const parsePDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return (data.text || '').trim();
};

/**
 * Use Gemini Vision to extract text from an image-based (scanned) PDF
 * Gemini 2.0 Flash can read PDFs natively as inline data
 */
const extractTextFromImagePDF = async (filePath, retries = 2) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not set — cannot perform Vision OCR on image-based PDF.');
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const pdfBuffer = fs.readFileSync(filePath);
  const base64Data = pdfBuffer.toString('base64');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent([
        {
          inlineData: {
            data: base64Data,
            mimeType: 'application/pdf',
          },
        },
        `Extract ALL text from this resume PDF exactly as it appears. 
Include: candidate name, contact info, work experience with dates and descriptions, 
education, skills, certifications, projects, and any other content. 
Output plain text only — no markdown formatting, no bullet symbols, just the raw text content.`,
      ]);

      const text = result.response.text().trim();
      console.log(`[FileParser] Gemini Vision OCR extracted ${text.length} characters from image-based PDF.`);
      return text;
    } catch (err) {
      const isRetryable = err.message?.includes('503') || err.message?.includes('429') || err.message?.includes('Too Many Requests') || err.message?.includes('Service Unavailable');
      if (isRetryable && attempt < retries) {
        const delay = (attempt + 1) * 8000; // 8s, then 16s
        console.warn(`[FileParser] Gemini Vision rate limited, retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
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
