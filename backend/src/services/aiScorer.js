const Groq = require('groq-sdk');
require('dotenv').config();

// ─── Scoring prompt ────────────────────────────────────────────────────────────
const SCORING_PROMPT = `You are an expert senior HR recruiter and talent acquisition specialist with 15+ years of experience evaluating resumes for technical roles.

Carefully analyze the RESUME against the JOB DESCRIPTION below. Provide an INTELLIGENT, NUANCED evaluation — not just keyword matching.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):

1. skillsScore (0–25): Technical skills alignment. Consider exact matches, equivalent technologies, and depth of expertise.
2. experienceScore (0–25): Work experience relevance. Consider years of experience, seniority level, similar domain, and responsibilities.
3. educationScore (0–25): Education fit. Degree level, field of study, certifications, and relevant courses.
4. keywordScore (0–25): Presence of role-specific tools, frameworks, and industry terminology from the JD.

Also extract:
- candidateName: Full name only (first and last, no titles)
- matchedSkills: 5–10 specific TECHNOLOGIES or TOOLS that match the JD (e.g. "React", "TypeScript", "AWS" — NOT generic words like "experience", "strong", "senior")
- missingSkills: 4–8 important JD requirements genuinely absent from the resume (specific tools/skills only)
- summary: 2–3 sentence professional HR assessment referencing actual content from the resume. Explain specifically why the candidate is or isn't a good fit.

Return ONLY valid JSON. No markdown, no code blocks:
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

const withRetry = async (fn, maxRetries = 3, baseDelayMs = 3000) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRateLimit =
        err.message?.includes('429') ||
        err.message?.includes('rate_limit') ||
        err.status === 429;

      if (isRateLimit && attempt < maxRetries) {
        const delay = baseDelayMs * attempt;
        console.warn(`[AIScorer] Rate limit (attempt ${attempt}/${maxRetries}). Retrying in ${delay / 1000}s…`);
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

const parseGroqResponse = (responseText) => {
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

// ─── Main scorer ───────────────────────────────────────────────────────────────
/**
 * Score a resume against a job description using Groq (llama-3.3-70b-versatile).
 * @param {string} resumeText - Extracted resume text
 * @param {string} jobDescription - Job description text
 * @returns {Promise<Object>} Scoring result
 */
const scoreResume = async (resumeText, jobDescription) => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not configured. Please add it to your .env file.');
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const prompt = `${SCORING_PROMPT}\n\nJOB DESCRIPTION:\n${jobDescription.substring(0, 3000)}\n\nRESUME:\n${resumeText.substring(0, 5000)}`;

  return withRetry(async () => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    const responseText = completion.choices[0]?.message?.content || '';
    return parseGroqResponse(responseText);
  });
};

module.exports = { scoreResume };
