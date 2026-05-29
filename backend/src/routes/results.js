const express = require('express');
const path = require('path');
const fs = require('fs');
const { getJobById, getResultsByJob } = require('../db/queries');
const { generateCSV, generateExcel } = require('../services/exportService');

const router = express.Router();

// ─── GET /api/results/:jobId ──────────────────────────────────────────────────
// Returns all ranked candidates with scores for a given job session
router.get('/:jobId', async (req, res) => {
  const { jobId } = req.params;

  try {
    const job = await getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job session not found.' });
    }

    const results = await getResultsByJob(jobId);

    // Compute summary statistics
    const scores = results.map((r) => r.total_score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const topScore = scores.length ? Math.max(...scores) : 0;
    const qualified = scores.filter((s) => s >= 70).length;

    res.json({
      jobId,
      jobTitle: job.title,
      jobDescription: job.description,
      createdAt: job.created_at,
      stats: {
        totalCandidates: results.length,
        averageScore: avgScore,
        topScore,
        qualifiedCandidates: qualified,
      },
      candidates: results,
    });
  } catch (err) {
    console.error('[Results Route] Error:', err);
    res.status(500).json({ error: 'Failed to fetch results.', details: err.message });
  }
});

// ─── GET /api/results/:jobId/export?format=csv|excel ─────────────────────────
router.get('/:jobId/export', async (req, res) => {
  const { jobId } = req.params;
  const format = (req.query.format || 'csv').toLowerCase();

  try {
    const job = await getJobById(jobId);
    if (!job) return res.status(404).json({ error: 'Job session not found.' });

    const results = await getResultsByJob(jobId);
    if (results.length === 0) {
      return res.status(400).json({ error: 'No results to export. Run analysis first.' });
    }

    const safeName = (job.title || 'results').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = new Date().toISOString().slice(0, 10);

    if (format === 'excel' || format === 'xlsx') {
      const buffer = await generateExcel(results, job.title);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${timestamp}.xlsx"`);
      return res.send(buffer);
    }

    // Default: CSV
    const csv = generateCSV(results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${timestamp}.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error('[Export Route] Error:', err);
    res.status(500).json({ error: 'Export failed.', details: err.message });
  }
});

// ─── GET /api/results/:jobId/resume/:candidateId ──────────────────────────────
// Serve the raw resume file for preview
router.get('/:jobId/resume/:fileName', (req, res) => {
  const { fileName } = req.params;
  const uploadsDir = path.join(__dirname, '../../uploads');
  const filePath = path.join(uploadsDir, fileName);

  // Security: ensure the resolved path stays within uploads dir
  if (!filePath.startsWith(uploadsDir)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Resume file not found.' });
  }

  res.sendFile(filePath);
});

module.exports = router;
