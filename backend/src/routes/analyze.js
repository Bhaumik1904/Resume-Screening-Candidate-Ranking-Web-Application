const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume } = require('../services/aiScorer');

const router = express.Router();

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

    console.log(`[Analyze] Scoring ${candidates.length} candidates for job: ${job.title}`);

    // Score all resumes in parallel (with concurrency limit to avoid API rate limits)
    const CONCURRENCY = 3;
    const results = [];
    const errors = [];

    // Process in batches
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(async (candidate) => {
          if (!candidate.raw_text || candidate.raw_text.trim().length < 30) {
            throw new Error('Resume text is too short or empty. The file may be corrupted or unreadable.');
          }

          const scoreData = await scoreResume(candidate.raw_text, job.description);

          // Use AI-extracted name if the heuristic gave us "Unknown Candidate"
          const resolvedName =
            candidate.name === 'Unknown Candidate' && scoreData.candidateName !== 'Unknown Candidate'
              ? scoreData.candidateName
              : candidate.name;

          await upsertScore({
            candidateId: candidate.id,
            jobId,
            totalScore: scoreData.totalScore,
            skillsScore: scoreData.skillsScore,
            experienceScore: scoreData.experienceScore,
            educationScore: scoreData.educationScore,
            keywordScore: scoreData.keywordScore,
            matchedSkills: scoreData.matchedSkills,
            missingSkills: scoreData.missingSkills,
            summary: scoreData.summary,
          });

          return {
            candidateId: candidate.id,
            name: resolvedName,
            totalScore: scoreData.totalScore,
          };
        })
      );

      batchResults.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          const errMsg = result.reason?.message || 'Scoring failed';
          console.error(`[Analyze] Failed to score candidate ${batch[idx].name}: ${errMsg}`);
          errors.push({
            candidateId: batch[idx].id,
            name: batch[idx].name,
            error: errMsg,
          });
        }
      });

      // Small delay between batches to respect API rate limits
      if (i + CONCURRENCY < candidates.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Assign ranks based on total_score DESC
    await updateRanks(jobId);

    res.json({
      jobId,
      jobTitle: job.title,
      totalCandidates: candidates.length,
      scored: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      message: `Scoring complete. ${results.length} of ${candidates.length} candidates analyzed successfully.`,
    });
  } catch (err) {
    console.error('[Analyze Route] Error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.', details: err.message });
  }
});

module.exports = router;
