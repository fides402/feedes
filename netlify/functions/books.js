// Books: tries 1lib.sk first (Cloudflare may block server IPs),
// falls back to Open Library (always works, free, no key).
exports.handler = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const currentYear = new Date().getFullYear();

  // ── Try 1lib.sk ──────────────────────────────────────────────────────────
  const zlibBooks = await fetchZlib(currentYear);
  if (zlibBooks.length > 0) {
    return ok(corsHeaders, zlibBooks);
  }

  // ── Fallback: Open Library ────────────────────────────────────────────────
  const olBooks = await fetchOpenLibrary(currentYear);
  return ok(corsHeaders, olBooks);
};

// ── 1lib.sk scraper ──────────────────────────────────────────────────────────
async function fetchZlib(year) {
  const categories = [
    { name: 'Business',   url: `https://1lib.sk/category/5/Business--Economics/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date` },
    { name: 'Psicologia', url: `https://1lib.sk/category/29/Psychology/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date` },
    { name: 'Self-Help',  url: `https://1lib.sk/category/35/Self-Help-Relationships--Lifestyle/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date` },
  ];

  const books = [];

  for (const cat of categories) {
    try {
      const res = await fetch(cat.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'max-age=0',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'Referer': 'https://1lib.sk/',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        console.log(`1lib.sk ${cat.name}: HTTP ${res.status} — will use fallback`);
        return []; // Signal to use fallback
      }

      const html = await res.text();
      const parsed = parseZlibHTML(html, cat.name);
      books.push(...parsed);
    } catch (e) {
      console.error(`1lib.sk error (${cat.name}):`, e.message);
      return [];
    }
  }

  return books;
}

function parseZlibHTML(html, category) {
  const books = [];

  // z-bookcard custom elements carry data as attributes
  const cardRegex = /<z-bookcard\s([^>]*?)(?:\/?>|>)/gis;
  let match;
  let count = 0;

  while ((match = cardRegex.exec(html)) !== null && count < 8) {
    const attrs = match[1];
    const get = (key) => {
      const m = new RegExp(`\\b${key}="([^"]*)"`, 'i').exec(attrs);
      return m ? decode(m[1]) : '';
    };

    const href  = get('href');
    const title = get('title');
    if (!title || !href) continue;

    books.push({
      type: 'book',
      category,
      title,
      author:   get('author'),
      year:     get('year'),
      language: get('language') || 'English',
      cover:    (() => { const c = get('cover') || get('img') || get('coverurl'); return c ? (c.startsWith('http') ? c : `https://1lib.sk${c}`) : null; })(),
      link:     href.startsWith('http') ? href : `https://1lib.sk${href}`,
    });
    count++;
  }

  return books;
}

// ── Open Library fallback ────────────────────────────────────────────────────
async function fetchOpenLibrary(currentYear) {
  const minYear = currentYear - 1;
  const queries = [
    { name: 'Business',   subject: 'business',   lang: 'eng' },
    { name: 'Business',   subject: 'economia',   lang: 'ita' },
    { name: 'Psicologia', subject: 'psychology', lang: 'eng' },
    { name: 'Psicologia', subject: 'psicologia', lang: 'ita' },
    { name: 'Self-Help',  subject: 'self-help',  lang: 'eng' },
    { name: 'Self-Help',  subject: 'crescita-personale', lang: 'ita' },
  ];

  const books = [];
  const fields = 'key,title,author_name,cover_i,first_publish_year';

  for (const q of queries) {
    try {
      const url = `https://openlibrary.org/search.json?subject=${encodeURIComponent(q.subject)}&language=${q.lang}&sort=new&limit=8&fields=${fields}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const doc of (data.docs || [])) {
        if (!doc.title) continue;
        if (doc.first_publish_year && doc.first_publish_year < minYear) continue;
        books.push({
          type: 'book',
          category: q.name,
          title: doc.title,
          author: (doc.author_name || []).slice(0, 2).join(', '),
          year:   String(doc.first_publish_year || currentYear),
          language: q.lang === 'ita' ? 'Italiano' : 'English',
          cover:  doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
          link:   `https://openlibrary.org${doc.key}`,
        });
      }
    } catch (e) {
      console.error(`OL error (${q.name}):`, e.message);
    }
  }

  // Deduplicate
  const seen = new Set();
  return books.filter(b => {
    const k = b.title.toLowerCase().slice(0, 50);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function ok(headers, books) {
  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    body: JSON.stringify(books),
  };
}

function decode(str) {
  if (!str) return '';
  return str.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'");
}
