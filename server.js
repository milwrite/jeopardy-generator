const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');
const handler = require('serve-handler');
const { createUserApi } = require('./server/userApi');

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
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy failed', message: err.message }));
    });

    upstreamReq.write(body);
    upstreamReq.end();
  });
}

function createAppServer(options = {}) {
  const userApi = options.userApi || createUserApi(options.userApiOptions);
  const publicDirectory = options.publicDirectory || path.join(__dirname, 'out');

  const server = http.createServer((req, res) => {
    const routeRequest = async () => {
      let pathname;
      try {
        pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid request URL' }));
        return;
      }

      if (await userApi.handle(req, res, pathname)) return;

      if (pathname === '/api/ai/chat') {
        const origin = req.headers.origin || '*';
        for (const [name, value] of Object.entries(corsHeaders(origin))) {
          res.setHeader(name, value);
        }
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method === 'POST') {
          proxyToOpenRouter(req, res);
          return;
        }
        res.writeHead(405, {
          'Content-Type': 'application/json; charset=utf-8',
          Allow: 'POST, OPTIONS',
        });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      await handler(req, res, { public: publicDirectory });
    };

    routeRequest().catch((err) => {
      console.error('Server request error:', err);
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  if (!options.userApi) {
    server.on('close', () => userApi.close());
  }
  server.userApi = userApi;
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}; user data: ${server.userApi.databasePath}`);
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = {
  createAppServer,
  proxyToOpenRouter,
};
