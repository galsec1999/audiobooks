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
const htmlFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, 'en'));

if (!config.homepage || typeof config.homepage !== 'string') {
  fail('site.config.json must define a homepage string.');
} else if (!htmlFiles.includes(config.homepage)) {
  fail(`Configured homepage does not exist: ${config.homepage}`);
}

if (htmlFiles.length === 0) {
  fail('At least one HTML file is required in the project root.');
}

for (const filename of htmlFiles) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
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

const sitemapFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^sitemap(?:\.|$)/i.test(entry.name));
if (sitemapFiles.length > 0) fail('Sitemap files are not allowed for this link-only site.');

if (failures.length > 0) {
  console.error(failures.map((message) => `FAIL: ${message}`).join('\n'));
  process.exit(1);
}

console.log(`PASS: validated ${htmlFiles.length} HTML page(s); homepage=${config.homepage}.`);
