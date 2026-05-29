const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume } = require('../services/aiScorer');

const router = express.Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── POST /api/analyze/:jobId ─────────────────────────────────────────────────
// Triggers AI scoring for all candidates in a job session.
// Processes sequentially (one at a time) with a small delay to stay within rate limits.
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

    console.log(`[Analyze] Scoring ${candidates.length} candidate(s) for: "${job.title}"`);

    const results = [];
    const errors  = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(`[Analyze] (${i + 1}/${candidates.length}) Scoring: ${candidate.name}`);

      try {
        if (!candidate.raw_text || candidate.raw_text.trim().length < 30) {
          throw new Error(
            'No readable text found in this resume. ' +
            'It may be a scanned or image-based PDF. Please upload a text-based PDF or DOCX.'
          );
        }

        const scoreData = await scoreResume(candidate.raw_text, job.description);

        // Use AI-extracted name if heuristic returned "Unknown Candidate"
        const resolvedName =
          candidate.name === 'Unknown Candidate' && scoreData.candidateName !== 'Unknown Candidate'
            ? scoreData.candidateName
            : candidate.name;

        await upsertScore({
          candidateId:     candidate.id,
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
      } catch (err) {
        const errMsg = err.message || 'Scoring failed';
        console.error(`[Analyze] Failed "${candidate.name}": ${errMsg}`);
        errors.push({ candidateId: candidate.id, name: candidate.name, error: errMsg });
      }

      // Small delay between requests to stay within rate limits
      if (i < candidates.length - 1) {
        await sleep(1000);
      }
    }

    // Rank all successfully scored candidates
    if (results.length > 0) {
      await updateRanks(jobId);
    }

    if (results.length === 0) {
      return res.status(400).json({
        error: 'Analysis failed for all candidates.',
        details: errors.map(e => `${e.name}: ${e.error}`).join(' | '),
        errors,
      });
    }

    res.json({
      jobId,
      jobTitle:        job.title,
      totalCandidates: candidates.length,
      scored:          results.length,
      failed:          errors.length,
      results,
      errors:          errors.length > 0 ? errors : undefined,
      message:         `${results.length} of ${candidates.length} candidates analyzed successfully.`,
    });

  } catch (err) {
    console.error('[Analyze Route] Error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.', details: err.message });
  }
});

module.exports = router;
