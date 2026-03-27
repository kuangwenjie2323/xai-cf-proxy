const TARGET = 'https://api.x.ai';

// Headers to strip from the proxied response (Cloudflare hop headers)
const HOP_HEADERS = new Set([
  'cf-ray',
  'cf-cache-status',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-visitor',
  'server',
  'alt-svc',
]);

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Optional: simple bearer token gate so only you can use this proxy
    if (env.PROXY_TOKEN) {
      const proxyAuth = request.headers.get('X-Proxy-Token');
      if (proxyAuth !== env.PROXY_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    // Rewrite URL: replace worker host with api.x.ai
    const url = new URL(request.url);
    const target = new URL(TARGET);
    url.hostname = target.hostname;
    url.port = target.port;
    url.protocol = target.protocol;

    // Forward the request
    const headers = new Headers(request.headers);
    headers.set('Host', target.hostname);
    // Remove cf-connecting-ip etc. to look like a direct request
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');

    const response = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'follow',
    });

    // Build clean response headers
    const respHeaders = new Headers(response.headers);
    respHeaders.set('Access-Control-Allow-Origin', '*');
    for (const h of HOP_HEADERS) {
      respHeaders.delete(h);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  },
};
