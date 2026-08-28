import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const indexPath = path.join(root, 'index.html');
const auditPath = path.join(root, 'data', 'self-help-series-audit.json');
const verifiedAt = '2026-08-29';
const minRating = 4.3;
const minRatingsCount = 25;
const targetSeries = 70;
const maxNewBooksPerSeries = 3;
const pagesPerCategory = 10;
const roots = [
  { id: '18574784011', required: 'Relationships, Parenting & Personal Development' },
  { id: '18574800011', required: 'Personal Development' },
  { id: '18572029011', required: 'Business & Careers' },
  { id: '18573370011', required: 'Health & Wellness' }
];

function parseArray(html, name) {
  const match = html.match(new RegExp(`const ${name}=(\\[[\\s\\S]*?\\]);`));
  return match ? JSON.parse(match[1]) : [];
}

function parseObject(html, name, nextName) {
  const match = html.match(new RegExp(`const ${name}=(\\{[\\s\\S]*?\\});\\r?\\nconst ${nextName}=`));
  return match ? JSON.parse(match[1]) : {};
}

function categories(product) {
  return [...new Set((product.category_ladders ?? []).flatMap((item) => item.ladder ?? []).map((item) => item.name))];
}

function topicFor(names) {
  const joined = names.join(' | ').toLowerCase();
  if (/parenting|famil/.test(joined)) return 'משפחה והורות';
  if (/relationship|marriage|dating/.test(joined)) return 'מערכות יחסים ותקשורת';
  if (/fitness|diet|nutrition|healthy living|aging|medicine|health/.test(joined)) return 'בריאות ורווחה';
  if (/meditation|stress|sleep|hypnosis/.test(joined)) return 'מיינדפולנס ורוגע';
  if (/marketing|sales|entrepreneur|business development/.test(joined)) return 'מנהיגות ועסקים';
  if (/career|workplace|management|leadership/.test(joined)) return 'קריירה וניהול';
  if (/communication|social skills/.test(joined)) return 'תקשורת והשפעה';
  if (/time management|personal success|self-esteem|emotions/.test(joined)) return 'הרגלים וצמיחה אישית';
  return 'התפתחות אישית';
}

function ratingCount(product) {
  return Number(product.rating?.overall_distribution?.num_ratings || 0);
}

function averageRating(product) {
  return Number(product.rating?.overall_distribution?.display_average_rating || 0);
}

function normalizedKey(title, author) {
  return `${title} ${author}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function productKey(product) {
  return normalizedKey(product.title, (product.authors ?? []).map((author) => author.name).join(' '));
}

function seriesKey(series) {
  const name = series?.title || series?.name;
  return name ? name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() : null;
}

function numericSequence(value) {
  const parsed = Number.parseFloat(String(value ?? '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function coverFor(product) {
  const images = product.product_images ?? {};
  return images['1000'] || images['500'] || images['475'] || images['300'] || images['200']
    || Object.values(images).filter((value) => typeof value === 'string').pop() || null;
}

async function childCategories(id) {
  const response = await fetch(`https://api.audible.com/1.0/catalog/categories/${id}`);
  if (!response.ok) throw new Error(`Audible categories ${response.status}: ${id}`);
  return (await response.json()).category?.children ?? [];
}

async function fetchPage(id, page) {
  const groups = 'contributors,product_desc,product_extended_attrs,rating,series,category_ladders,media';
  const url = `https://api.audible.com/1.0/catalog/products?category_id=${id}&products_sort_by=BestSellers&num_results=50&page=${page}&response_groups=${groups}&image_sizes=500`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audible ${response.status}: category ${id}, page ${page}`);
  return (await response.json()).products ?? [];
}

const html = fs.readFileSync(indexPath, 'utf8');
const existingNames = ['BOOKS', 'IMPORTED_BOOKS', 'AI_BUSINESS_BOOKS', 'RECENT_AI_BUSINESS_BOOKS', 'RECENT_GENRE_BOOKS'];
const existingBooks = existingNames.flatMap((name) => parseArray(html, name));
const summaries = parseObject(html, 'PUBLISHER_SUMMARIES', 'AI_BUSINESS_OVERRIDES');
const existingAsins = new Set(existingBooks.map((book) => book.audible_asin).filter(Boolean));
const existingBookKeys = new Set(existingBooks.map((book) => normalizedKey(book.title, book.author)));
const existingSeries = new Map();
for (const book of existingBooks.filter((item) => (item.genre || 'Self-Help') === 'Self-Help')) {
  const embedded = summaries[book.audible_asin]?.series?.[0];
  const series = book.series_name ? { title: book.series_name, asin: book.series_asin } : embedded;
  const key = seriesKey(series);
  if (key) existingSeries.set(key, series.title || series.name);
}

const rootChildren = await Promise.all(roots.map(async (config) => ({ config, children: await childCategories(config.id) })));
const categoryIds = [...new Set(rootChildren.flatMap(({ config, children }) => [config.id, ...children.map((child) => child.id)]))];
const requests = categoryIds.flatMap((id) => Array.from({ length: pagesPerCategory }, (_, index) => ({ id, page: index + 1 })));
const fetched = [];
for (let start = 0; start < requests.length; start += 10) {
  const pages = await Promise.all(requests.slice(start, start + 10).map(({ id, page }) => fetchPage(id, page)));
  fetched.push(...pages.flat());
}
const unique = [...new Map(fetched.map((product) => [product.asin, product])).values()];
const qualified = unique.filter((product) => {
  const names = categories(product);
  return product.asin && product.release_date <= verifiedAt
    && averageRating(product) >= minRating && ratingCount(product) >= minRatingsCount
    && product.format_type === 'unabridged' && product.language === 'english'
    && product.is_listenable !== false && product.publisher_summary && product.series?.[0]?.title
    && roots.some((rootConfig) => names.includes(rootConfig.required));
});
const groups = new Map();
for (const product of qualified) {
  const series = product.series[0];
  const key = seriesKey(series);
  if (!groups.has(key)) groups.set(key, { key, name: series.title, books: [] });
  groups.get(key).books.push(product);
}
const ranked = [...groups.values()].map((group) => {
  group.books.sort((a, b) => numericSequence(a.series?.[0]?.sequence) - numericSequence(b.series?.[0]?.sequence)
    || ratingCount(b) - ratingCount(a));
  group.totalRatings = group.books.reduce((sum, book) => sum + ratingCount(book), 0);
  group.averageRating = group.books.reduce((sum, book) => sum + averageRating(book), 0) / group.books.length;
  return group;
}).sort((a, b) => Number(b.books.length >= 2) - Number(a.books.length >= 2)
  || b.books.length - a.books.length || b.totalRatings - a.totalRatings
  || b.averageRating - a.averageRating || a.name.localeCompare(b.name, 'en'));

const selectedSeries = new Map(existingSeries);
const selectedGroups = [];
for (const group of ranked) {
  if (selectedSeries.size >= targetSeries && !selectedSeries.has(group.key)) continue;
  const hasImportableBook = group.books.some((product) => !existingAsins.has(product.asin) && !existingBookKeys.has(productKey(product)));
  if (!selectedSeries.has(group.key) && !hasImportableBook) continue;
  if (!selectedSeries.has(group.key)) selectedSeries.set(group.key, group.name);
  selectedGroups.push(group);
  if (selectedSeries.size >= targetSeries && ranked.every((candidate) => selectedSeries.has(candidate.key) || candidate.books.length < 2)) break;
}
if (selectedSeries.size < targetSeries) throw new Error(`Only ${selectedSeries.size} official quality-gated Self-Help series available.`);

const chosenKeys = new Set([...selectedSeries.keys()].slice(0, targetSeries));
const selectedProducts = [];
for (const group of ranked.filter((item) => chosenKeys.has(item.key))) {
  let added = 0;
  for (const product of group.books) {
    if (added >= maxNewBooksPerSeries) break;
    if (existingAsins.has(product.asin) || existingBookKeys.has(productKey(product))) continue;
    selectedProducts.push(product);
    existingAsins.add(product.asin);
    existingBookKeys.add(productKey(product));
    added += 1;
  }
}

const books = selectedProducts.map((product) => {
  const series = product.series[0];
  const topic = topicFor(categories(product));
  return {
    title: product.title,
    author: (product.authors ?? []).map((author) => author.name).join(' & '),
    year: Number(product.release_date.slice(0, 4)),
    category: topic,
    genre: 'Self-Help',
    topic,
    focus: null,
    source: `Audible Self-Help series quality gate · ${verifiedAt}`,
    rank: null,
    sales: null,
    rating_count: ratingCount(product),
    rating_avg: averageRating(product),
    rating_verified_at: verifiedAt,
    summary_he: 'לא נוסף תקציר מאומת לרשומה זו.',
    narrator: (product.narrators ?? []).map((narrator) => narrator.name).join(' & '),
    audible_asin: product.asin,
    audible_url: `https://www.audible.com/pd/${product.asin}`,
    audible_release_date: product.release_date,
    audible_format: product.format_type,
    audible_runtime_minutes: Number(product.runtime_length_min),
    audible_verified: true,
    audible_verified_at: verifiedAt,
    cover_url: coverFor(product),
    series_name: series.title,
    series_sequence: series.sequence ?? null,
    series_asin: series.asin ?? null,
    resources: []
  };
});

const declaration = `const SELF_HELP_SERIES_BOOKS=${JSON.stringify(books)};`;
let nextHtml = html;
if (/const SELF_HELP_SERIES_BOOKS=\[[\s\S]*?\];\r?\n(?=const RECENT_GENRE_BOOKS=)/.test(nextHtml)) {
  nextHtml = nextHtml.replace(/const SELF_HELP_SERIES_BOOKS=\[[\s\S]*?\];\r?\n(?=const RECENT_GENRE_BOOKS=)/, `${declaration}\n`);
} else {
  nextHtml = nextHtml.replace(/(?=const RECENT_GENRE_BOOKS=)/, `${declaration}\n`);
}
nextHtml = nextHtml.replace(
  'BOOKS.push(...IMPORTED_BOOKS,...AI_BUSINESS_BOOKS,...RECENT_AI_BUSINESS_BOOKS,...RECENT_GENRE_BOOKS);',
  'BOOKS.push(...IMPORTED_BOOKS,...AI_BUSINESS_BOOKS,...RECENT_AI_BUSINESS_BOOKS,...SELF_HELP_SERIES_BOOKS,...RECENT_GENRE_BOOKS);'
);
fs.writeFileSync(indexPath, nextHtml);
fs.writeFileSync(auditPath, `${JSON.stringify({
  generated_at: verifiedAt,
  quality_gate: { minimum_audible_rating: minRating, minimum_audible_ratings_count: minRatingsCount, format: 'unabridged', language: 'english' },
  scope: roots.map((item) => item.required),
  fetched: fetched.length,
  unique_products: unique.length,
  qualified_series_books: qualified.length,
  qualified_official_series: groups.size,
  qualified_multi_book_series: [...groups.values()].filter((group) => group.books.length >= 2).length,
  existing_official_series: existingSeries.size,
  final_target_series: targetSeries,
  imported_books: books.length,
  imported_covers: books.filter((book) => book.cover_url).length,
  selection_policy: 'Keep existing official series, then prefer multi-book official Audible series. Import up to three quality-gated books per chosen series.'
}, null, 2)}\n`);
console.log(fs.readFileSync(auditPath, 'utf8'));
