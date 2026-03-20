// Generic CORS proxy for RSS feeds and YouTube channel pages
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing url parameter' };
  }

  // Basic allowlist to prevent abuse
  const allowed = [
    'youtube.com', 'musicaficionado.blog', 'audioz.download',
    'feeds.feedburner.com', 'rss.', 'feed.', '/feed', '/rss',
  ];
  const isAllowed = allowed.some(d => url.includes(d)) || url.startsWith('https://');
  if (!isAllowed) {
    return { statusCode: 403, headers: corsHeaders, body: 'Domain not allowed' };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    const body = await res.text();
    const ct = res.headers.get('content-type') || 'text/plain; charset=utf-8';

    return {
      statusCode: res.status,
      headers: {
        ...corsHeaders,
        'Content-Type': ct.includes('xml') ? 'application/xml; charset=utf-8' : ct,
        'Cache-Control': 'public, max-age=1800',
      },
      body,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
