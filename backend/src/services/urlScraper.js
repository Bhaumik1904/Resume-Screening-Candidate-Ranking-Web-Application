const axios = require('axios');
const cheerio = require('cheerio');

// Browser-like headers for direct fetch attempts
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// Known sites that block server-side scraping
const BLOCKED_SITES = ['indeed.com', 'linkedin.com', 'glassdoor.com', 'naukri.com', 'monster.com'];
const isBlocked = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_SITES.some((s) => host.includes(s));
  } catch {
    return false;
  }
};

/**
 * Extract structured text from raw HTML using cheerio.
 */
const extractFromHtml = (html, url) => {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, iframe, noscript, [aria-hidden="true"]').remove();

  const hostname = new URL(url).hostname.toLowerCase();
  let title = '';
  let description = '';

  if (hostname.includes('indeed.com')) {
    title       = $('h1').first().text().trim();
    description = $('#jobDescriptionText, .jobsearch-jobDescriptionText, [data-testid="jobDescription"]').text().trim();
    if (!description) description = $('meta[name="description"]').attr('content') || '';
  } else if (hostname.includes('linkedin.com')) {
    title       = $('.top-card-layout__title, h1').first().text().trim();
    description = $('.description__text, .show-more-less-html__markup').text().trim();
  } else if (hostname.includes('glassdoor.com')) {
    title       = $('[data-test="job-title"], h1').first().text().trim();
    description = $('[data-test="jobDescriptionContent"], .jobDescriptionContent').text().trim();
  } else {
    title = $('h1').first().text().trim() || $('title').text().trim();
    for (const sel of ['main', 'article', '[class*="description"]', '[class*="job-detail"]', '[class*="posting"]', '[id*="description"]', 'body']) {
      const text = $(sel).text().trim();
      if (text.length > 200) { description = text; break; }
    }
  }

  if (!description || description.length < 100) {
    description = $('body').text().replace(/\s+/g, ' ').trim();
  }

  description = description.replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (description.length > 5000) description = description.substring(0, 5000) + '...';

  return { title: title || 'Untitled Job', description };
};

/**
 * Attempt fetch via AllOrigins public CORS proxy.
 * Works for many sites that block direct server requests.
 */
const fetchViaProxy = async (url) => {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const response = await axios.get(proxyUrl, { timeout: 15000 });
  if (!response.data?.contents) throw new Error('Proxy returned empty response');
  return response.data.contents;
};

/**
 * Scrape the job description text from a URL.
 * Strategy:
 *   1. For known blocked sites → try proxy immediately (skip direct fetch)
 *   2. For unknown sites → try direct fetch first, proxy as fallback on 403/blocked
 *   3. If everything fails → throw a user-friendly error with paste instructions
 *
 * @param {string} url
 * @returns {Promise<{ title: string, description: string }>}
 */
const scrapeJobUrl = async (url) => {
  let html = null;
  const blocked = isBlocked(url);

  // ── Try direct fetch (skip for known blocked sites) ──────────────────────────
  if (!blocked) {
    try {
      const response = await axios.get(url, { headers: HEADERS, timeout: 10000, maxRedirects: 5 });
      html = response.data;
      console.log(`[Scraper] Direct fetch succeeded for: ${url}`);
    } catch (err) {
      console.warn(`[Scraper] Direct fetch failed (${err.response?.status || err.message}), trying proxy...`);
    }
  } else {
    console.log(`[Scraper] Known blocked site — using proxy directly for: ${url}`);
  }

  // ── Fallback: public proxy ───────────────────────────────────────────────────
  if (!html) {
    try {
      html = await fetchViaProxy(url);
      console.log(`[Scraper] Proxy fetch succeeded for: ${url}`);
    } catch (proxyErr) {
      console.error(`[Scraper] Proxy also failed: ${proxyErr.message}`);
    }
  }

  if (!html) {
    const siteName = blocked
      ? new URL(url).hostname.replace('www.', '').replace('in.', '')
      : 'this site';

    throw new Error(
      `${siteName.charAt(0).toUpperCase() + siteName.slice(1)} blocks automated access to job pages. ` +
      `Please copy the job description text from your browser and paste it in the "Paste Text" tab instead.`
    );
  }

  const { title, description } = extractFromHtml(html, url);

  if (!description || description.length < 50) {
    throw new Error(
      'Could not extract the job description text from this page. ' +
      'It may require login or is dynamically loaded. ' +
      'Please paste the job description manually instead.'
    );
  }

  return { title, description };
};

module.exports = { scrapeJobUrl };
