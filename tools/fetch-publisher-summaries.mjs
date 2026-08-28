import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const indexPath = path.join(root, 'index.html');
const auditPath = path.join(root, 'data', 'publisher-summary-audit.json');
const verifiedAt = '2026-08-29';
const arrayNames = ['IMPORTED_BOOKS', 'AI_BUSINESS_BOOKS', 'RECENT_AI_BUSINESS_BOOKS', 'SELF_HELP_SERIES_BOOKS', 'RECENT_GENRE_BOOKS'];

function parseArray(html, name) {
  const match = html.match(new RegExp(`const ${name}=(\\[[\\s\\S]*?\\]);`));
  if (!match) throw new Error(`Missing ${name}`);
  return JSON.parse(match[1]);
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanHtml(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function wordExcerpt(value, maxWords = 70) {
  const words = cleanHtml(value).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length <= maxWords) return words.join(' ');
  const excerpt = words.slice(0, maxWords).join(' ');
  const lastSentence = Math.max(excerpt.lastIndexOf('.'), excerpt.lastIndexOf('!'), excerpt.lastIndexOf('?'));
  return `${lastSentence > excerpt.length * 0.55 ? excerpt.slice(0, lastSentence + 1) : excerpt}…`;
}

function officialExcerpt(product) {
  const paragraphs = String(product.publisher_summary ?? '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .split(/\n+/)
    .map(cleanHtml)
    .filter((paragraph) => paragraph.length >= 80)
    .filter((paragraph) => !/^(?:(?:an?\s+)?(?:instant\s+)?(?:#1\s+)?(?:new york times|usa today|wall street journal)|national bestseller|one of .{0,50}best books)\b/i.test(paragraph))
    .filter((paragraph) => !/(?:best book of the year|shortlisted for|winner of|book award)/i.test(paragraph))
    .filter((paragraph) => {
      const letters = paragraph.match(/[a-z]/gi) ?? [];
      const uppercase = paragraph.match(/[A-Z]/g) ?? [];
      return letters.length < 20 || uppercase.length / letters.length < 0.65;
    })
    .filter((paragraph) => !/^(?:please note|copyright|©|“|\")/i.test(paragraph));
  if (paragraphs[0]) return wordExcerpt(paragraphs.slice(0, 2).join(' '), 70);
  return wordExcerpt(product.merchandising_summary || product.publisher_summary, 70);
}

async function fetchProduct(asin, attempt = 1) {
  const groups = 'contributors,product_desc,product_extended_attrs,category_ladders,media,rating,series';
  const response = await fetch(`https://api.audible.com/1.0/catalog/products/${asin}?response_groups=${groups}&image_sizes=500`);
  if (!response.ok) {
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return fetchProduct(asin, attempt + 1);
    }
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()).product;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const html = fs.readFileSync(indexPath, 'utf8');
const books = arrayNames.flatMap((name) => parseArray(html, name));
const byAsin = new Map(books.filter((book) => book.audible_asin).map((book) => [book.audible_asin, book]));
const entries = await mapLimit([...byAsin], 8, async ([asin, book], index) => {
  try {
    const product = await fetchProduct(asin);
    const text = officialExcerpt(product);
    process.stdout.write(`\r${index + 1}/${byAsin.size}`);
    return [asin, {
      text,
      language: product.language || 'english',
      publisher: product.publisher_name || null,
      source: 'Audible / publisher',
      source_url: book.audible_url,
      verified_at: verifiedAt,
      cover_url: product.product_images?.['500'] || product.product_images?.['475'] || product.product_images?.['300'] || product.product_images?.['200'] || null,
      series: (product.series ?? []).map((item) => ({ name: item.title, sequence: item.sequence, asin: item.asin })),
      status: text ? 'verified' : 'missing'
    }];
  } catch (error) {
    return [asin, {
      text: '',
      language: null,
      publisher: null,
      source: 'Audible / publisher',
      source_url: book.audible_url,
      verified_at: verifiedAt,
      status: 'error',
      error: error.message
    }];
  }
});

const summaries = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b, 'en')));
const verified = Object.values(summaries).filter((entry) => entry.status === 'verified');
const unresolved = Object.entries(summaries).filter(([, entry]) => entry.status !== 'verified');
const audit = {
  generated_at: verifiedAt,
  source: 'Audible catalog API product_desc (publisher-supplied product copy)',
  excerpt_policy: 'Up to 70 words from the official merchandising or publisher summary; no invented facts.',
  requested: byAsin.size,
  verified: verified.length,
  covers: Object.values(summaries).filter((entry) => entry.cover_url).length,
  unresolved: unresolved.map(([asin, entry]) => ({ asin, status: entry.status, error: entry.error ?? null }))
};
fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`);

const serialized = JSON.stringify(summaries);
const declaration = `const PUBLISHER_SUMMARIES=${serialized};`;
let nextHtml;
if (/const PUBLISHER_SUMMARIES=\{[\s\S]*?\};\r?\nconst AI_BUSINESS_OVERRIDES=/.test(html)) {
  nextHtml = html.replace(/const PUBLISHER_SUMMARIES=\{[\s\S]*?\};\r?\n(?=const AI_BUSINESS_OVERRIDES=)/, `${declaration}\n`);
} else {
  nextHtml = html.replace(/(?=const AI_BUSINESS_OVERRIDES=)/, `${declaration}\n`);
}
fs.writeFileSync(indexPath, nextHtml);
process.stdout.write(`\nEmbedded ${verified.length}/${byAsin.size} verified publisher summaries.\n`);
if (unresolved.length) process.stdout.write(`Unresolved: ${unresolved.length}. See ${auditPath}\n`);
