// Scrapes 1lib.sk (z-library) for recently published books by category
exports.handler = async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const year = new Date().getFullYear();

  const categories = [
    {
      name: 'Business',
      url: `https://1lib.sk/category/5/Business--Economics/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date`,
    },
    {
      name: 'Psicologia',
      url: `https://1lib.sk/category/29/Psychology/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date`,
    },
    {
      name: 'Self-Help',
      url: `https://1lib.sk/category/35/Self-Help-Relationships--Lifestyle/s/?yearFrom=${year}&languages[]=italian&languages[]=english&order=date`,
    },
  ];

  const books = [];

  for (const cat of categories) {
    try {
      const res = await fetch(cat.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
          'Referer': 'https://1lib.sk/',
        },
        redirect: 'follow',
      });

      if (!res.ok) {
        console.error(`${cat.name}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();

      // Extract z-bookcard elements (z-library uses custom elements)
      const cardRegex = /<z-bookcard\s([^>]*?)(?:\/?>|>)/gis;
      let match;
      let count = 0;

      while ((match = cardRegex.exec(html)) !== null && count < 8) {
        const attrs = match[1];

        const get = (key) => {
          const m = new RegExp(`\\b${key}="([^"]*)"`, 'i').exec(attrs);
          return m ? decodeEntities(m[1]) : '';
        };

        const href = get('href');
        const title = get('title');
        const author = get('author');
        const yearVal = get('year');
        const cover = get('cover') || get('img') || get('coverurl');
        const language = get('language');
        const extension = get('extension');

        if (title && href) {
          books.push({
            type: 'book',
            category: cat.name,
            title,
            author,
            year: yearVal,
            language,
            extension,
            cover: cover
              ? cover.startsWith('http')
                ? cover
                : `https://1lib.sk${cover}`
              : null,
            link: href.startsWith('http') ? href : `https://1lib.sk${href}`,
          });
          count++;
        }
      }

      // Fallback: try JSON-LD or schema.org markup
      if (count === 0) {
        const schemaRegex = /"@type"\s*:\s*"Book"[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"/g;
        let schemaMatch;
        let fallbackCount = 0;
        while ((schemaMatch = schemaRegex.exec(html)) !== null && fallbackCount < 8) {
          books.push({
            type: 'book',
            category: cat.name,
            title: decodeEntities(schemaMatch[1]),
            author: '',
            year: String(year),
            cover: null,
            link: cat.url,
          });
          fallbackCount++;
        }
      }
    } catch (e) {
      console.error(`Error fetching ${cat.name}:`, e.message);
    }
  }

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=1800',
    },
    body: JSON.stringify(books),
  };
};

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}
