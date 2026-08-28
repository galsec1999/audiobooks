import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const sourcePath = process.argv[2];
const verifiedAt = process.argv[3] || new Date().toISOString().slice(0, 10);
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error('Usage: node tools/import-audible-candidates.mjs <candidates.csv> [YYYY-MM-DD]');
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function normalized(value) {
  return String(value ?? '')
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function authorTokens(value) {
  const ignored = new Set(['and', 'the', 'dr', 'md', 'phd', 'jr', 'sr']);
  return normalized(value).split(' ').filter((token) => token.length > 1 && !ignored.has(token));
}

function authorMatch(csvAuthor, productAuthors) {
  const expected = authorTokens(csvAuthor);
  const actual = authorTokens(productAuthors.map((author) => author.name).join(' and '));
  if (!expected.length || !actual.length) return 0;
  const equivalent = (left, right) => left === right
    || (Math.min(left.length, right.length) >= 3 && (left.startsWith(right) || right.startsWith(left)));
  return expected.filter((token) => actual.some((candidate) => equivalent(token, candidate))).length / expected.length;
}

const topicMap = {
  productivity: 'הרגלים ופרודוקטיביות',
  habits: 'הרגלים ופרודוקטיביות',
  career: 'קריירה ויצירתיות',
  health: 'בריאות ורווחה',
  psychology: 'פסיכולוגיה ומיינדסט',
  communication: 'תקשורת ויחסים',
  leadership: 'מנהיגות ועסקים',
  business: 'מנהיגות ועסקים',
  money: 'כסף ועושר',
};

const categorySignals = {
  productivity: ['time management', 'personal development', 'career success', 'motivation', 'organizational behavior'],
  habits: ['personal development', 'time management', 'personal success', 'motivation'],
  career: ['career success', 'business & careers', 'employment', 'personal success'],
  health: ['health & wellness', 'stress management', 'fitness', 'personal development', 'psychology'],
  psychology: ['psychology', 'mental health', 'personal development', 'personal success', 'self-esteem'],
  communication: ['communication', 'relationships', 'social skills', 'negotiation', 'business & careers'],
  leadership: ['management & leadership', 'business & careers', 'workplace', 'organizational behavior'],
  business: ['business & careers', 'entrepreneurship', 'management', 'marketing', 'sales'],
  money: ['money & finance', 'personal finance', 'investing', 'business & careers', 'wealth'],
};

function categoryText(product) {
  return (product.category_ladders ?? [])
    .flatMap((entry) => (entry.ladder ?? []).map((part) => part.name ?? ''))
    .join(' > ')
    .toLocaleLowerCase('en');
}

function topicCompatible(product, subtopic) {
  const text = categoryText(product);
  return Boolean(topicMap[subtopic]) && (categorySignals[subtopic] ?? []).some((signal) => text.includes(signal));
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'AudiobooksCatalogImporter/1.0' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

const responseGroups = 'contributors,product_desc,product_extended_attrs,category_ladders,media';
async function productByAsin(asin) {
  const url = `https://api.audible.com/1.0/catalog/products?asins=${encodeURIComponent(asin)}&num_results=1&response_groups=${responseGroups}`;
  return (await fetchJson(url)).products?.[0] ?? null;
}

async function findProduct(row) {
  const supplied = row['Audible US URL or ASIN'];
  const suppliedAsin = supplied.match(/(?:\/|^)(B[0-9A-Z]{9}|[0-9]{9}[0-9X])$/)?.[1] ?? null;
  let products;
  if (suppliedAsin) products = [await productByAsin(suppliedAsin)].filter(Boolean);
  else {
    const keywords = encodeURIComponent(`${row.Title} ${row.Author}`);
    const url = `https://api.audible.com/1.0/catalog/products?keywords=${keywords}&num_results=10&products_sort_by=Relevance&response_groups=${responseGroups}`;
    products = (await fetchJson(url)).products ?? [];
  }
  const expectedTitle = normalized(row.Title);
  return products
    .map((product, index) => ({
      product,
      index,
      exactTitle: normalized(product.title) === expectedTitle,
      authorScore: authorMatch(row.Author, product.authors ?? []),
      compatible: topicCompatible(product, row.Subtopic),
    }))
    .filter((candidate) => candidate.exactTitle
      && candidate.authorScore >= 0.8
      && candidate.compatible
      && candidate.product.is_listenable === true
      && candidate.product.asin
      && candidate.product.release_date
      && (candidate.product.narrators ?? []).length > 0
      && Number.isFinite(candidate.product.runtime_length_min))
    .sort((a, b) => {
      const score = (candidate) => (candidate.product.language === 'english' ? 8 : 0)
        + (candidate.product.format_type === 'unabridged' ? 4 : 0)
        + (candidate.product.is_purchasability_suppressed ? 0 : 2)
        + candidate.authorScore;
      return score(b) - score(a) || a.index - b.index;
    })[0]?.product ?? null;
}

function importedBook(row, product) {
  const topic = topicMap[row.Subtopic];
  return {
    title: product.title,
    author: product.authors.map((author) => author.name).join(' & '),
    year: Number(product.release_date.slice(0, 4)),
    category: topic,
    genre: 'Self-Help',
    topic,
    focus: null,
    source: `Audible verified · ${verifiedAt}`,
    rank: null,
    sales: null,
    rating_count: null,
    rating_avg: null,
    summary_he: 'לא נוסף תקציר מאומת לרשומה זו.',
    narrator: product.narrators.map((narrator) => narrator.name).join(' & '),
    audible_asin: product.asin,
    audible_url: `https://www.audible.com/pd/${product.asin}`,
    audible_release_date: product.release_date,
    audible_format: product.format_type ?? null,
    audible_runtime_minutes: product.runtime_length_min,
    audible_verified: true,
    audible_verified_at: verifiedAt,
    resources: [],
  };
}

const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const originalBooks = JSON.parse(html.match(/const BOOKS=(\[[\s\S]*?\]);/)?.[1] ?? '[]');
const rows = parseCsv(fs.readFileSync(sourcePath, 'utf8'));
const originalKeys = new Set(originalBooks.map((book) => `${normalized(book.title)}|${normalized(book.author)}`));
const sourceKeys = new Set();
const accepted = [];
const rejected = [];
let cursor = 0;

async function worker() {
  while (cursor < rows.length) {
    const index = cursor; cursor += 1;
    const row = rows[index];
    const key = `${normalized(row.Title)}|${normalized(row.Author)}`;
    if (!row.Title || !row.Author || !topicMap[row.Subtopic]) {
      rejected.push({ row: index + 2, title: row.Title, author: row.Author, reason: 'invalid_source_fields' });
      continue;
    }
    if (sourceKeys.has(key)) {
      rejected.push({ row: index + 2, title: row.Title, author: row.Author, reason: 'duplicate_in_source' });
      continue;
    }
    sourceKeys.add(key);
    if (originalKeys.has(key)) {
      rejected.push({ row: index + 2, title: row.Title, author: row.Author, reason: 'duplicate_existing_catalog' });
      continue;
    }
    try {
      const product = await findProduct(row);
      if (!product) rejected.push({ row: index + 2, title: row.Title, author: row.Author, reason: 'no_strict_audible_match' });
      else accepted.push({ index, row, book: importedBook(row, product), categories: categoryText(product) });
    } catch (error) {
      rejected.push({ row: index + 2, title: row.Title, author: row.Author, reason: 'audible_request_failed', detail: error.message });
    }
    const done = accepted.length + rejected.length;
    if (done % 25 === 0) console.log(`Audited ${done}/${rows.length}: accepted=${accepted.length}, rejected=${rejected.length}`);
  }
}

await Promise.all(Array.from({ length: 6 }, () => worker()));
accepted.sort((a, b) => a.index - b.index);
rejected.sort((a, b) => a.row - b.row);

const asinSeen = new Set();
const books = [];
for (const item of accepted) {
  if (asinSeen.has(item.book.audible_asin)) {
    rejected.push({ row: item.index + 2, title: item.row.Title, author: item.row.Author, reason: 'duplicate_audible_asin' });
  } else {
    asinSeen.add(item.book.audible_asin);
    books.push(item.book);
  }
}

const replacement = `const IMPORTED_BOOKS=${JSON.stringify(books)};`;
const updatedHtml = html.replace(/const IMPORTED_BOOKS=\[[\s\S]*?\];/, replacement);
if (updatedHtml === html) throw new Error('Could not replace IMPORTED_BOOKS in index.html.');
fs.writeFileSync(htmlPath, updatedHtml, 'utf8');

const reasonCounts = Object.fromEntries([...new Set(rejected.map((item) => item.reason))]
  .sort()
  .map((reason) => [reason, rejected.filter((item) => item.reason === reason).length]));
const audit = {
  source: path.basename(sourcePath),
  verified_at: verifiedAt,
  candidate_rows: rows.length,
  original_catalog_rows: originalBooks.length,
  imported_rows: books.length,
  rejected_rows: rejected.length,
  rejection_reasons: reasonCounts,
  imported: books.map((book) => ({ title: book.title, author: book.author, asin: book.audible_asin })),
  rejected,
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'import-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ imported: books.length, rejected: rejected.length, reasons: reasonCounts }, null, 2));
