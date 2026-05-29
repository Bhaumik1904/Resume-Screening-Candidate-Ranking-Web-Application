const express = require('express');
const { getJobById, getCandidatesByJob, upsertScore, updateRanks } = require('../db/queries');
const { scoreResume, scoreResumeWithVision } = require('../services/aiScorer');

const router = express.Router();

// Gemini free tier = 10 RPM. Process one candidate at a time with a 7s gap.
const DELAY_MS = 7000;
const sleep    = (ms) => new Promise((r) => setTimeout(r, ms));

// Threshold: PDFs with fewer than this many characters are image-based
const IMAGE_PDF_THRESHOLD = 100;

// ─── POST /api/analyze/:jobId ─────────────────────────────────────────────────
router.post('/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await getJobById(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found. Please upload resumes first.' });

    const candidates = await getCandidatesByJob(jobId);
    if (candidates.length === 0) return res.status(400).json({ error: 'No candidates found for this job.' });

    console.log(`[Analyze] Starting sequential scoring of ${candidates.length} candidates for: "${job.title}"`);
    console.log(`[Analyze] Estimated time: ~${Math.ceil(candidates.length * DELAY_MS / 1000)}s (7s gap between calls)`);

    const results = [];
    const errors  = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const isImagePDF = !candidate.raw_text || candidate.raw_text.trim().length < IMAGE_PDF_THRESHOLD;
      const method     = isImagePDF ? 'Vision OCR+Score' : 'Text Score';

      console.log(`[Analyze] (${i + 1}/${candidates.length}) ${method}: ${candidate.name || candidate.file_name}`);

      try {
        let scoreData;
        if (isImagePDF) {
          // Image-based PDF: send raw file to Gemini Vision — OCR + scoring in ONE call
          scoreData = await scoreResumeWithVision(candidate.file_path, job.description);
        } else {
          // Text-based PDF/DOCX/TXT: use extracted text for scoring
          scoreData = await scoreResume(candidate.raw_text, job.description);
        }

        // Use AI-extracted name if heuristic gave "Unknown Candidate"
        const resolvedName =
          (!candidate.name || candidate.name === 'Unknown Candidate') &&
          scoreData.candidateName !== 'Unknown Candidate'
            ? scoreData.candidateName
            : candidate.name || 'Unknown Candidate';

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
        console.error(`[Analyze] ✗ ${candidate.name || candidate.file_name}: ${errMsg}`);
        errors.push({ candidateId: candidate.id, name: candidate.name, error: errMsg });
      }

      // Pause between API calls (skip after the last one)
      if (i < candidates.length - 1) {
        console.log(`[Analyze] Waiting ${DELAY_MS / 1000}s before next...`);
        await sleep(DELAY_MS);
      }
    }

    await updateRanks(jobId);

    if (results.length === 0) {
      return res.status(500).json({
        error: `AI analysis failed for all candidates. ${errors[0]?.error || 'Check your Gemini API key and quota.'}`,
        errors,
      });
    }

    const message = `Scoring complete. ${results.length}/${candidates.length} candidates analyzed.`;
    console.log(`[Analyze] ${message}`);

    res.json({
      jobId,
      jobTitle:        job.title,
      totalCandidates: candidates.length,
      scored:          results.length,
      failed:          errors.length,
      results,
      errors:  errors.length > 0 ? errors : undefined,
      message,
    });
  } catch (err) {
    console.error('[Analyze Route] Unexpected error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.', details: err.message });
  }
});

module.exports = router;
