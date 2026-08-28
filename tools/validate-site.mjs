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
  if (!html.includes('📖 תקצירים והעמקה') || !html.includes('duration_seconds)<1200')) {
    fail(`${prefix} missing the verified long-form resources gate.`);
  }
  if (!html.includes('value="rating"') || !html.includes('value="ratings"') || !html.includes('value="new"')) {
    fail(`${prefix} missing required rating, ratings-count, or newest sort options.`);
  }
  if (!html.includes('reliableAudibleSalesDataset') || !html.includes('audible_sales_verified===true')) {
    fail(`${prefix} missing the verified-complete Audible sales sort gate.`);
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

for (const required of ['.nojekyll', 'robots.txt', 'AGENTS.md', 'README.md']) {
  if (!fs.existsSync(path.join(root, required))) fail(`Missing required file: ${required}`);
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
