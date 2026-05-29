const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume } = require('../services/aiScorer');
const { extractText, extractCandidateName } = require('../services/fileParser');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Score one candidate with automatic retry on Gemini rate-limit (429) or
 * service-unavailable (503) errors. Reads the suggested retry delay from the
 * Gemini error message when available.
 */
const scoreCandidateWithRetry = async (candidate, jobDescription, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await scoreResume(candidate.raw_text, jobDescription);
    } catch (err) {
      const isRateLimit   = err.message?.includes('429') || err.message?.includes('Too Many Requests');
      const isUnavailable = err.message?.includes('503') || err.message?.includes('Service Unavailable');

      // Honour Gemini's suggested retry delay, but cap at 15s so we don't stall
      let retryMs = (attempt + 1) * 8000; // 8s then 16s default
      const retryMatch = err.message?.match(/retry in (\d+(?:\.\d+)?)s/);
      if (retryMatch) retryMs = Math.min(Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000, 15000);

      if ((isRateLimit || isUnavailable) && attempt < retries) {
        console.warn(`[Analyze] Rate limited on "${candidate.name}". Waiting ${retryMs / 1000}s before retry...`);
        await sleep(retryMs);
      } else {
        throw err;
      }
    }
  }
};

// ─── POST /api/analyze/:jobId ─────────────────────────────────────────────────
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

    console.log(`[Analyze] Scoring ${candidates.length} candidates for "${job.title}" — sequential, 6s gap`);

    const results = [];
    const errors  = [];

    // Process ONE at a time with a 6s gap → stays within 5 RPM free-tier limit
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      // If this candidate has no raw_text (image-based PDF deferred from upload),
      // run Vision OCR now before scoring.
      let rawText = candidate.raw_text || '';
      if (rawText.trim().length < 50 && candidate.file_path) {
        try {
          console.log(`[Analyze] No text for "${candidate.name}" — running Vision OCR...`);
          rawText = await extractText(candidate.file_path, 'application/pdf');
          // Update candidate name if it was 'Unknown Candidate'
          if (candidate.name === 'Unknown Candidate' && rawText.length > 0) {
            candidate.name = extractCandidateName(rawText);
          }
        } catch (ocrErr) {
          console.error(`[Analyze] Vision OCR failed for "${candidate.name}": ${ocrErr.message}`);
        }
      }

      if (!rawText || rawText.trim().length < 50) {
        console.error(`[Analyze] Skipping "${candidate.name}" — text too short (${rawText.trim().length} chars).`);
        errors.push({
          candidateId: candidate.id,
          name: candidate.name,
          error: 'Resume text could not be extracted. Please re-upload as a text-based PDF or DOCX.',
        });
        // Still wait before next to keep rate limit spacing
        if (i < candidates.length - 1) await sleep(6000);
        continue;
      }

      try {
        console.log(`[Analyze] (${i + 1}/${candidates.length}) Scoring: ${candidate.name}`);
        const scoreData = await scoreCandidateWithRetry({ ...candidate, raw_text: rawText }, job.description);

        // Prefer AI-extracted name over the heuristic "Unknown Candidate"
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
        console.log(`[Analyze] ✓ ${resolvedName} → ${scoreData.totalScore}/100`);
      } catch (err) {
        const errMsg = err.message || 'Scoring failed';
        console.error(`[Analyze] ✗ Failed "${candidate.name}": ${errMsg}`);
        errors.push({ candidateId: candidate.id, name: candidate.name, error: errMsg });
      }

      // 4s cooldown between candidates — safe for 15 RPM (gemini-2.0-flash)
      if (i < candidates.length - 1) {
        await sleep(4000);
      }
    }

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
