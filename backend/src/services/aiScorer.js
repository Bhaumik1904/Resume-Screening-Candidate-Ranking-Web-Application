const Groq = require('groq-sdk');
require('dotenv').config();

// ─── Scoring prompt ────────────────────────────────────────────────────────────
const SCORING_PROMPT = `You are an expert senior HR recruiter with 15+ years of experience evaluating candidates across ALL job types — technical, creative, language, sales, operations, and more.

Read the JOB DESCRIPTION carefully to understand:
1. What DOMAIN is this role in? (e.g., software engineering, content writing, sales, language training, data analysis)
2. What are the HARD REQUIREMENTS? (e.g., specific language fluency, mandatory certifications, domain expertise)
3. What SKILLS, EXPERIENCE, and BACKGROUND does this role actually need?

Then read the RESUME and score the candidate HONESTLY on 4 dimensions (each 0–25 points, total 0–100):

1. skillsScore (0–25): How well do the candidate's demonstrated skills match what this SPECIFIC JOB requires?
   - IMPORTANT: Only count skills that are RELEVANT to THIS job. A software engineer's React/Node.js skills score 0 for a bilingual content writing job.
   - Hard requirement mismatch (e.g., language fluency not demonstrated) = 0–5 max for this dimension.

2. experienceScore (0–25): How relevant is the candidate's work history to THIS role's actual responsibilities?
   - Domain mismatch (e.g., software internship for a language teaching role) = 0–8 max.
   - Similar domain but different level = partial credit.

3. educationScore (0–25): Does education meet the JD's requirements?
   - If a degree level or field is explicitly required and missing = 0–10 max.
   - General degree requirements met = full credit if other dimensions fit.

4. keywordScore (0–25): Does the resume use terminology, tools, and concepts from the JD?
   - Only count JD-specific keywords, NOT general academic or unrelated terms.

DOMAIN MISMATCH RULE (CRITICAL):
If the candidate's ENTIRE professional background is in a completely different field from what the job requires, their total score MUST reflect this honestly. A software engineer applying for a bilingual content writing role, a chef applying for a data science role, etc. should score LOW (15–40 range) because domain expertise is the primary requirement. Do NOT inflate scores just because the candidate seems impressive overall.

HARD REQUIREMENT RULE:
If the JD explicitly states a hard requirement (e.g., "must be fluent in Hindi and English", "must have X certification") and the resume shows NO evidence of meeting it, penalize each affected dimension by 60–80%.

Also extract:
- candidateName: Full name only (first and last, no titles)
- matchedSkills: 3–8 specific skills/qualifications from the resume that DIRECTLY match THIS job's requirements (not generic or unrelated skills). If the domain doesn't match, list only the few transferable ones.
- missingSkills: 4–8 important requirements from the JD that are clearly absent from the resume
- summary: 2–3 sentence HONEST HR assessment. If there is a domain mismatch, state it clearly. Reference specific resume content.

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
