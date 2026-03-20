// Books: Open Library API (free, reliable, no key needed)
// Covers Business, Psychology, Self-Help in English and Italian
exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const year = new Date().getFullYear();
  const minYear = year - 1;

  const queries = [
    { name: 'Business',   subject: 'business',          lang: 'eng' },
    { name: 'Business',   subject: 'economia',           lang: 'ita' },
    { name: 'Psicologia', subject: 'psychology',         lang: 'eng' },
    { name: 'Psicologia', subject: 'psicologia',         lang: 'ita' },
    { name: 'Self-Help',  subject: 'self-help',          lang: 'eng' },
    { name: 'Self-Help',  subject: 'crescita personale', lang: 'ita' },
  ];

  const fields = 'key,title,author_name,cover_i,first_publish_year';

  // Fetch all categories in parallel
  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const url = `https://openlibrary.org/search.json?subject=${encodeURIComponent(q.subject)}&language=${q.lang}&sort=new&limit=10&fields=${fields}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.docs || [])
        .filter(d => d.title && (!d.first_publish_year || d.first_publish_year >= minYear))
        .map(d => ({
          type: 'book',
          category: q.name,
          title: d.title,
          author: (d.author_name || []).slice(0, 2).join(', '),
          year: String(d.first_publish_year || year),
          language: q.lang === 'ita' ? 'Italiano' : 'English',
          cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
          link: `https://openlibrary.org${d.key}`,
        }));
    })
  );

  const books = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Deduplicate by title
  const seen = new Set();
  const unique = books.filter(b => {
    const k = b.title.toLowerCase().slice(0, 50);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(unique),
  };
};
