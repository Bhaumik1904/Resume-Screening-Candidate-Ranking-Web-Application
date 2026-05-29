const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume, scoreResumeVision } = require('../services/aiScorer');

const router = express.Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── POST /api/analyze/:jobId ─────────────────────────────────────────────────
// Triggers AI scoring pipeline for all candidates in a job session.
// Processes candidates SEQUENTIALLY (1 at a time) to respect API rate limits.
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

    console.log(`[Analyze] Starting sequential scoring of ${candidates.length} candidates for: "${job.title}"`);

    const results = [];
    const errors  = [];

    // Process ONE at a time to avoid hitting Gemini API rate limits
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      console.log(`[Analyze] (${i + 1}/${candidates.length}) Scoring: ${candidate.name}`);

      try {
        const hasText = candidate.raw_text && candidate.raw_text.trim().length >= 80;
        let scoreData;

        if (hasText) {
          // Normal text-based PDF/DOCX/TXT → text scoring
          scoreData = await scoreResume(candidate.raw_text, job.description);
        } else {
          // Image-based PDF (JPG→PDF, scanned, etc.) → Vision OCR+scoring in 1 call
          console.log(`[Analyze] Candidate "${candidate.name}" has no text — using Vision OCR scoring.`);
          scoreData = await scoreResumeVision(candidate.file_path, job.description, 'application/pdf');
        }

        // Use AI-extracted name if heuristic gave us "Unknown Candidate"
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

        results.push({
          candidateId: candidate.id,
          name:        resolvedName,
          totalScore:  scoreData.totalScore,
        });

      } catch (err) {
        const errMsg = err.message || 'Scoring failed';
        console.error(`[Analyze] Failed to score "${candidate.name}": ${errMsg}`);
        errors.push({ candidateId: candidate.id, name: candidate.name, error: errMsg });
      }

      // Wait 2 seconds between each resume to avoid hitting the rate limit
      if (i < candidates.length - 1) {
        await sleep(2000);
      }
    }

    // Assign ranks ordered by total_score DESC
    await updateRanks(jobId);

    res.json({
      jobId,
      jobTitle:        job.title,
      totalCandidates: candidates.length,
      scored:          results.length,
      failed:          errors.length,
      results,
      errors:          errors.length > 0 ? errors : undefined,
      message:         `Scoring complete. ${results.length} of ${candidates.length} candidates analyzed successfully.`,
    });

  } catch (err) {
    console.error('[Analyze Route] Error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.', details: err.message });
  }
});

module.exports = router;
