import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const configPath = path.join(root, 'site.config.json');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!fs.existsSync(configPath)) {
  throw new Error('Missing required file: site.config.json');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
function validateHtml(filename, html) {
  const prefix = `${filename}:`;

  if (!/^\s*<!doctype html>/i.test(html)) fail(`${prefix} missing HTML5 doctype.`);
  if (!/<html\b[^>]*\blang=["']he["'][^>]*\bdir=["']rtl["'][^>]*>/i.test(html)
      && !/<html\b[^>]*\bdir=["']rtl["'][^>]*\blang=["']he["'][^>]*>/i.test(html)) {
    fail(`${prefix} must declare lang="he" and dir="rtl" on the html element.`);
  }
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${prefix} missing a non-empty title.`);
  if (!/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i.test(html)) fail(`${prefix} missing viewport metadata.`);
  const robotsMeta = html.match(/<meta\b[^>]*\bname=["']robots["'][^>]*>/i)?.[0] ?? '';
  if (!/\bcontent=["'][^"']*\bnoindex\b[^"']*\bnofollow\b[^"']*["']/i.test(robotsMeta)) {
    fail(`${prefix} must declare robots noindex,nofollow.`);
  }
  if (html.includes('\uFFFD')) fail(`${prefix} contains Unicode replacement characters.`);
  if (/\bfile:\/\//i.test(html)) fail(`${prefix} contains a file:// URL.`);
  if (/["'(]\\?[A-Za-z]:\\/.test(html)) fail(`${prefix} contains a local Windows path.`);
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) fail(`${prefix} loads an external script.`);
  if (/(?:src|poster)\s*=\s*["']https?:\/\//i.test(html)) fail(`${prefix} loads an external media resource.`);
  if (/url\(\s*["']?https?:\/\//i.test(html) || /@import\s+url/i.test(html)) {
    fail(`${prefix} loads an external stylesheet resource.`);
  }
  if (/google-analytics|googletagmanager|\bgtag\s*\(|segment\.com|mixpanel|hotjar|clarity\.ms|connect\.facebook|facebook\.net|matomo|plausible|umami/i.test(html)) {
    fail(`${prefix} contains an analytics or tracking integration.`);
  }
  if (/<iframe\b/i.test(html)) fail(`${prefix} must not embed third-party frames.`);
  if (/youtube\.com\/shorts\//i.test(html)) fail(`${prefix} must not link to YouTube Shorts.`);
  if (!html.includes('id="genreNav"') || !html.includes('b.genre=b.genre||"Self-Help"')) {
    fail(`${prefix} missing the top-level genre model or navigation.`);
  }
  if (!html.includes('id="filtersToggle"') || !html.includes('aria-controls="filtersPanel"')
      || !html.includes('id="filtersPanel"') || !html.includes('.controls.filters-open .filters-panel')) {
    fail(`${prefix} missing the collapsible mobile filters panel.`);
  }
  if (!html.includes('📖 תקצירים והעמקה') || !html.includes('duration_seconds)<1200')) {
    fail(`${prefix} missing the verified long-form resources gate.`);
  }
  if (!html.includes('value="rating"') || !html.includes('value="ratings"') || !html.includes('value="new"')) {
    fail(`${prefix} missing required rating, ratings-count, or newest sort options.`);
  }
  if (!html.includes('reliableAudibleSalesDataset') || !html.includes('audible_sales_verified===true')) {
    fail(`${prefix} missing the verified-complete Audible sales sort gate.`);
  }
  if (!html.includes('id="view"') || !html.includes('value="series"') || !html.includes('seriesHTML(arr)')) {
    fail(`${prefix} missing the grouped series view.`);
  }
  if (!html.includes('🎧 שירותי אודיו נוספים') || !html.includes('open.spotify.com/search/')
      || !html.includes('libro.fm/search?query=')) {
    fail(`${prefix} missing clearly labelled alternative audiobook-service searches.`);
  }
  if (/books\.apple\.com|itunes\.apple\.com|appleCover\s*\(/i.test(html)) {
    fail(`${prefix} must not include Apple Books links, data, or cover fallbacks.`);
  }
  if (!/<link\b[^>]*rel=["']manifest["'][^>]*href=["']manifest\.webmanifest["']/i.test(html)
      || !html.includes('serviceWorker.register("./sw.js")') || !html.includes('id="installBtn"')) {
    fail(`${prefix} missing the installable PWA wiring or install control.`);
  }
  const staticMarkup = html.split(/<script\b/i, 1)[0];
  if (/<option\s+value=["']sales["']/i.test(staticMarkup)) {
    fail(`${prefix} must not expose a static sales sort without a complete verified Audible dataset.`);
  }
}

const htmlFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, 'en'));

if (!config.homepage || typeof config.homepage !== 'string') {
  fail('site.config.json must define a homepage string.');
} else if (!htmlFiles.includes(config.homepage)) {
  fail(`Configured homepage does not exist: ${config.homepage}`);
}

if (config.homepage !== 'index.html') {
  fail('The root Audiobooks site must use index.html as its homepage.');
}

if (htmlFiles.length === 0) {
  fail('At least one HTML file is required in the project root.');
}

for (const filename of htmlFiles) {
  validateHtml(filename, fs.readFileSync(path.join(root, filename), 'utf8'));
}

const homepageHtml = fs.existsSync(path.join(root, config.homepage ?? ''))
  ? fs.readFileSync(path.join(root, config.homepage), 'utf8')
  : '';
function parseBookArray(name) {
  const match = homepageHtml.match(new RegExp(`const ${name}=(\\[[\\s\\S]*?\\]);`));
  if (!match) {
    fail(`Missing ${name} data array.`);
    return [];
  }
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
    return [];
  }
}

const originalBooks = parseBookArray('BOOKS');
const importedBooks = parseBookArray('IMPORTED_BOOKS');
const aiBusinessBooks = parseBookArray('AI_BUSINESS_BOOKS');
const recentAiBusinessBooks = parseBookArray('RECENT_AI_BUSINESS_BOOKS');
const recentGenreBooks = parseBookArray('RECENT_GENRE_BOOKS');
const allBooks = [...originalBooks, ...importedBooks, ...aiBusinessBooks, ...recentAiBusinessBooks, ...recentGenreBooks];
let publisherSummaries = {};
try {
  const match = homepageHtml.match(/const PUBLISHER_SUMMARIES=(\{[\s\S]*?\});\r?\nconst AI_BUSINESS_OVERRIDES=/);
  if (!match) throw new Error('declaration not found');
  publisherSummaries = JSON.parse(match[1]);
} catch (error) {
  fail(`Missing or invalid PUBLISHER_SUMMARIES: ${error.message}`);
}
const importAuditPath = path.join(root, 'data', 'import-audit.json');
let importAudit = null;
try {
  importAudit = JSON.parse(fs.readFileSync(importAuditPath, 'utf8'));
} catch (error) {
  fail(`Missing or invalid import audit: ${error.message}`);
}
const normalizedKeys = new Set();
for (const book of allBooks) {
  const key = `${book.title ?? ''}|${book.author ?? ''}`
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (!key) fail('A book is missing a usable title or author.');
  else if (normalizedKeys.has(key)) fail(`Duplicate book detected: ${book.title} — ${book.author}.`);
  else normalizedKeys.add(key);
}
if (originalBooks.length !== 185
    || importedBooks.length !== importAudit?.imported_rows
    || aiBusinessBooks.length !== 22
    || recentAiBusinessBooks.length !== 5
    || recentGenreBooks.length !== 300
    || allBooks.length !== 185 + (importAudit?.imported_rows ?? 0) + 22 + 5 + 300
    || (importAudit?.imported_rows ?? 0) + (importAudit?.rejected_rows ?? 0) !== importAudit?.candidate_rows) {
  fail(`Unexpected catalog size: original=${originalBooks.length}, imported=${importedBooks.length}, ai-business=${aiBusinessBooks.length}, recent-genres=${recentGenreBooks.length}, total=${allBooks.length}.`);
}
for (const book of [...importedBooks, ...aiBusinessBooks, ...recentAiBusinessBooks]) {
  const asinPattern = /^(?:B[0-9A-Z]{9}|[0-9]{9}[0-9X])$/;
  const expectedUrl = new RegExp(`^https://www\\.audible\\.com/pd/(?:.+/)?${book.audible_asin}$`, 'i');
  if (book.genre !== 'Self-Help' || !book.topic) fail(`Imported book has invalid genre/topic: ${book.title}.`);
  if (book.audible_verified !== true || !asinPattern.test(book.audible_asin ?? '') || !expectedUrl.test(book.audible_url ?? '')) {
    fail(`Imported book lacks a verified Audible identity: ${book.title}.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(book.audible_release_date ?? '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(book.audible_verified_at ?? '')
      || !book.narrator || !Number.isFinite(book.audible_runtime_minutes)) {
    fail(`Imported book lacks verified audiobook metadata: ${book.title}.`);
  }
  if (!recentAiBusinessBooks.includes(book) && (book.sales != null || book.rating_avg != null || book.rating_count != null)) {
    fail(`Imported book contains unverified sales or rating data: ${book.title}.`);
  }
}
for (const book of recentAiBusinessBooks) {
  if (book.topic !== 'AI ועסקים' || book.category !== 'AI ועסקים'
      || book.audible_release_date < '2023-08-28'
      || !Number.isFinite(book.rating_avg) || book.rating_avg < 4.4
      || !Number.isInteger(book.rating_count) || book.rating_count < 100
      || book.rating_verified_at !== '2026-08-28') {
    fail(`Recent AI/business quality gate failed: ${book.title}.`);
  }
}
for (const genre of ['מדע בדיוני', 'מתח']) {
  const books = recentGenreBooks.filter((book) => book.genre === genre);
  if (books.length !== 150) fail(`${genre} must contain exactly 150 quality-gated recent books; found ${books.length}.`);
  for (const book of books) {
    if (book.audible_release_date < '2019-08-28' || book.audible_release_date > '2026-08-28'
        || book.year !== Number(book.audible_release_date.slice(0, 4))
        || !Number.isFinite(book.rating_avg) || book.rating_avg < 4.3
        || !Number.isInteger(book.rating_count) || book.rating_count < 100
        || book.rating_verified_at !== '2026-08-28'
        || book.audible_verified !== true || book.audible_format !== 'unabridged') {
      fail(`Recent ${genre} quality gate failed: ${book.title}.`);
    }
  }
}
const booksNeedingPublisherSummary = [...importedBooks, ...aiBusinessBooks, ...recentAiBusinessBooks, ...recentGenreBooks];
for (const book of booksNeedingPublisherSummary) {
  const summary = publisherSummaries[book.audible_asin];
  if (summary?.status !== 'verified' || typeof summary.text !== 'string' || summary.text.trim().length < 40
      || typeof summary.text_he !== 'string' || summary.text_he.trim().length < 40 || !/[\u0590-\u05ff]/.test(summary.text_he)
      || summary.source !== 'Audible / publisher' || !/^https:\/\/www\.audible\.com\/pd\//i.test(summary.source_url ?? '')) {
    fail(`Missing a verified publisher summary: ${book.title}.`);
  }
}
if (aiBusinessBooks.some((book) => book.topic !== 'AI ועסקים' || book.category !== 'AI ועסקים')
    || !homepageHtml.includes('"Co-Intelligence|Ethan Mollick"')
    || !homepageHtml.includes('"The AI-Driven Leader|Geoff Woods"')
    || !homepageHtml.includes('"The Nvidia Way|Tae Kim"')) {
  fail('The AI and business topic or its existing-book overrides are incomplete.');
}

for (const required of ['.nojekyll', 'robots.txt', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'AGENTS.md', 'README.md', 'IMPORT_REPORT.md', 'AI_BUSINESS_REPORT.md', 'RECENT_GENRES_REPORT.md', 'data/import-audit.json', 'data/publisher-summary-audit.json', 'data/recent-genres-audit.json', 'data/hebrew-summary-translation-audit.json']) {
  if (!fs.existsSync(path.join(root, required))) fail(`Missing required file: ${required}`);
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  if (manifest.start_url !== './' || manifest.scope !== './' || manifest.display !== 'standalone'
      || !Array.isArray(manifest.icons) || !manifest.icons.some((icon) => icon.sizes === '192x192')
      || !manifest.icons.some((icon) => icon.sizes === '512x512')) {
    fail('manifest.webmanifest is missing the required relative-scope install metadata or icons.');
  }
} catch (error) {
  fail(`Missing or invalid manifest.webmanifest: ${error.message}`);
}

try {
  const translationAudit = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hebrew-summary-translation-audit.json'), 'utf8'));
  if (translationAudit.source_summaries !== 741 || translationAudit.translated_to_hebrew !== 741
      || translationAudit.unresolved !== 0 || translationAudit.translations_under_40_characters !== 0
      || translationAudit.fallback_labeled_fragments !== 0) {
    fail('Hebrew summary translation audit is incomplete or contains low-quality fallbacks.');
  }
} catch (error) {
  fail(`Missing or invalid Hebrew translation audit: ${error.message}`);
}

const robots = fs.existsSync(path.join(root, 'robots.txt'))
  ? fs.readFileSync(path.join(root, 'robots.txt'), 'utf8')
  : '';
if (!/^User-agent:\s*\*\s*\r?\nDisallow:\s*\/\s*$/im.test(robots.trim())) {
  fail('robots.txt must block all crawlers with User-agent: * and Disallow: /.');
}

function findSitemaps(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '_site') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...findSitemaps(entryPath));
    else if (/^sitemap(?:\.|$)/i.test(entry.name)) found.push(entryPath);
  }
  return found;
}

const sitemapFiles = findSitemaps(root);
if (sitemapFiles.length > 0) fail('Sitemap files are not allowed for this link-only site.');

if (failures.length > 0) {
  console.error(failures.map((message) => `FAIL: ${message}`).join('\n'));
  process.exit(1);
}

console.log(`PASS: validated ${htmlFiles.length} HTML page(s); homepage=${config.homepage}.`);
