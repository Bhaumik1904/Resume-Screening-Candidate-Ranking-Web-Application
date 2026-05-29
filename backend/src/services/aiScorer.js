const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Prompt ────────────────────────────────────────────────────────────────────
const SCORING_PROMPT = `You are an expert senior HR recruiter and talent acquisition specialist with 15+ years of experience evaluating resumes for technical roles.

Carefully analyze the RESUME against the JOB DESCRIPTION below. You must provide an INTELLIGENT, NUANCED evaluation — not just keyword matching.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):

1. **skillsScore** (0–25): Technical skills alignment. Consider exact matches, equivalent technologies, and depth of expertise.
2. **experienceScore** (0–25): Work experience relevance. Consider years of experience, seniority level, similar domain/industry, scope and responsibilities.
3. **educationScore** (0–25): Education fit. Consider degree level, field of study, certifications, and relevant courses.
4. **keywordScore** (0–25): Presence of role-specific tools, frameworks, methodologies, and industry terminology from the JD. Consider semantic equivalents.

Also extract:
- **candidateName**: Full name of the candidate (first and last name only, no titles)
- **matchedSkills**: Array of 5–10 specific TECHNOLOGIES or TOOLS the candidate has that match the JD (e.g. "React", "Next.js", "TypeScript" — NOT generic words like "experience", "strong", "looking")
- **missingSkills**: Array of 4–8 important JD requirements genuinely absent from the resume (e.g. "Redux Toolkit", "TypeScript" — NOT words like "senior", "requirements")
- **summary**: A 2–3 sentence professional assessment written like an HR recruiter. Be specific about why the candidate is/isn't a fit. Mention actual skills and experience from the resume.

CRITICAL RULES:
- matchedSkills and missingSkills must be TECHNOLOGIES, TOOLS, and SPECIFIC SKILLS only
- summary must reference specific things from the candidate's actual resume
- Be fair and realistic — student project experience counts, but less than industry experience

Return ONLY a valid JSON object. No markdown, no code blocks, just raw JSON:
{
  "candidateName": "string",
  "totalScore": number,
  "skillsScore": number,
  "experienceScore": number,
  "educationScore": number,
  "keywordScore": number,
  "matchedSkills": ["string"],
  "missingSkills": ["string"],
  "summary": "string"
}`;

const VISION_SCORING_PROMPT = `You are an expert senior HR recruiter. This is a resume document (it may be a scanned image or image-based PDF).

First, read ALL text visible in the resume image carefully.
Then, analyze the candidate against the provided JOB DESCRIPTION.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):
1. **skillsScore** (0–25): Technical skills alignment with the JD.
2. **experienceScore** (0–25): Relevance of work experience.
3. **educationScore** (0–25): Education and certification fit.
4. **keywordScore** (0–25): Presence of JD-specific tools and terminology.

Also extract:
- **candidateName**: Full name visible in the resume
- **matchedSkills**: 5–10 specific technologies/tools that match the JD (NOT generic words)
- **missingSkills**: 4–8 important JD requirements NOT found in the resume
- **summary**: 2–3 sentence professional HR assessment referencing actual resume content

Return ONLY raw JSON (no markdown, no code blocks):
{
  "candidateName": "string",
  "totalScore": number,
  "skillsScore": number,
  "experienceScore": number,
  "educationScore": number,
  "keywordScore": number,
  "matchedSkills": ["string"],
  "missingSkills": ["string"],
  "summary": "string"
}`;

// ─── Retry helper (exponential backoff for 429 rate limits) ────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const withRetry = async (fn, maxRetries = 3, baseDelayMs = 5000) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRateLimit =
        err.message?.includes('429') ||
        err.message?.includes('quota') ||
        err.message?.includes('RESOURCE_EXHAUSTED');

      if (isRateLimit && attempt < maxRetries) {
        const delay = baseDelayMs * attempt; // 5s, 10s, 15s
        console.warn(`[AIScorer] Rate limit hit (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
};

// ─── Parse & validate Gemini JSON response ─────────────────────────────────────
const parseGeminiResponse = (responseText) => {
  const jsonStr = responseText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('AI returned an unexpected response format. Please try again.');
  }

  const clamp = (val, min, max) => Math.min(max, Math.max(min, Math.round(Number(val) || 0)));
  const genericWords = new Set([
    'experience', 'strong', 'looking', 'requirements', 'proficiency',
    'title', 'senior', 'junior', 'years', 'skills', 'ability', 'team',
    'knowledge', 'excellent', 'good', 'great', 'familiar', 'working',
    'using', 'tools', 'technologies', 'bonus', 'previous', 'attention',
  ]);
  const isRealSkill = (w) => w && w.length > 1 && !genericWords.has(w.toLowerCase().trim());

  const skillsScore     = clamp(parsed.skillsScore,     0, 25);
  const experienceScore = clamp(parsed.experienceScore,  0, 25);
  const educationScore  = clamp(parsed.educationScore,   0, 25);
  const keywordScore    = clamp(parsed.keywordScore,     0, 25);
  const computedTotal   = skillsScore + experienceScore + educationScore + keywordScore;
  const totalScore      = clamp(
    parsed.totalScore && Math.abs(parsed.totalScore - computedTotal) <= 5
      ? parsed.totalScore : computedTotal,
    0, 100
  );

  return {
    candidateName:  (parsed.candidateName || 'Unknown Candidate').substring(0, 255),
    totalScore,
    skillsScore,
    experienceScore,
    educationScore,
    keywordScore,
    matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills.filter(isRealSkill).slice(0, 10) : [],
    missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.filter(isRealSkill).slice(0, 8)  : [],
    summary: (parsed.summary || '').substring(0, 600),
  };
};

// ─── Text-based scoring ────────────────────────────────────────────────────────
/**
 * Score a resume against a job description using text extracted from the file.
 * @param {string} resumeText
 * @param {string} jobDescription
 */
const scoreResume = async (resumeText, jobDescription) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured. Please set it in your .env file.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `${SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}\n\nRESUME:\n${resumeText.substring(0, 5000)}`;

  return withRetry(async () => {
    const result = await model.generateContent(prompt);
    return parseGeminiResponse(result.response.text().trim());
  });
};

// ─── Vision-based scoring (image PDF / scanned resume) ────────────────────────
/**
 * Score an image-based resume by sending the file directly to Gemini Vision.
 * This performs OCR + scoring in a SINGLE API call instead of two.
 * @param {string} filePath - Path to the PDF/image file
 * @param {string} jobDescription
 * @param {string} mimeType - e.g. 'application/pdf'
 */
const scoreResumeVision = async (filePath, jobDescription, mimeType = 'application/pdf') => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured. Please set it in your .env file.');
  }

  console.log(`[AIScorer] Using Vision scoring for image-based file: ${require('path').basename(filePath)}`);

  const model     = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  return withRetry(async () => {
    const result = await model.generateContent([
      { inlineData: { data: base64Data, mimeType } },
      `${VISION_SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}`,
    ]);
    return parseGeminiResponse(result.response.text().trim());
  });
};

module.exports = { scoreResume, scoreResumeVision };
