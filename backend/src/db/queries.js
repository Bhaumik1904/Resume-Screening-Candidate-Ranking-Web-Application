const db = require('../db');

// ─── Jobs ─────────────────────────────────────────────────────────────────────

const createJob = async (title, description) => {
  const res = await db.query(
    'INSERT INTO jobs (title, description) VALUES ($1, $2) RETURNING *',
    [title, description]
  );
  return res.rows[0];
};

const getJobById = async (jobId) => {
  const res = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return res.rows[0];
};

// ─── Candidates ───────────────────────────────────────────────────────────────

const createCandidate = async ({ jobId, name, email, fileName, filePath, fileType, rawText }) => {
  const res = await db.query(
    `INSERT INTO candidates (job_id, name, email, file_name, file_path, file_type, raw_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [jobId, name, email, fileName, filePath, fileType, rawText]
  );
  return res.rows[0];
};

const getCandidatesByJob = async (jobId) => {
  const res = await db.query('SELECT * FROM candidates WHERE job_id = $1', [jobId]);
  return res.rows;
};

const updateCandidateText = async (candidateId, rawText, name) => {
  const res = await db.query(
    'UPDATE candidates SET raw_text = $1, name = $2 WHERE id = $3 RETURNING *',
    [rawText, name, candidateId]
  );
  return res.rows[0];
};

// ─── Scores ───────────────────────────────────────────────────────────────────

const upsertScore = async ({
  candidateId,
  jobId,
  totalScore,
  skillsScore,
  experienceScore,
  educationScore,
  keywordScore,
  matchedSkills,
  missingSkills,
  summary,
}) => {
  const res = await db.query(
    `INSERT INTO scores 
       (candidate_id, job_id, total_score, skills_score, experience_score, 
        education_score, keyword_score, matched_skills, missing_skills, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (candidate_id) DO UPDATE SET
       total_score = EXCLUDED.total_score,
       skills_score = EXCLUDED.skills_score,
       experience_score = EXCLUDED.experience_score,
       education_score = EXCLUDED.education_score,
       keyword_score = EXCLUDED.keyword_score,
       matched_skills = EXCLUDED.matched_skills,
       missing_skills = EXCLUDED.missing_skills,
       summary = EXCLUDED.summary
     RETURNING *`,
    [
      candidateId, jobId, totalScore, skillsScore, experienceScore,
      educationScore, keywordScore, matchedSkills, missingSkills, summary,
    ]
  );
  return res.rows[0];
};

const updateRanks = async (jobId) => {
  // Assign ranks ordered by total_score DESC
  await db.query(
    `UPDATE scores SET rank = ranked.rank
     FROM (
       SELECT id, ROW_NUMBER() OVER (ORDER BY total_score DESC) AS rank
       FROM scores WHERE job_id = $1
     ) AS ranked
     WHERE scores.id = ranked.id`,
    [jobId]
  );
};

const getResultsByJob = async (jobId) => {
  const res = await db.query(
    `SELECT 
       c.id AS candidate_id,
       c.name,
       c.email,
       c.file_name,
       c.file_path,
       c.file_type,
       COALESCE(s.total_score, 0)      AS total_score,
       COALESCE(s.skills_score, 0)     AS skills_score,
       COALESCE(s.experience_score, 0) AS experience_score,
       COALESCE(s.education_score, 0)  AS education_score,
       COALESCE(s.keyword_score, 0)    AS keyword_score,
       COALESCE(s.matched_skills, '{}') AS matched_skills,
       COALESCE(s.missing_skills, '{}') AS missing_skills,
       s.summary,
       s.rank,
       CASE WHEN s.id IS NULL THEN 'failed' ELSE 'scored' END AS status
     FROM candidates c
     LEFT JOIN scores s ON s.candidate_id = c.id
     WHERE c.job_id = $1
     ORDER BY COALESCE(s.rank, 9999) ASC, c.created_at ASC`,
    [jobId]
  );
  return res.rows;
};


module.exports = {
  createJob,
  getJobById,
  createCandidate,
  getCandidatesByJob,
  updateCandidateText,
  upsertScore,
  updateRanks,
  getResultsByJob,
};
