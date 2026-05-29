const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Shared Scoring Prompt ────────────────────────────────────────────────────
const SCORING_PROMPT = `You are an expert senior HR recruiter and talent acquisition specialist with 15+ years of experience.

Carefully analyze the candidate's resume against the JOB DESCRIPTION. Provide an INTELLIGENT, NUANCED evaluation — not just keyword matching.

Score on EXACTLY 4 dimensions (each 0–25 points, total 0–100):
1. skillsScore (0–25): Technical skills alignment. Consider equivalent technologies (e.g. Express≈Node.js). Depth of expertise matters.
2. experienceScore (0–25): Work experience relevance. Years, seniority level, similar domain and responsibilities.
3. educationScore (0–25): Education fit. Degree level, field of study, certifications. Partial credit for bootcamps.
4. keywordScore (0–25): Role-specific tools, frameworks, methodologies from the JD. Semantic equivalents count.

Also provide:
- candidateName: Full name (first and last only, no titles)
- matchedSkills: 5–10 SPECIFIC technologies/tools the candidate has that match the JD (e.g. "React", "Node.js", "AWS" — NEVER generic words like "experience", "strong", "looking")
- missingSkills: 4–8 important JD requirements GENUINELY absent from the resume (specific skills/tools only)
- summary: 2–3 sentence professional HR assessment referencing specific things from the resume

Return ONLY valid raw JSON, no markdown, no code blocks:
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

/**
 * Score a text-based resume against a job description using Gemini.
 * Use this when the PDF text was successfully extracted (text-based PDFs).
 */
const scoreResume = async (resumeText, jobDescription) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `${SCORING_PROMPT}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

RESUME:
${resumeText.substring(0, 5000)}`;

  const result = await model.generateContent(prompt);
  return parseGeminiResponse(result.response.text());
};

/**
 * Score an image-based PDF resume using Gemini Vision.
 * Sends the raw PDF bytes to Gemini — it reads the PDF visually AND scores it in one API call.
 * Use this when pdf-parse returned < 100 characters (scanned/image-based PDFs).
 */
const scoreResumeWithVision = async (filePath, jobDescription) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in .env');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Resume file not found on disk: ${filePath}`);
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const pdfBuffer = fs.readFileSync(filePath);
  const base64Data = pdfBuffer.toString('base64');

  const prompt = `${SCORING_PROMPT}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

The resume is the attached PDF. Read ALL content from it carefully, then score the candidate.`;

  const result = await model.generateContent([
    { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
    prompt,
  ]);

  return parseGeminiResponse(result.response.text());
};

/**
 * Parse and validate the raw JSON response from Gemini
 */
const parseGeminiResponse = (responseText) => {
  // Strip any markdown code blocks if Gemini wrapped the JSON
  const jsonStr = responseText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error('[AIScorer] Failed to parse response:', responseText.substring(0, 300));
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

  // Filter out generic English words from skills lists
  const genericWords = new Set([
    'experience', 'strong', 'looking', 'requirements', 'proficiency', 'title',
    'senior', 'junior', 'years', 'skills', 'ability', 'team', 'knowledge',
    'excellent', 'good', 'great', 'familiar', 'working', 'using', 'tools',
    'technologies', 'bonus', 'previous', 'attention',
  ]);
  const isRealSkill = (w) => w && w.length > 1 && !genericWords.has(w.toLowerCase().trim());

  return {
    candidateName:  (parsed.candidateName  || 'Unknown Candidate').substring(0, 255),
    totalScore,
    skillsScore,
    experienceScore,
    educationScore,
    keywordScore,
    matchedSkills:  Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills.filter(isRealSkill).slice(0, 10) : [],
    missingSkills:  Array.isArray(parsed.missingSkills) ? parsed.missingSkills.filter(isRealSkill).slice(0, 8)  : [],
    summary:        (parsed.summary || '').substring(0, 600),
  };
};

module.exports = { scoreResume, scoreResumeWithVision };
