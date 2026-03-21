// netlify/functions/page-to-rss.js
// Convert any webpage URL → RSS feed XML.
// No external dependencies — uses Node 18+ built-in fetch.
//
// Strategies (in order):
//   1. RSS/Atom autodiscovery   (link[rel=alternate])
//   2. Mondadori OCC API        (mondadoristore.it/gen/*/c/CODE)
//   3. JSON-LD structured data  (script[type=application/ld+json])
//   4. Generic HTML heuristics  (article, h2 a, .card, etc.)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT_MS = 12000;

// ── fetch helpers ──────────────────────────────────────────────────────────

// Compatible timeout — works on Node 16/17/18/20 and all serverless runtimes
function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

async function fetchText(url, extraHeaders = {}) {
  const { signal, clear } = withTimeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        ...extraHeaders,
      },
      redirect: 'follow',
      signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  } finally {
    clear();
  }
}

async function fetchJSON(url, extraHeaders = {}) {
  const { signal, clear } = withTimeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', ...extraHeaders },
      redirect: 'follow',
      signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } finally {
    clear();
  }
}

// ── XML escaping & RSS builder ─────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRSS({ title, link, description, items }) {
  const now = new Date().toUTCString();
  const itemsXml = items.map(item => {
    const enclosure = item.image
      ? `\n      <enclosure url="${esc(item.image)}" type="image/jpeg" length="0"/>`
      : '';
    const desc = item.description
      ? `\n      <description><![CDATA[${item.description}]]></description>`
      : '';
    return `
  <item>
    <title><![CDATA[${item.title || '—'}]]></title>
    <link>${esc(item.url)}</link>
    <guid isPermaLink="true">${esc(item.url)}</guid>${desc}${enclosure}
    <pubDate>${item.date ? new Date(item.date).toUTCString() : now}</pubDate>
  </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title><![CDATA[${title}]]></title>
    <link>${esc(link)}</link>
    <description><![CDATA[${description || title}]]></description>
    <language>it</language>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>30</ttl>
    <atom:link href="${esc(link)}" rel="self" type="application/rss+xml"/>
    ${itemsXml}
  </channel>
</rss>`;
}

// ── Strategy 1: RSS/Atom autodiscovery ─────────────────────────────────────

async function tryAutodiscovery(url) {
  const html = await fetchText(url);

  // Look for <link type="application/rss+xml" href="..."> or atom equivalent
  const m = html.match(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)
         || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(rss|atom)\+xml["']/i);
  if (!m) return null;

  // href is in group 2 (first pattern) or group 1 (second pattern)
  const feedHref = m[2] || m[1];
  const feedUrl = new URL(feedHref, url).href;
  return fetchText(feedUrl);
}

// ── Strategy 2: Mondadori OCC API ──────────────────────────────────────────

const MSTORE_API = 'https://api.ccrp2z8473-mondadori1-p1-public.model-t.cc.commerce.ondemand.com/occ/v2/mondadorisite-b2c';
const MSTORE     = 'https://www.mondadoristore.it';
const MSTORE_HDR = { Origin: MSTORE, Referer: MSTORE + '/' };

function parseMondadoriUrl(url) {
  const m = url.match(/mondadoristore\.it\/gen\/([^/?#]+)(?:\/c\/([A-Z0-9]+))?/i);
  if (!m) return null;
  return {
    slug: m[1].replace(/_/g, ' '),
    code: m[2] || null,
  };
}

async function mondadoriAdapter(pageUrl, count) {
  const info = parseMondadoriUrl(pageUrl);
  if (!info) return null;

  const q = encodeURIComponent(info.slug);
  const data = await fetchJSON(
    `${MSTORE_API}/products/search?query=${q}&currentPage=0&pageSize=${count}&lang=it`,
    MSTORE_HDR
  );
  if (!data?.products?.length) return null;

  // Fetch product details in parallel (capped at 15 for speed)
  const products = data.products.slice(0, Math.min(count, 15));
  const detailed = await Promise.all(
    products.map(p =>
      fetchJSON(`${MSTORE_API}/products/${p.code}?lang=it&fields=name,summary,picture,price,url`, MSTORE_HDR)
        .then(d => ({ ...p, ...d }))
        .catch(() => p)
    )
  );

  const label = info.slug.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const items = detailed.map(p => {
    const price   = p.price?.formattedValue || '';
    const imgBase = p.picture?.URL;
    return {
      title:       p.name ? `${p.name.trim()} — ${price}` : `ISBN ${p.code} — ${price}`,
      url:         `${MSTORE}${p.url}`,
      description: p.summary || `${label} — ${price}`,
      image:       imgBase ? (imgBase.startsWith('http') ? imgBase : `${MSTORE}${imgBase}`) : null,
      date:        new Date(),
    };
  });

  return buildRSS({
    title:       `Mondadori Store — ${label}`,
    link:        pageUrl,
    description: `${label} su Mondadori Store`,
    items,
  });
}

// ── Strategy 3: JSON-LD extraction ─────────────────────────────────────────

function extractJsonLD(html, baseUrl) {
  const items = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const obj   = JSON.parse(m[1]);
      const nodes = Array.isArray(obj) ? obj : [obj];
      for (const node of nodes) {
        if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
          for (const li of node.itemListElement) {
            const it = li.item || li;
            if (it.name && it.url) {
              items.push({
                title:       it.name,
                url:         new URL(it.url, baseUrl).href,
                description: it.description || '',
                image:       it.image?.url || (typeof it.image === 'string' ? it.image : null),
                date:        it.datePublished || new Date(),
              });
            }
          }
        }
        const types = ['Article', 'NewsArticle', 'BlogPosting', 'Product'];
        if (types.includes(node['@type']) && (node.headline || node.name) && node.url) {
          items.push({
            title:       node.headline || node.name,
            url:         new URL(node.url, baseUrl).href,
            description: node.description || '',
            image:       node.image?.url || (typeof node.image === 'string' ? node.image : null),
            date:        node.datePublished || new Date(),
          });
        }
      }
    } catch {}
  }
  return items;
}

// ── Strategy 4: Generic HTML heuristics ────────────────────────────────────

function extractGeneric(html, baseUrl) {
  const origin = new URL(baseUrl).origin;

  // Strip scripts, styles, nav, footer to reduce noise
  const body = html
    .replace(/<(script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const seen  = new Set();
  const items = [];

  // Find all <a href="...">text</a> inside heading-like contexts
  // Pattern: heading or anchor with decent text length
  const linkRe = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lm;
  while ((lm = linkRe.exec(body)) !== null && items.length < 40) {
    const href    = lm[1];
    const rawText = lm[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (rawText.length < 10 || rawText.length > 200) continue;

    let absUrl;
    try { absUrl = new URL(href, baseUrl).href; } catch { continue; }
    if (!absUrl.startsWith(origin)) continue;
    if (seen.has(absUrl)) continue;

    // Skip obvious nav/footer links (very short path or common words)
    const path = new URL(absUrl).pathname;
    if (path === '/' || path === '') continue;

    seen.add(absUrl);

    // Look for nearby image in a window of ~500 chars before the link
    const before = body.slice(Math.max(0, lm.index - 500), lm.index);
    const imgM   = before.match(/src=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i);
    const image  = imgM ? (() => { try { return new URL(imgM[1], baseUrl).href; } catch { return null; } })() : null;

    items.push({ title: rawText, url: absUrl, description: '', image, date: new Date() });
  }

  return items;
}

// ── Main handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const params   = event.queryStringParameters || {};
  const rawUrl   = params.url;
  const count    = Math.min(parseInt(params.count || '20', 10), 50);

  if (!rawUrl) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Parametro ?url= mancante' }),
    };
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl);
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'URL non valido' }),
    };
  }

  const XML  = { ...CORS, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' };
  const JERR = { ...CORS, 'Content-Type': 'application/json' };

  try {
    // 1. RSS/Atom autodiscovery (skip for known API-driven sites)
    if (!targetUrl.includes('mondadoristore.it')) {
      try {
        const raw = await tryAutodiscovery(targetUrl);
        if (raw && (raw.includes('<rss') || raw.includes('<feed'))) {
          return { statusCode: 200, headers: XML, body: raw };
        }
      } catch {}
    }

    // 2. Mondadori OCC API
    if (targetUrl.includes('mondadoristore.it')) {
      try {
        const xml = await mondadoriAdapter(targetUrl, count);
        if (xml) return { statusCode: 200, headers: XML, body: xml };
        console.warn('Mondadori adapter: returned null (no products found)');
      } catch (e) {
        console.error('Mondadori adapter error:', e.message, e.stack);
      }
    }

    // 3 + 4. Generic HTML extraction
    const html      = await fetchText(targetUrl);
    const titleM    = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descM     = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const pageTitle = titleM ? titleM[1].trim() : new URL(targetUrl).hostname;
    const pageDesc  = descM  ? descM[1].trim()  : '';

    // JSON-LD first
    const ldItems = extractJsonLD(html, targetUrl);
    if (ldItems.length >= 3) {
      return {
        statusCode: 200, headers: XML,
        body: buildRSS({ title: pageTitle, link: targetUrl, description: pageDesc, items: ldItems.slice(0, count) }),
      };
    }

    // Generic heuristics
    const items = extractGeneric(html, targetUrl);
    if (items.length === 0) {
      return {
        statusCode: 422, headers: JERR,
        body: JSON.stringify({ error: 'Impossibile estrarre elementi. Il sito potrebbe richiedere JavaScript per il rendering.' }),
      };
    }

    return {
      statusCode: 200, headers: XML,
      body: buildRSS({ title: pageTitle, link: targetUrl, description: pageDesc, items: items.slice(0, count) }),
    };

  } catch (e) {
    console.error('page-to-rss:', e.message);
    return {
      statusCode: 500, headers: JERR,
      body: JSON.stringify({ error: `Errore: ${e.message}` }),
    };
  }
};
