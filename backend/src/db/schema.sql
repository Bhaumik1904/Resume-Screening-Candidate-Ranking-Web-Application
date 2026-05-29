-- Resume Screening App Database Schema
-- Run this file to initialize the database: psql -d resume_screening -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Jobs table: stores JD info per screening session
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255),
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Candidates table: one row per uploaded resume
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255),
  file_name VARCHAR(500) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_type VARCHAR(50),
  raw_text TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Scores table: AI scoring results per candidate
CREATE TABLE IF NOT EXISTS scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID UNIQUE NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  total_score INTEGER DEFAULT 0 CHECK (total_score BETWEEN 0 AND 100),
  skills_score INTEGER DEFAULT 0 CHECK (skills_score BETWEEN 0 AND 25),
  experience_score INTEGER DEFAULT 0 CHECK (experience_score BETWEEN 0 AND 25),
  education_score INTEGER DEFAULT 0 CHECK (education_score BETWEEN 0 AND 25),
  keyword_score INTEGER DEFAULT 0 CHECK (keyword_score BETWEEN 0 AND 25),
  matched_skills TEXT[] DEFAULT '{}',
  missing_skills TEXT[] DEFAULT '{}',
  summary TEXT,
  rank INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_candidates_job_id ON candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_scores_job_id ON scores(job_id);
CREATE INDEX IF NOT EXISTS idx_scores_candidate_id ON scores(candidate_id);
CREATE INDEX IF NOT EXISTS idx_scores_total_score ON scores(total_score DESC);
