// Adatta una Netlify function (exports.handler) al formato Vercel (req, res)
async function netlifyToVercel(netlifyHandler, req, res) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    req.on('data', c => chunks.push(c));
    req.on('end', resolve);
    req.on('error', reject);
  });
  const body = Buffer.concat(chunks).toString();

  const event = {
    httpMethod: req.method,
    path: req.url,
    queryStringParameters: Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
    headers: req.headers,
    body,
    isBase64Encoded: false,
  };

  const result = await netlifyHandler(event, {});

  res.statusCode = result.statusCode || 200;
  Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(result.body || '');
}

module.exports = { netlifyToVercel };
