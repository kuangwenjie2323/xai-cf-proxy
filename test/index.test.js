import test from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  buildCorsHeaders,
  buildUpstreamUrl,
  isAllowedPath,
  isCloudflareBlock,
  isProxyAuthorized,
  jsonError,
} from '../src/index.js';

test('allows open proxy mode by default when no token is configured', async () => {
  const request = new Request('https://example.workers.dev/v1/models');
  assert.equal(isProxyAuthorized(request, {}), true);
});

test('supports explicit open proxy mode', () => {
  const request = new Request('https://example.workers.dev/v1/models');
  assert.equal(isProxyAuthorized(request, { ALLOW_OPEN_PROXY: 'true' }), true);
});

test('can explicitly disable open proxy mode when no token is configured', async () => {
  const request = new Request('https://example.workers.dev/v1/models');
  const response = await worker.fetch(request, { ALLOW_OPEN_PROXY: 'false' });
  assert.equal(response.status, 503);

  const payload = await response.json();
  assert.equal(payload.error.type, 'proxy_not_configured');
});

test('validates proxy token when configured', () => {
  const request = new Request('https://example.workers.dev/v1/models', {
    headers: { 'X-Proxy-Token': 'secret-token' },
  });
  assert.equal(isProxyAuthorized(request, { PROXY_TOKEN: 'secret-token' }), true);
  assert.equal(isProxyAuthorized(new Request('https://example.workers.dev/v1/models'), { PROXY_TOKEN: 'secret-token' }), false);
});

test('only allows /v1/* and health paths', () => {
  assert.equal(isAllowedPath('/v1/chat/completions'), true);
  assert.equal(isAllowedPath('/v1/models'), true);
  assert.equal(isAllowedPath('/__health'), true);
  assert.equal(isAllowedPath('/'), false);
  assert.equal(isAllowedPath('/foo/bar'), false);
});

test('builds upstream URL against api.x.ai', () => {
  const upstream = buildUpstreamUrl(new Request('https://example.workers.dev/v1/models?limit=1'));
  assert.equal(upstream.toString(), 'https://api.x.ai/v1/models?limit=1');
});

test('reflects requested cors headers', () => {
  const headers = buildCorsHeaders(
    new Request('https://example.workers.dev/v1/models', {
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Headers': 'authorization,content-type,x-proxy-token',
      },
    }),
    { ALLOWED_ORIGIN: 'https://app.example.com' },
  );

  assert.equal(headers['Access-Control-Allow-Origin'], 'https://app.example.com');
  assert.match(headers['Access-Control-Allow-Headers'], /x-proxy-token/i);
});

test('rewrites json errors with cors headers', async () => {
  const response = jsonError(
    401,
    'Unauthorized proxy request.',
    'proxy_auth_failed',
    new Request('https://example.workers.dev/v1/models', {
      headers: { Origin: 'https://app.example.com' },
    }),
    {},
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');

  const payload = await response.json();
  assert.equal(payload.error.type, 'proxy_auth_failed');
});

test('detects cloudflare html block pages', () => {
  const body = `<!doctype html><html><body><p>Blocked due to abusive traffic patterns</p></body></html>`;
  assert.equal(isCloudflareBlock(403, 'text/html', body), true);
  assert.equal(isCloudflareBlock(403, 'application/json', '{"error":"forbidden"}'), false);
});
