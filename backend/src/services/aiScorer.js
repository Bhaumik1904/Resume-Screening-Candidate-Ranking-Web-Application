const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SCORING_PROMPT = `You are an expert senior HR recruiter and talent acquisition specialist with 15+ years of experience evaluating resumes for technical roles.

Carefully analyze the RESUME against the JOB DESCRIPTION below. You must provide an INTELLIGENT, NUANCED evaluation — not just keyword matching.

Score the candidate on EXACTLY 4 dimensions (each 0–25 points, total 0–100):

1. **skillsScore** (0–25): Technical skills alignment. Consider exact matches, equivalent technologies (e.g. Express≈Node.js, Vite≈React ecosystem), and depth of expertise. A React developer with Next.js naturally knows React.
2. **experienceScore** (0–25): Work experience relevance. Consider years of experience, seniority level, similar domain/industry, scope and responsibilities.
3. **educationScore** (0–25): Education fit. Consider degree level, field of study, certifications, and relevant courses. Award partial credit for bootcamps/self-learning if the role allows it.
4. **keywordScore** (0–25): Presence of role-specific tools, frameworks, methodologies, and industry terminology from the JD. Consider semantic equivalents (e.g. "state management" covers Redux, Zustand, Context API).

Also extract:
- **candidateName**: Full name of the candidate (first and last name only, no titles)
- **matchedSkills**: Array of 5–10 specific, MEANINGFUL skills or technologies the candidate has that match the JD (e.g. "React", "Next.js", "TypeScript", "REST APIs" — NOT generic words like "experience", "strong", "looking")
- **missingSkills**: Array of 4–8 important JD requirements that are genuinely absent from the resume (e.g. "Redux Toolkit", "TypeScript", "3+ years experience" — NOT words like "senior", "requirements")
- **summary**: A 2–3 sentence professional assessment written like an HR recruiter would write it. Be specific about why the candidate is/isn't a fit. Mention actual skills and experience from the resume.

CRITICAL RULES:
- matchedSkills and missingSkills must be TECHNOLOGIES, TOOLS, and SPECIFIC SKILLS only — never generic English words
- summary must reference specific things from the candidate's actual resume
- Be fair and realistic — a student's project experience counts, but less than industry experience
- If the resume has strong adjacent skills (e.g. MongoDB experience for a SQL role), mention it in the summary

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

/**
 * Score a resume against a job description using Gemini
 * @param {string} resumeText - Extracted resume text
 * @param {string} jobDescription - Job description text
 * @returns {Promise<Object>} Scoring result with scores and analysis
 */
const scoreResume = async (resumeText, jobDescription) => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured. Please set it in your .env file.');
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `${SCORING_PROMPT}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

RESUME:
${resumeText.substring(0, 5000)}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text().trim();

  // Strip markdown code blocks if Gemini wraps the JSON
  const jsonStr = responseText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('[AIScorer] Failed to parse Gemini response:', responseText.substring(0, 500));
    throw new Error('AI returned an unexpected response format. Please try again.');
  }

  // Validate and clamp scores
  const clamp = (val, min, max) => Math.min(max, Math.max(min, Math.round(Number(val) || 0)));

  const skillsScore     = clamp(parsed.skillsScore,     0, 25);
  const experienceScore = clamp(parsed.experienceScore,  0, 25);
  const educationScore  = clamp(parsed.educationScore,   0, 25);
  const keywordScore    = clamp(parsed.keywordScore,     0, 25);

  // Use AI's total if provided and sensible, else compute from subscores
  const computedTotal = skillsScore + experienceScore + educationScore + keywordScore;
  const totalScore = clamp(
    parsed.totalScore && Math.abs(parsed.totalScore - computedTotal) <= 5
      ? parsed.totalScore
      : computedTotal,
    0,
    100
  );

  // Filter out garbage words from matched/missing skills
  const genericWords = new Set([
    'experience', 'strong', 'looking', 'requirements', 'proficiency',
    'title', 'senior', 'junior', 'years', 'skills', 'ability', 'team',
    'knowledge', 'excellent', 'good', 'great', 'familiar', 'working',
    'using', 'tools', 'technologies', 'bonus', 'previous', 'attention',
  ]);
  const isRealSkill = (w) => w && w.length > 1 && !genericWords.has(w.toLowerCase().trim());

  const matchedSkills = Array.isArray(parsed.matchedSkills)
    ? parsed.matchedSkills.filter(isRealSkill).slice(0, 10)
    : [];
  const missingSkills = Array.isArray(parsed.missingSkills)
    ? parsed.missingSkills.filter(isRealSkill).slice(0, 8)
    : [];

  return {
    candidateName: (parsed.candidateName || 'Unknown Candidate').substring(0, 255),
    totalScore,
    skillsScore,
    experienceScore,
    educationScore,
    keywordScore,
    matchedSkills,
    missingSkills,
    summary: (parsed.summary || '').substring(0, 600),
  };
};

module.exports = { scoreResume };
