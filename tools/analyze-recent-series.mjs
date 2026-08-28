const verifiedAt = '2026-08-29';
const earliestDate = '2019-08-29';
const minRating = 4.3;
const pagesPerCategory = 10;
const pageSize = 50;

const genres = [
  { genre: 'Self-Help', categoryIds: ['18574784011', '18574800011', '18572029011', '18573370011'], requiredCategories: ['Relationships, Parenting & Personal Development', 'Personal Development', 'Business & Careers', 'Health & Wellness'], earliestDate: null, minRatingsCount: 25 },
  { genre: 'מדע בדיוני', categoryIds: ['18580628011'], requiredCategories: ['Science Fiction'], earliestDate, minRatingsCount: 100 },
  { genre: 'מתח', categoryIds: ['18574621011'], requiredCategories: ['Thriller & Suspense'], earliestDate, minRatingsCount: 100 }
];

function categoryNames(product) {
  return [...new Set((product.category_ladders ?? []).flatMap((item) => item.ladder ?? []).map((item) => item.name))];
}

function qualifies(product, config) {
  const rating = Number(product.rating?.overall_distribution?.display_average_rating);
  const ratingCount = Number(product.rating?.overall_distribution?.num_ratings);
  return product.asin
    && (!config.earliestDate || product.release_date >= config.earliestDate) && product.release_date <= verifiedAt
    && rating >= minRating && ratingCount >= config.minRatingsCount
    && product.format_type === 'unabridged'
    && product.language === 'english'
    && product.is_listenable !== false
    && config.requiredCategories.some((name) => categoryNames(product).includes(name))
    && product.series?.[0]?.title;
}

async function fetchPage(config, page) {
  const groups = 'contributors,product_extended_attrs,rating,series,category_ladders,media';
  const url = `https://api.audible.com/1.0/catalog/products?category_id=${config.categoryId}&products_sort_by=BestSellers&num_results=${pageSize}&page=${page}&response_groups=${groups}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Audible ${response.status}: ${config.genre}, page ${page}`);
  return (await response.json()).products ?? [];
}

async function childCategories(config, categoryId) {
  const response = await fetch(`https://api.audible.com/1.0/catalog/categories/${categoryId}`);
  if (!response.ok) throw new Error(`Audible categories ${response.status}: ${config.genre}`);
  const data = await response.json();
  return data.category?.children ?? [];
}

const requestedGenre = process.argv[2];
for (const config of genres.filter((item) => !requestedGenre || item.genre === requestedGenre)) {
  const fetched = [];
  const childrenByRoot = await Promise.all(config.categoryIds.map(async (categoryId) => ({ categoryId, children: await childCategories(config, categoryId) })));
  const children = childrenByRoot.flatMap((item) => item.children);
  const categoryConfigs = childrenByRoot.flatMap(({ categoryId, children: rootChildren }) => [
    { ...config, categoryId },
    ...rootChildren.map((child) => ({ ...config, categoryId: child.id, childName: child.name }))
  ]);
  const requests = categoryConfigs.flatMap((categoryConfig) => Array.from({ length: pagesPerCategory }, (_, index) => ({ categoryConfig, page: index + 1 })));
  for (let start = 0; start < requests.length; start += 10) {
    const pages = await Promise.all(requests.slice(start, start + 10).map(({ categoryConfig, page }) => fetchPage(categoryConfig, page)));
    fetched.push(...pages.flat());
  }
  const unique = [...new Map(fetched.map((product) => [product.asin, product])).values()];
  const eligible = unique.filter((product) => qualifies(product, config));
  const groups = new Map();
  for (const product of eligible) {
    const name = product.series[0].title;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(product);
  }
  const series = [...groups.entries()].map(([name, books]) => ({
    name,
    books: books.length,
    ratings: books.reduce((sum, book) => sum + Number(book.rating.overall_distribution.num_ratings), 0),
    average_rating: Number((books.reduce((sum, book) => sum + Number(book.rating.overall_distribution.display_average_rating), 0) / books.length).toFixed(2)),
    asins: books.map((book) => book.asin)
  })).sort((a, b) => b.books - a.books || b.ratings - a.ratings || a.name.localeCompare(b.name, 'en'));

  console.log(JSON.stringify({
    genre: config.genre,
    pages_per_category: pagesPerCategory,
    child_categories: children.map((child) => child.name),
    fetched: fetched.length,
    unique_products: unique.length,
    eligible_series_books: eligible.length,
    official_series: series.length,
    multi_book_series: series.filter((item) => item.books >= 2).length,
    series_with_three_or_more: series.filter((item) => item.books >= 3).length,
    top_series: series.slice(0, 10)
  }, null, 2));
}
