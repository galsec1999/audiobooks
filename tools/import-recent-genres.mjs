import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const indexPath = path.join(root, 'index.html');
const auditPath = path.join(root, 'data', 'recent-genres-audit.json');
const verifiedAt = '2026-08-29';
const earliestDate = '2019-08-29';
const minRating = 4.3;
const minRatingsCount = 100;
const targetSeriesPerGenre = 70;
const targetBooksPerGenre = 210;
const pagesPerCategory = 10;
const pageSize = 50;

const genres = [
  { genre: 'מדע בדיוני', categoryId: '18580628011', requiredCategory: 'Science Fiction' },
  { genre: 'מתח', categoryId: '18574621011', requiredCategory: 'Thriller & Suspense' }
];

function parseArray(html, name) {
  const match = html.match(new RegExp(`const ${name}=(\\[[\\s\\S]*?\\]);`));
  return match ? JSON.parse(match[1]) : [];
}

function allCategoryNames(product) {
  return [...new Set((product.category_ladders ?? []).flatMap((item) => item.ladder ?? []).map((item) => item.name))];
}

function topicFor(genre, names) {
  const joined = names.join(' | ').toLowerCase();
  if (genre === 'מדע בדיוני') {
    if (/dystopian|post-apocalyptic/.test(joined)) return 'דיסטופיה ופוסט־אפוקליפסה';
    if (/space opera|first contact|alien|space exploration/.test(joined)) return 'חלל ומפגש ראשון';
    if (/military/.test(joined)) return 'מדע בדיוני צבאי';
    if (/cyberpunk/.test(joined)) return 'סייברפאנק';
    if (/time travel/.test(joined)) return 'מסע בזמן';
    if (/hard science fiction/.test(joined)) return 'מדע בדיוני קשה';
    if (/humorous/.test(joined)) return 'מדע בדיוני הומוריסטי';
    if (/action|adventure/.test(joined)) return 'הרפתקאות מדע בדיוני';
    return 'מדע בדיוני כללי';
  }
  if (/psychological/.test(joined)) return 'מותחן פסיכולוגי';
  if (/espionage|spy/.test(joined)) return 'ריגול';
  if (/technothriller/.test(joined)) return 'מותחן טכנולוגי';
  if (/crime/.test(joined)) return 'פשע';
  if (/legal/.test(joined)) return 'מותחן משפטי';
  if (/medical/.test(joined)) return 'מותחן רפואי';
  if (/political/.test(joined)) return 'מותחן פוליטי';
  if (/domestic/.test(joined)) return 'מתח ביתי';
  if (/military/.test(joined)) return 'מותחן צבאי';
  if (/supernatural/.test(joined)) return 'מתח על־טבעי';
  if (/action|adventure/.test(joined)) return 'מתח ופעולה';
  return 'מתח כללי';
}

function numericSequence(value) {
  const parsed = Number.parseFloat(String(value ?? '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? '');
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizedBookKey(product) {
  const authors = (product.authors ?? []).map((author) => author.name).join(' ');
  return `${product.title} ${authors}`.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function ratingCount(product) {
  return Number(product.rating?.overall_distribution?.num_ratings || 0);
}

function averageRating(product) {
  return Number(product.rating?.overall_distribution?.display_average_rating || 0);
}

function coverFor(product) {
  const images = product.product_images ?? {};
  return images['1000'] || images['500'] || images['475'] || images['300'] || images['200']
    || Object.values(images).filter((value) => typeof value === 'string').pop() || null;
}

function selectSeries(candidates) {
  const groups = new Map();
  for (const product of candidates) {
    const series = product.series?.[0];
    if (!series?.title) continue;
    const key = series.asin || series.title;
    if (!groups.has(key)) groups.set(key, { name: series.title, asin: series.asin ?? null, books: [] });
    groups.get(key).books.push(product);
  }
  const ranked = [...groups.values()]
    .filter((group) => group.books.length >= 2)
    .map((group) => {
      group.books.sort((a, b) => numericSequence(a.series?.[0]?.sequence) - numericSequence(b.series?.[0]?.sequence)
        || b.release_date.localeCompare(a.release_date));
      group.totalRatings = group.books.reduce((sum, book) => sum + ratingCount(book), 0);
      group.averageRating = group.books.reduce((sum, book) => sum + averageRating(book), 0) / group.books.length;
      return group;
    })
    .sort((a, b) => b.books.length - a.books.length || b.totalRatings - a.totalRatings
      || b.averageRating - a.averageRating || a.name.localeCompare(b.name, 'en'));
  if (ranked.length < targetSeriesPerGenre) {
    throw new Error(`Only ${ranked.length} qualifying multi-book series; ${targetSeriesPerGenre} required.`);
  }
  const selectedGroups = ranked.slice(0, targetSeriesPerGenre);
  const selected = [];
  for (let round = 0; selected.length < targetBooksPerGenre; round += 1) {
    let added = false;
    for (const group of selectedGroups) {
      if (selected.length >= targetBooksPerGenre) break;
      if (group.books[round]) {
        selected.push(group.books[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  if (selected.length < 150) throw new Error(`Only ${selected.length} books across selected series; at least 150 required.`);
  return { selected, selectedGroups };
}

async function childCategories(categoryId) {
  const response = await fetch(`https://api.audible.com/1.0/catalog/categories/${categoryId}`);
  if (!response.ok) throw new Error(`Audible categories ${response.status}: ${categoryId}`);
  return (await response.json()).category?.children ?? [];
}

async function fetchPage(categoryId, page) {
  const groups = 'contributors,product_desc,product_extended_attrs,rating,series,category_ladders,media';
  const url = `https://api.audible.com/1.0/catalog/products?category_id=${categoryId}&products_sort_by=BestSellers&num_results=${pageSize}&page=${page}&response_groups=${groups}&image_sizes=500`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audible ${response.status} for category ${categoryId}, page ${page}`);
  return (await response.json()).products ?? [];
}

async function fetchGenre(config) {
  const children = await childCategories(config.categoryId);
  const categoryIds = [config.categoryId, ...children.map((child) => child.id)];
  const requests = categoryIds.flatMap((categoryId) => Array.from({ length: pagesPerCategory }, (_, index) => ({ categoryId, page: index + 1 })));
  const fetched = [];
  for (let start = 0; start < requests.length; start += 10) {
    const pages = await Promise.all(requests.slice(start, start + 10).map(({ categoryId, page }) => fetchPage(categoryId, page)));
    fetched.push(...pages.flat());
  }
  return { fetched, children };
}

const html = fs.readFileSync(indexPath, 'utf8');
const existingArrays = ['BOOKS', 'IMPORTED_BOOKS', 'AI_BUSINESS_BOOKS', 'RECENT_AI_BUSINESS_BOOKS'];
const existingBooks = existingArrays.flatMap((name) => parseArray(html, name));
const usedAsins = new Set(existingBooks.map((book) => book.audible_asin).filter(Boolean));
const usedBookKeys = new Set(existingBooks.map((book) => `${book.title} ${book.author}`.toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()));
const selectedByGenre = [];
const auditGenres = [];

for (const config of genres) {
  const { fetched, children } = await fetchGenre(config);
  const unique = [...new Map(fetched.map((product) => [product.asin, product])).values()];
  const qualifiedBeforeTitleDedupe = unique.filter((product) => {
    const categories = allCategoryNames(product);
    return product.asin && !usedAsins.has(product.asin)
      && product.release_date >= earliestDate && product.release_date <= verifiedAt
      && averageRating(product) >= minRating && ratingCount(product) >= minRatingsCount
      && product.format_type === 'unabridged'
      && product.language === 'english'
      && product.is_listenable !== false
      && categories.includes(config.requiredCategory)
      && product.publisher_summary
      && product.series?.[0]?.title;
  });
  const qualified = [...new Map(qualifiedBeforeTitleDedupe
    .sort((a, b) => ratingCount(b) - ratingCount(a))
    .filter((product) => !usedBookKeys.has(normalizedBookKey(product)))
    .map((product) => [normalizedBookKey(product), product])).values()];
  const { selected, selectedGroups } = selectSeries(qualified);
  selected.forEach((product) => {
    usedAsins.add(product.asin);
    usedBookKeys.add(normalizedBookKey(product));
  });
  selectedByGenre.push(...selected.map((product) => ({ config, product })));
  const selectedCounts = new Map();
  for (const product of selected) {
    const key = product.series?.[0]?.asin || product.series?.[0]?.title;
    selectedCounts.set(key, (selectedCounts.get(key) ?? 0) + 1);
  }
  auditGenres.push({
    genre: config.genre,
    category_id: config.categoryId,
    child_categories: children.map((child) => ({ id: child.id, name: child.name })),
    fetched: fetched.length,
    unique_products: unique.length,
    qualified_before_title_dedupe: qualifiedBeforeTitleDedupe.length,
    qualified: qualified.length,
    selected: selected.length,
    selected_series: selectedGroups.length,
    minimum_books_per_selected_series: Math.min(...selectedCounts.values()),
    average_rating: Number((selected.reduce((sum, product) => sum + averageRating(product), 0) / selected.length).toFixed(2)),
    total_ratings: selected.reduce((sum, product) => sum + ratingCount(product), 0)
  });
}

const books = selectedByGenre.map(({ config, product }) => {
  const series = product.series?.[0] ?? null;
  const topic = topicFor(config.genre, allCategoryNames(product));
  return {
    title: product.title,
    author: (product.authors ?? []).map((author) => author.name).join(' & '),
    year: Number(product.release_date.slice(0, 4)),
    category: topic,
    genre: config.genre,
    topic,
    focus: null,
    source: `Audible ${config.genre} series quality gate · ${verifiedAt}`,
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
    series_name: series?.title ?? null,
    series_sequence: series?.sequence ?? null,
    series_asin: series?.asin ?? null,
    resources: []
  };
});

const declaration = `const RECENT_GENRE_BOOKS=${JSON.stringify(books)};`;
let nextHtml;
if (/const RECENT_GENRE_BOOKS=\[[\s\S]*?\];\r?\n(?=const PUBLISHER_SUMMARIES=)/.test(html)) {
  nextHtml = html.replace(/const RECENT_GENRE_BOOKS=\[[\s\S]*?\];\r?\n(?=const PUBLISHER_SUMMARIES=)/, `${declaration}\n`);
} else {
  nextHtml = html.replace(/(?=const PUBLISHER_SUMMARIES=)/, `${declaration}\n`);
}
nextHtml = nextHtml.replace(
  'BOOKS.push(...IMPORTED_BOOKS,...AI_BUSINESS_BOOKS,...RECENT_AI_BUSINESS_BOOKS);',
  'BOOKS.push(...IMPORTED_BOOKS,...AI_BUSINESS_BOOKS,...RECENT_AI_BUSINESS_BOOKS,...RECENT_GENRE_BOOKS);'
);
fs.writeFileSync(indexPath, nextHtml);
fs.writeFileSync(auditPath, `${JSON.stringify({
  generated_at: verifiedAt,
  date_window: { from: earliestDate, to: verifiedAt },
  quality_gate: { minimum_audible_rating: minRating, minimum_audible_ratings_count: minRatingsCount, format: 'unabridged', language: 'english' },
  selection_policy: `Exactly ${targetSeriesPerGenre} official Audible series per genre, at least two qualifying books per series; round-robin selection up to ${targetBooksPerGenre} books.`,
  genres: auditGenres,
  total_selected: books.length,
  covers_embedded: books.filter((book) => book.cover_url).length
}, null, 2)}\n`);
console.log(JSON.stringify(auditGenres, null, 2));
