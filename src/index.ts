// Worker entrypoint — serves static Next.js output via Cloudflare Assets binding
// and proxies /api/ai/chat to OpenRouter using a runtime secret so the API key
// never ships in the client bundle.

export { UserStore } from './userStore';

interface DurableObjectIdLike {}

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

export interface Env {
  ASSETS: { fetch: typeof fetch };
  USER_STORE: DurableObjectNamespaceLike;
  OPENROUTER_API_KEY?: string;
  NEXT_PUBLIC_OPENROUTER_API_KEY?: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function isUserBackendPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/') ||
    pathname === '/api/boards' ||
    pathname.startsWith('/api/boards/');
}

function isMutation(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function sameOriginRequest(request: Request, url: URL): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === url.origin;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(requestOrigin) });
    }

    if (isUserBackendPath(url.pathname)) {
      if (isMutation(request.method) && !sameOriginRequest(request, url)) {
        return new Response(JSON.stringify({ error: 'Cross-origin request rejected' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      const objectId = env.USER_STORE.idFromName('primary');
      return env.USER_STORE.get(objectId).fetch(request);
    }

    if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
      const apiKey = env.OPENROUTER_API_KEY || env.NEXT_PUBLIC_OPENROUTER_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: 'OpenRouter API key not configured on the worker.' }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(requestOrigin) },
          },
        );
      }

      const referer = request.headers.get('referer') || url.origin;

      try {
        const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': request.headers.get('Content-Type') || 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': referer,
            'X-Title': 'Jeopardy Game',
          },
          body: request.body,
        });

        const headers: Record<string, string> = {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          ...corsHeaders(requestOrigin),
        };
        const contentLength = upstream.headers.get('Content-Length');
        if (contentLength) headers['Content-Length'] = contentLength;

        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers,
        });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: 'Proxy failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders(requestOrigin) },
          },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
