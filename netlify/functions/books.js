// Books: Google Books API — Business, Psychology, Self-Help (last 12 months)
exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const API_KEY = 'AIzaSyBVtXwnVXilsNqLx6of2HG2jiYwAWs-btg';
  const BASE    = 'https://www.googleapis.com/books/v1/volumes';

  const queries = [
    { name: 'Business',   term: 'business leadership productivity success', lang: 'en' },
    { name: 'Business',   term: 'business leadership produttività',         lang: 'it' },
    { name: 'Psicologia', term: 'psychology habits happiness mindset',      lang: 'en' },
    { name: 'Psicologia', term: 'psicologia abitudini felicità mente',      lang: 'it' },
    { name: 'Self-Help',  term: 'self help motivation mindset growth',      lang: 'en' },
    { name: 'Self-Help',  term: 'crescita personale motivazione benessere', lang: 'it' },
  ];

  const now      = new Date();
  const thisYear = now.getFullYear();
  const lastMonth= now.getMonth() === 0 ? `${thisYear - 1}-12` : `${thisYear}-${String(now.getMonth()).padStart(2,'0')}`;
  const fromYear = thisYear; // only current year

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const url = `${BASE}?q=${encodeURIComponent(q.term)}&langRestrict=${q.lang}&orderBy=newest&maxResults=20&printType=books&key=${API_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) { console.error(`Google Books HTTP ${res.status} for "${q.term}"`); return []; }
        const json = await res.json();
        if (!json.items) return [];

        return json.items.flatMap(item => {
          const vi = item.volumeInfo || {};
          const year = vi.publishedDate ? vi.publishedDate.slice(0, 4) : null;
          if (!year || parseInt(year) < fromYear) return [];

          const cover = vi.imageLinks
            ? (vi.imageLinks.thumbnail || vi.imageLinks.smallThumbnail || null)
            : null;
          const link = vi.infoLink || `https://books.google.com/books?id=${item.id}`;

          return [{
            type:     'book',
            category: q.name,
            title:    vi.title || '',
            author:   (vi.authors || []).slice(0, 2).join(', '),
            year,
            language: q.lang === 'en' ? 'English' : 'Italian',
            cover:    cover ? cover.replace('http://', 'https://') : null,
            link,
          }];
        });
      } catch (e) {
        console.error(`Google Books failed for "${q.term}":`, e.message);
        return [];
      }
    })
  );

  const books = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Deduplicate by normalized title
  const seen = new Set();
  const unique = books.filter(b => {
    if (!b.title || b.title.length < 3) return false;
    const k = b.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(unique),
  };
};
