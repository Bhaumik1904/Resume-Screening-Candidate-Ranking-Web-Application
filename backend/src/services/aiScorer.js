const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SCORING_PROMPT = `You are an expert HR recruiter and resume analyst. 
Analyze the following resume against the provided Job Description.

Score the candidate on EXACTLY 4 dimensions (0-25 points each, total 0-100):
1. Skills Match (0-25): How well do the candidate's technical and soft skills match the JD requirements?
2. Experience Relevance (0-25): How relevant is their work experience (years, domain, responsibilities)?
3. Education Alignment (0-25): How well does their education background match requirements?
4. Keyword Similarity (0-25): How much JD-specific terminology, tools, and industry keywords appear?

Also extract:
- candidateName: The candidate's full name from the resume (first and last name only)
- matchedSkills: Array of skills/keywords that match the JD (max 10)
- missingSkills: Array of important JD requirements NOT found in the resume (max 8)
- summary: 2-sentence professional assessment of the candidate's fit

Return ONLY a valid JSON object with NO markdown formatting, NO code blocks, just raw JSON:
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
 * Score a resume against a job description using Gemini Flash
 * @param {string} resumeText - Extracted resume text
 * @param {string} jobDescription - Job description text
 * @returns {Promise<Object>} Scoring result with scores and analysis
 */
const scoreResume = async (resumeText, jobDescription) => {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `${SCORING_PROMPT}

JOB DESCRIPTION:
${jobDescription.substring(0, 3000)}

RESUME:
${resumeText.substring(0, 4000)}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Strip markdown code blocks if Gemini wraps the JSON
    const jsonStr = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(jsonStr);

    // Validate and clamp scores
    const clamp = (val, min, max) => Math.min(max, Math.max(min, Math.round(val || 0)));

    const skillsScore = clamp(parsed.skillsScore, 0, 25);
    const experienceScore = clamp(parsed.experienceScore, 0, 25);
    const educationScore = clamp(parsed.educationScore, 0, 25);
    const keywordScore = clamp(parsed.keywordScore, 0, 25);
    const totalScore = clamp(
      parsed.totalScore || (skillsScore + experienceScore + educationScore + keywordScore),
      0,
      100
    );

    return {
      candidateName: (parsed.candidateName || 'Unknown Candidate').substring(0, 255),
      totalScore,
      skillsScore,
      experienceScore,
      educationScore,
      keywordScore,
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills.slice(0, 10) : [],
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills.slice(0, 8) : [],
      summary: (parsed.summary || '').substring(0, 500),
    };
  } catch (err) {
    console.error('[AIScorer] Gemini API error:', err.message);
    // Fallback to keyword-based scoring if Gemini fails
    return fallbackScore(resumeText, jobDescription);
  }
};

/**
 * Fallback keyword-based scoring when Gemini API is unavailable
 */
const fallbackScore = (resumeText, jobDescription) => {
  const resumeLower = resumeText.toLowerCase();
  const jdWords = jobDescription
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 4);

  const uniqueJdWords = [...new Set(jdWords)];
  const matched = uniqueJdWords.filter((w) => resumeLower.includes(w));
  const matchRatio = uniqueJdWords.length > 0 ? matched.length / uniqueJdWords.length : 0;

  const totalScore = Math.round(matchRatio * 100);
  const perDim = Math.round(totalScore / 4);

  return {
    candidateName: 'Unknown Candidate',
    totalScore,
    skillsScore: Math.min(25, perDim),
    experienceScore: Math.min(25, perDim),
    educationScore: Math.min(25, perDim),
    keywordScore: Math.min(25, perDim),
    matchedSkills: matched.slice(0, 10),
    missingSkills: uniqueJdWords.filter((w) => !resumeLower.includes(w)).slice(0, 8),
    summary: `Keyword-based analysis: ${Math.round(matchRatio * 100)}% keyword overlap with the JD.`,
  };
};

module.exports = { scoreResume };
