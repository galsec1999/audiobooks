import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const indexPath = path.join(root, 'index.html');
const auditPath = path.join(root, 'data', 'recent-genres-audit.json');
const verifiedAt = '2026-08-28';
const earliestDate = '2019-08-28';
const latestDate = verifiedAt;
const minRating = 4.3;
const minRatingsCount = 100;
const targetPerGenre = 150;
const pagesPerGenre = 15;

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
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.].*$/, ''));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function normalizedBookKey(product) {
  const authors = (product.authors ?? []).map((author) => author.name).join(' ');
  return `${product.title} ${authors}`.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function selectSeriesFirst(candidates, target) {
  const groups = new Map();
  for (const product of candidates) {
    const seriesName = product.series?.[0]?.title;
    if (!seriesName) continue;
    if (!groups.has(seriesName)) groups.set(seriesName, []);
    groups.get(seriesName).push(product);
  }
  const multiBookSeries = [...groups.entries()]
    .filter(([, books]) => books.length >= 2)
    .sort((a, b) => {
      const aRatings = a[1].reduce((sum, book) => sum + Number(book.rating.overall_distribution.num_ratings || 0), 0);
      const bRatings = b[1].reduce((sum, book) => sum + Number(book.rating.overall_distribution.num_ratings || 0), 0);
      return b[1].length - a[1].length || bRatings - aRatings || a[0].localeCompare(b[0], 'en');
    });
  const chosen = [];
  const chosenAsins = new Set();
  for (const [, books] of multiBookSeries) {
    if (chosen.length >= target) break;
    books.sort((a, b) => numericSequence(a.series?.[0]?.sequence) - numericSequence(b.series?.[0]?.sequence));
    for (const book of books) {
      if (chosen.length >= target) break;
      if (!chosenAsins.has(book.asin)) {
        chosen.push(book);
        chosenAsins.add(book.asin);
      }
    }
  }
  const remaining = candidates
    .filter((book) => !chosenAsins.has(book.asin))
    .sort((a, b) => Number(b.rating.overall_distribution.num_ratings) - Number(a.rating.overall_distribution.num_ratings)
      || Number(b.rating.overall_distribution.display_average_rating) - Number(a.rating.overall_distribution.display_average_rating)
      || b.release_date.localeCompare(a.release_date));
  for (const book of remaining) {
    if (chosen.length >= target) break;
    chosen.push(book);
    chosenAsins.add(book.asin);
  }
  return chosen;
}

async function fetchPage(categoryId, page) {
  const groups = 'contributors,product_desc,product_extended_attrs,rating,series,category_ladders,media';
  const url = `https://api.audible.com/1.0/catalog/products?category_id=${categoryId}&products_sort_by=BestSellers&num_results=50&page=${page}&response_groups=${groups}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audible ${response.status} for category ${categoryId}, page ${page}`);
  return (await response.json()).products ?? [];
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
  const pages = await Promise.all(Array.from({ length: pagesPerGenre }, (_, index) => fetchPage(config.categoryId, index + 1)));
  const fetched = pages.flat();
  const unique = [...new Map(fetched.map((product) => [product.asin, product])).values()];
  const qualifiedBeforeTitleDedupe = unique.filter((product) => {
    const rating = Number(product.rating?.overall_distribution?.display_average_rating);
    const ratingsCount = Number(product.rating?.overall_distribution?.num_ratings);
    const categories = allCategoryNames(product);
    return product.asin && !usedAsins.has(product.asin)
      && product.release_date >= earliestDate && product.release_date <= latestDate
      && rating >= minRating && ratingsCount >= minRatingsCount
      && product.format_type === 'unabridged'
      && product.language === 'english'
      && product.is_listenable !== false
      && categories.includes(config.requiredCategory)
      && product.publisher_summary;
  });
  const qualified = [...new Map(qualifiedBeforeTitleDedupe
    .sort((a, b) => Number(b.rating.overall_distribution.num_ratings) - Number(a.rating.overall_distribution.num_ratings))
    .filter((product) => !usedBookKeys.has(normalizedBookKey(product)))
    .map((product) => [normalizedBookKey(product), product])).values()];
  const selected = selectSeriesFirst(qualified, targetPerGenre);
  if (selected.length < targetPerGenre) throw new Error(`${config.genre}: only ${selected.length} qualifying books.`);
  selected.forEach((product) => {
    usedAsins.add(product.asin);
    usedBookKeys.add(normalizedBookKey(product));
  });
  selectedByGenre.push(...selected.map((product) => ({ config, product })));
  const seriesGroups = new Map();
  for (const product of selected) {
    const name = product.series?.[0]?.title;
    if (name) seriesGroups.set(name, (seriesGroups.get(name) ?? 0) + 1);
  }
  auditGenres.push({
    genre: config.genre,
    category_id: config.categoryId,
    fetched: fetched.length,
    qualified_before_title_dedupe: qualifiedBeforeTitleDedupe.length,
    qualified: qualified.length,
    selected: selected.length,
    books_in_series: selected.filter((product) => product.series?.[0]?.title).length,
    multi_book_series: [...seriesGroups.values()].filter((count) => count >= 2).length,
    average_rating: Number((selected.reduce((sum, product) => sum + Number(product.rating.overall_distribution.display_average_rating), 0) / selected.length).toFixed(2)),
    total_ratings: selected.reduce((sum, product) => sum + Number(product.rating.overall_distribution.num_ratings), 0)
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
    source: `Audible ${config.genre} quality gate · ${verifiedAt}`,
    rank: null,
    sales: null,
    rating_count: Number(product.rating.overall_distribution.num_ratings),
    rating_avg: Number(product.rating.overall_distribution.display_average_rating),
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
  date_window: { from: earliestDate, to: latestDate },
  quality_gate: { minimum_audible_rating: minRating, minimum_audible_ratings_count: minRatingsCount, format: 'unabridged', language: 'english' },
  selection_policy: 'Prefer complete multi-book groups among qualifying recent titles, then fill by Audible ratings count and score.',
  genres: auditGenres,
  total_selected: books.length
}, null, 2)}\n`);
console.log(JSON.stringify(auditGenres, null, 2));
