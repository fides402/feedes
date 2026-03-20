// Books: Libgen.la — scrapes search results for Business, Psychology, Self-Help
exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const LIBGEN = 'https://libgen.la';

  const queries = [
    { name: 'Business',   term: 'business management strategy', lang: 'English' },
    { name: 'Business',   term: 'economia aziendale management', lang: 'Italian' },
    { name: 'Psicologia', term: 'psychology cognitive behavior',  lang: 'English' },
    { name: 'Psicologia', term: 'psicologia mente',               lang: 'Italian' },
    { name: 'Self-Help',  term: 'self help personal development', lang: 'English' },
    { name: 'Self-Help',  term: 'crescita personale benessere',   lang: 'Italian' },
  ];

  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
  };

  function decode(html) {
    return html
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');
  }

  function stripTags(html) {
    return decode(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')).trim();
  }

  function parseLibgenResults(html, category, lang) {
    const books = [];

    // Each book row contains a link to book/index.php?md5=...
    // Split by </tr> and inspect each chunk
    const chunks = html.split(/<\/tr>/i);

    for (const chunk of chunks) {
      const md5M = chunk.match(/md5=([a-fA-F0-9]{32})/i);
      if (!md5M) continue;
      const md5 = md5M[1].toLowerCase();

      // Extract <td> cells
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cellRe.exec(chunk)) !== null) cells.push(cm[1]);
      if (cells.length < 7) continue;

      // ID
      const idM = stripTags(cells[0]).match(/\d+/);
      const id = idM ? parseInt(idM[0]) : 0;

      // Author (cell 1)
      const author = stripTags(cells[1]).split(/[;,\n]/)[0].trim().slice(0, 100);

      // Title — prefer title="" attribute, fallback to link text
      let title = '';
      const titleAttr = cells[2]?.match(/\btitle="([^"]{3,})"/);
      if (titleAttr) {
        title = decode(titleAttr[1]).trim();
      } else {
        const linkText = cells[2]?.match(/<a[^>]*>([^<]{3,})<\/a>/i);
        if (linkText) title = decode(linkText[1]).trim();
      }
      if (!title) title = stripTags(cells[2] || '').slice(0, 200);
      title = title.slice(0, 250);
      if (!title || title.length < 3) continue;

      // Year (cell 4)
      const yearM = stripTags(cells[4] || '').match(/\b(19|20)\d{2}\b/);
      const year = yearM ? yearM[0] : null;

      // Language (cell 6)
      const language = stripTags(cells[6] || '').trim() || lang;

      // Extension filter: prefer pdf/epub, skip djvu/chm junk
      const ext = stripTags(cells[8] || '').toLowerCase();
      if (ext && !['pdf', 'epub', 'mobi', 'azw3', 'fb2', 'txt', 'doc', 'docx', ''].includes(ext)) continue;

      // Cover: https://libgen.la/covers/BUCKET/md5-g.jpg
      const bucket = Math.floor(id / 1000) * 1000;
      const cover = (id > 0 && md5) ? `${LIBGEN}/covers/${bucket}/${md5}-g.jpg` : null;
      const link  = md5 ? `https://library.lol/main/${md5}` : LIBGEN;

      books.push({ type: 'book', category, title, author, year, language, cover, link });
    }

    return books;
  }

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const url = `${LIBGEN}/search.php?req=${encodeURIComponent(q.term)}&column=def&res=15&sort=year&sortmode=DESC&language=${encodeURIComponent(q.lang)}&lg_topic=libgen&open=0&view=simple&phrase=1`;
        const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(8000) });
        if (!res.ok) { console.error(`libgen HTTP ${res.status} for ${q.term}`); return []; }
        const html = await res.text();
        return parseLibgenResults(html, q.name, q.lang);
      } catch (e) {
        console.error(`libgen failed for "${q.term}":`, e.message);
        return [];
      }
    })
  );

  const books = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);

  // Deduplicate by normalized title
  const seen = new Set();
  const unique = books.filter(b => {
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
