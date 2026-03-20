// Books: Libgen.la — scrapes search results for Business, Psychology, Self-Help
exports.handler = async () => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  const LIBGEN = 'https://libgen.la';

  const queries = [
    { name: 'Business',   term: 'business management strategy', lang: 'English' },
    { name: 'Business',   term: 'economia aziendale',            lang: 'Italian' },
    { name: 'Psicologia', term: 'psychology behavior mind',      lang: 'English' },
    { name: 'Psicologia', term: 'psicologia mente',              lang: 'Italian' },
    { name: 'Self-Help',  term: 'self help personal development',lang: 'English' },
    { name: 'Self-Help',  term: 'crescita personale benessere',  lang: 'Italian' },
  ];

  const hdrs = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://libgen.la/',
  };

  function decode(s) {
    return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ');
  }

  // Tag-stripping regex that handles > inside quoted attribute values
  function stripTags(html) {
    return decode(
      html.replace(/<(?:[^"'>]|"[^"]*"|'[^']*')*>/g, ' ')
          .replace(/\s+/g, ' ')
    ).trim();
  }

  function parseLibgenResults(html, category, lang) {
    const books = [];
    // Split on </tr> — each chunk = one book row
    const chunks = html.split(/<\/tr>/i);

    for (const chunk of chunks) {
      // Only process rows that have an md5 download link
      const md5M = chunk.match(/md5=([a-fA-F0-9]{32})/i);
      if (!md5M) continue;
      const md5 = md5M[1].toLowerCase();

      // Extract all <td> cells — use a tag-aware split
      const cells = [];
      const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cellRe.exec(chunk)) !== null) cells.push(cm[1]);
      if (cells.length < 5) continue;

      // --- TITLE ---
      // edition.php links look like:
      //   <a ... title="stuff with <br>" href="edition.php?id=NNN">BOOK TITLE<i></i></a>
      //   <a ... href="edition.php?id=NNN"><i> vol x </i></a>  (invisible — skip)
      //   <a ... href="edition.php?id=NNN"><font>ISBNs</font></a>  (skip)
      //
      // Safe regex: match `href="edition.php?id=NNN">` then grab non-< text.
      // This works because the > directly follows the href attribute value.
      let title = '';
      const cell0 = cells[0] || '';
      const edMatches = [...cell0.matchAll(/href="edition\.php\?id=\d+">\s*([^<]{4,})/gi)];
      for (const m of edMatches) {
        const txt = m[1].trim();
        if (/^[\d;, ]+$/.test(txt)) continue; // skip ISBN-only lines
        title = txt.replace(/\s+\d+$/, '').trim(); // strip trailing edition number
        break;
      }
      // Fallback: strip <b>...</b> series block and use plain text of first <a>
      if (!title) {
        const rest = cell0.replace(/<b>[\s\S]*?<\/b>/i, '');
        const fb = [...rest.matchAll(/href="edition\.php\?id=\d+">\s*([^<]{4,})/gi)];
        for (const m of fb) {
          const txt = m[1].trim();
          if (/^[\d;, ]+$/.test(txt)) continue;
          title = txt.replace(/\s+\d+$/, '').trim();
          break;
        }
      }
      // Last resort: first non-empty stripped line of cell0 (after removing bold block)
      if (!title) {
        const rest = cell0.replace(/<b>[\s\S]*?<\/b>/i, '');
        const lines = stripTags(rest).split('\n').map(l => l.trim()).filter(l => l.length > 4);
        title = lines[0] || '';
      }
      title = title.slice(0, 250);
      if (title.length < 3) continue;

      // --- AUTHOR ---  cell 1
      const author = stripTags(cells[1] || '').split(';')[0].trim().slice(0, 150);

      // --- YEAR, LANGUAGE, EXT --- scan cells 2..N-2
      let year = null, language = lang, ext = '';
      for (let i = 2; i < cells.length - 1; i++) {
        const t = stripTags(cells[i]);
        if (!year && /^(19|20)\d{2}$/.test(t)) year = t;
        if (/^(English|Italian|German|French|Spanish|Portuguese|Russian)$/i.test(t)) language = t;
        if (/^(pdf|epub|mobi|azw3|fb2|txt|doc)$/i.test(t)) ext = t.toLowerCase();
      }

      // Skip djvu / chm (poor formats for reading)
      if (ext === 'djvu' || ext === 'chm') continue;

      // --- COVER --- requires libgen internal ID (from "l NNNNN" badge in cell 0)
      // Badge HTML: <span class="badge badge-secondary"">l 5191331</span>
      const idM = cell0.match(/\bl\s+(\d+)\b/);
      const libId = idM ? parseInt(idM[1]) : 0;
      const bucket = libId > 0 ? Math.floor(libId / 1000) * 1000 : 0;
      const cover = (bucket > 0 && md5) ? `${LIBGEN}/covers/${bucket}/${md5}-g.jpg` : null;
      const link  = `https://library.lol/main/${md5}`;

      books.push({ type: 'book', category, title, author, year, language, cover, link });
    }

    return books;
  }

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      try {
        const url = `${LIBGEN}/index.php?req=${encodeURIComponent(q.term)}&column=def&res=15&sort=year&sortmode=DESC&language=${encodeURIComponent(q.lang)}&lg_topic=libgen`;
        const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(8000) });
        if (!res.ok) { console.error(`libgen HTTP ${res.status} for "${q.term}"`); return []; }
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
