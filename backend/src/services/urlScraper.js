const axios = require('axios');
const cheerio = require('cheerio');

// Browser-like headers to avoid bot detection
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Scrape the job description text from a URL.
 * Supports Indeed, LinkedIn, Glassdoor, and generic pages.
 * @param {string} url
 * @returns {Promise<{ title: string, description: string }>}
 */
const scrapeJobUrl = async (url) => {
  const response = await axios.get(url, {
    headers: HEADERS,
    timeout: 10000,
    maxRedirects: 5,
  });

  const $ = cheerio.load(response.data);

  // Remove noise: scripts, styles, nav, footer, ads
  $('script, style, nav, footer, header, iframe, noscript, [aria-hidden="true"]').remove();

  const hostname = new URL(url).hostname.toLowerCase();
  let title = '';
  let description = '';

  // ── Indeed ──────────────────────────────────────────────────────────────────
  if (hostname.includes('indeed.com')) {
    title = $('h1.jobsearch-JobInfoHeader-title, h1[data-testid="simpler-jobTitle"], h1').first().text().trim();
    description = $(
      '#jobDescriptionText, .jobsearch-jobDescriptionText, [data-testid="jobDescription"]'
    ).text().trim();

    // Indeed sometimes loads via JS — try meta description as fallback
    if (!description) {
      description = $('meta[name="description"]').attr('content') || '';
    }
  }
  // ── LinkedIn ─────────────────────────────────────────────────────────────────
  else if (hostname.includes('linkedin.com')) {
    title = $('.top-card-layout__title, h1').first().text().trim();
    description = $('.description__text, .show-more-less-html__markup').text().trim();
  }
  // ── Glassdoor ────────────────────────────────────────────────────────────────
  else if (hostname.includes('glassdoor.com')) {
    title = $('[data-test="job-title"], h1').first().text().trim();
    description = $('[data-test="jobDescriptionContent"], .jobDescriptionContent').text().trim();
  }
  // ── Generic fallback: grab the largest text block ────────────────────────────
  else {
    title = $('h1').first().text().trim() || $('title').text().trim();
    // Look for elements likely to contain a job description
    const candidates = [
      'main',
      'article',
      '[class*="description"]',
      '[class*="job-detail"]',
      '[class*="posting"]',
      '[id*="description"]',
      'body',
    ];
    for (const sel of candidates) {
      const text = $(sel).text().trim();
      if (text.length > 200) {
        description = text;
        break;
      }
    }
  }

  // Fallback: whole page body text if nothing specific found
  if (!description || description.length < 100) {
    description = $('body').text().replace(/\s+/g, ' ').trim();
  }

  if (!description || description.length < 50) {
    throw new Error(
      'Could not extract job description from this URL. ' +
      'The page may require login or is dynamically loaded. ' +
      'Please paste the job description text directly instead.'
    );
  }

  // Normalize whitespace
  description = description.replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  // Trim to 5000 chars for AI processing
  if (description.length > 5000) description = description.substring(0, 5000) + '...';

  return { title: title || 'Untitled Job', description };
};

module.exports = { scrapeJobUrl };
