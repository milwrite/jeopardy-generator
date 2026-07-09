const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const handler = require('serve-handler');

const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function proxyToOpenRouter(req, res) {
  if (!OPENROUTER_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'OpenRouter API key not configured.' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const referer = req.headers.referer || `https://${req.headers.host || 'jeopardy.inference-arcade.com'}`;

    const upstreamReq = https.request(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          'Content-Length': body.length,
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': referer,
          'X-Title': 'Jeopardy Game',
        },
        timeout: 120000,
      },
      (upstreamRes) => {
        const headers = {
          'Content-Type': upstreamRes.headers['content-type'] || 'application/json',
          ...corsHeaders(req.headers.origin),
        };
        res.writeHead(upstreamRes.statusCode, upstreamRes.statusMessage, headers);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on('error', (err) => {
      console.error('OpenRouter proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy failed', message: err.message }));
    });

    upstreamReq.write(body);
    upstreamReq.end();
  });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (pathname === '/api/ai/chat' && req.method === 'POST') {
    proxyToOpenRouter(req, res);
    return;
  }

  handler(req, res, { public: path.join(__dirname, 'out') }).catch((err) => {
    console.error('Static handler error:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
