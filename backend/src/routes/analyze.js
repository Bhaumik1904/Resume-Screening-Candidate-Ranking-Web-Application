const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume } = require('../services/aiScorer');

const router = express.Router();

// Free-tier Gemini rate limit is 10 RPM. We stay well under by processing
// one candidate at a time with a 7-second pause between each API call.
const DELAY_BETWEEN_CANDIDATES_MS = 7000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── POST /api/analyze/:jobId ─────────────────────────────────────────────────
// Triggers AI scoring pipeline for all candidates in a job session
router.post('/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found. Please upload resumes first.' });
    }

    const candidates = await getCandidatesByJob(jobId);
    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No candidates found for this job.' });
    }

    console.log(`[Analyze] Scoring ${candidates.length} candidates one-by-one for job: ${job.title}`);

    const results = [];
    const errors  = [];

    // Process candidates SEQUENTIALLY with a delay to respect API rate limits.
    // Gemini free tier = 10 RPM. With 7s between calls we stay at ~8 RPM max.
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(`[Analyze] (${i + 1}/${candidates.length}) Scoring: ${candidate.name || candidate.file_name}`);

      try {
        if (!candidate.raw_text || candidate.raw_text.trim().length < 50) {
          throw new Error('Resume text too short or empty — PDF may be image-based or corrupted.');
        }

        const scoreData = await scoreResume(candidate.raw_text, job.description);

        // Use AI-extracted name if the heuristic gave "Unknown Candidate"
        const resolvedName =
          candidate.name === 'Unknown Candidate' && scoreData.candidateName !== 'Unknown Candidate'
            ? scoreData.candidateName
            : candidate.name;

        await upsertScore({
          candidateId: candidate.id,
          jobId,
          totalScore:      scoreData.totalScore,
          skillsScore:     scoreData.skillsScore,
          experienceScore: scoreData.experienceScore,
          educationScore:  scoreData.educationScore,
          keywordScore:    scoreData.keywordScore,
          matchedSkills:   scoreData.matchedSkills,
          missingSkills:   scoreData.missingSkills,
          summary:         scoreData.summary,
        });

        results.push({ candidateId: candidate.id, name: resolvedName, totalScore: scoreData.totalScore });
        console.log(`[Analyze] ✓ ${resolvedName} scored ${scoreData.totalScore}/100`);
      } catch (err) {
        const errMsg = err.message || 'Scoring failed';
        console.error(`[Analyze] ✗ Failed: ${candidate.name || candidate.file_name}: ${errMsg}`);
        errors.push({ candidateId: candidate.id, name: candidate.name, error: errMsg });
      }

      // Pause before the next candidate (skip delay after the last one)
      if (i < candidates.length - 1) {
        console.log(`[Analyze] Waiting ${DELAY_BETWEEN_CANDIDATES_MS / 1000}s before next candidate (rate limit)...`);
        await sleep(DELAY_BETWEEN_CANDIDATES_MS);
      }
    }

    // Assign ranks based on total_score DESC
    await updateRanks(jobId);

    const message = `Scoring complete. ${results.length} of ${candidates.length} candidates analyzed successfully.`;
    console.log(`[Analyze] ${message}`);

    res.json({
      jobId,
      jobTitle: job.title,
      totalCandidates: candidates.length,
      scored:  results.length,
      failed:  errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      message,
    });
  } catch (err) {
    console.error('[Analyze Route] Error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.', details: err.message });
  }
});

module.exports = router;
