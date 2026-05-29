const express = require('express');
const { scrapeJobUrl } = require('../services/urlScraper');

const router = express.Router();

// ─── POST /api/scrape-url ─────────────────────────────────────────────────────
// Fetches a job posting URL and returns the extracted job description text.
router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format. Please enter a valid job posting URL.' });
  }

  try {
    console.log(`[ScrapeURL] Fetching: ${url}`);
    const { title, description } = await scrapeJobUrl(url);
    console.log(`[ScrapeURL] Extracted ${description.length} chars for: "${title}"`);
    res.json({ title, description });
  } catch (err) {
    console.error('[ScrapeURL] Error:', err.message);
    res.status(422).json({
      error: err.message || 'Failed to fetch job description from this URL.',
    });
  }
});

module.exports = router;
