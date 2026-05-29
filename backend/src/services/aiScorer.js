const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// ─── Shared scoring prompt ─────────────────────────────────────────────────────
const SCORING_PROMPT = `You are an expert senior HR recruiter and talent acquisition specialist with 15+ years of experience evaluating resumes for technical roles.

Carefully analyze the RESUME against the JOB DESCRIPTION below. You must provide an INTELLIGENT, NUANCED evaluation — not just keyword matching.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):

1. **skillsScore** (0–25): Technical skills alignment. Consider exact matches, equivalent technologies, and depth of expertise.
2. **experienceScore** (0–25): Work experience relevance. Consider years of experience, seniority level, similar domain/industry, scope and responsibilities.
3. **educationScore** (0–25): Education fit. Consider degree level, field of study, certifications, and relevant courses.
4. **keywordScore** (0–25): Presence of role-specific tools, frameworks, methodologies, and industry terminology from the JD.

Also extract:
- **candidateName**: Full name of the candidate (first and last name only, no titles)
- **matchedSkills**: Array of 5–10 specific TECHNOLOGIES or TOOLS the candidate has that match the JD (e.g. "React", "Next.js", "TypeScript" — NOT generic words like "experience", "strong", "looking")
- **missingSkills**: Array of 4–8 important JD requirements genuinely absent from the resume
- **summary**: A 2–3 sentence professional HR assessment referencing actual resume content and why the candidate is/isn't a fit.

CRITICAL RULES:
- matchedSkills and missingSkills must be TECHNOLOGIES, TOOLS, and SPECIFIC SKILLS only — never generic English words
- summary must reference specific things from the candidate's actual resume
- Be fair and realistic

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

First, read ALL text visible in the resume carefully.
Then, analyze the candidate against the provided JOB DESCRIPTION.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):
1. **skillsScore** (0–25): Technical skills alignment.
2. **experienceScore** (0–25): Relevance of work experience.
3. **educationScore** (0–25): Education and certification fit.
4. **keywordScore** (0–25): JD-specific tools and terminology presence.

Also extract:
- **candidateName**: Full name visible in the resume
- **matchedSkills**: 5–10 specific technologies/tools matching the JD (NOT generic words)
- **missingSkills**: 4–8 important JD requirements NOT in the resume
- **summary**: 2–3 sentence professional HR assessment with specific resume details

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

// ─── Helpers ───────────────────────────────────────────────────────────────────
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
        err.message?.includes('RESOURCE_EXHAUSTED') ||
        err.status === 429;

      if (isRateLimit && attempt < maxRetries) {
        const delay = baseDelayMs * attempt;
        console.warn(`[AIScorer] Rate limit hit (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s…`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
};

const genericWords = new Set([
  'experience', 'strong', 'looking', 'requirements', 'proficiency',
  'title', 'senior', 'junior', 'years', 'skills', 'ability', 'team',
  'knowledge', 'excellent', 'good', 'great', 'familiar', 'working',
  'using', 'tools', 'technologies', 'bonus', 'previous', 'attention',
]);
const isRealSkill = (w) => w && w.length > 1 && !genericWords.has(w.toLowerCase().trim());

const parseAIResponse = (responseText) => {
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

// ─── Groq: text-based scoring (primary for text PDFs/DOCX/TXT) ────────────────
const scoreResumeWithGroq = async (resumeText, jobDescription) => {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const prompt = `${SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}\n\nRESUME:\n${resumeText.substring(0, 5000)}`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  });

  const responseText = completion.choices[0]?.message?.content || '';
  return parseAIResponse(responseText);
};

// ─── Gemini: text-based scoring (fallback if Groq unavailable) ────────────────
const scoreResumeWithGemini = async (resumeText, jobDescription) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `${SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}\n\nRESUME:\n${resumeText.substring(0, 5000)}`;

  const result = await model.generateContent(prompt);
  return parseAIResponse(result.response.text().trim());
};

// ─── Gemini Vision: image-based scoring (combined OCR + scoring in 1 call) ────
const scoreResumeVision = async (filePath, jobDescription, mimeType = 'application/pdf') => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  console.log(`[AIScorer] Vision scoring: ${path.basename(filePath)}`);
  const base64Data = fs.readFileSync(filePath).toString('base64');

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType } },
    `${VISION_SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}`,
  ]);

  return parseAIResponse(result.response.text().trim());
};

// ─── Main entry point: auto-selects best provider ─────────────────────────────
/**
 * Score a text-based resume.
 * Uses Groq (fast, high limits) with Gemini as fallback.
 */
const scoreResume = async (resumeText, jobDescription) => {
  const hasGroq = process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'your_groq_api_key_here';

  if (hasGroq) {
    try {
      console.log('[AIScorer] Using Groq (llama-3.3-70b-versatile)');
      return await withRetry(() => scoreResumeWithGroq(resumeText, jobDescription), 3, 3000);
    } catch (groqErr) {
      console.warn('[AIScorer] Groq failed, falling back to Gemini:', groqErr.message);
    }
  }

  // Fallback to Gemini
  console.log('[AIScorer] Using Gemini (gemini-2.5-flash)');
  return await withRetry(() => scoreResumeWithGemini(resumeText, jobDescription), 3, 5000);
};

module.exports = { scoreResume, scoreResumeVision };
