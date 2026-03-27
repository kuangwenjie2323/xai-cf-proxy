const TARGET = 'https://api.x.ai';
const DEFAULT_ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const DEFAULT_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Proxy-Token'];
const DEFAULT_ALLOWED_PATH_PREFIXES = ['/v1/'];
const HTML_ERROR_RE = /^\s*(?:<!doctype\s+html\b|<html\b)/i;
const CLOUDFLARE_MARKERS_RE = /blocked due to abusive traffic patterns|cloudflare|__cf\$cv\$params|cdn-cgi\/challenge-platform/i;

// Headers to strip from proxied responses.
const HOP_HEADERS = new Set([
  'cf-ray',
  'cf-cache-status',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-visitor',
  'server',
  'alt-svc',
  'content-length',
]);

export function resolveCorsOrigin(request, env) {
  const requestOrigin = request.headers.get('Origin');
  const configured = env.ALLOWED_ORIGIN?.trim();

  if (!configured || configured === '*') {
    return requestOrigin || '*';
  }

  return requestOrigin === configured ? configured : 'null';
}

export function buildCorsHeaders(request, env) {
  const requestedHeaders = request.headers.get('Access-Control-Request-Headers');

  return {
    'Access-Control-Allow-Origin': resolveCorsOrigin(request, env),
    'Access-Control-Allow-Methods': DEFAULT_ALLOWED_METHODS,
    'Access-Control-Allow-Headers': requestedHeaders || DEFAULT_ALLOWED_HEADERS.join(', '),
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Access-Control-Request-Headers',
  };
}

export function jsonError(status, message, type, request, env, extra = {}) {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type,
        status,
        ...extra,
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...buildCorsHeaders(request, env),
      },
    },
  );
}

export function isProxyAuthorized(request, env) {
  const proxyToken = env.PROXY_TOKEN?.trim();
  const allowOpenProxy = env.ALLOW_OPEN_PROXY?.trim() === 'true';

  if (!proxyToken) return allowOpenProxy;
  return request.headers.get('X-Proxy-Token') === proxyToken;
}

export function isAllowedPath(pathname) {
  if (pathname === '/__health') return true;
  return DEFAULT_ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isHtmlResponse(contentType, bodyText) {
  return contentType.includes('text/html') || HTML_ERROR_RE.test(bodyText);
}

export function isCloudflareBlock(status, contentType, bodyText) {
  if (status !== 403 && status !== 429 && status < 500) return false;
  if (!isHtmlResponse(contentType, bodyText)) return false;
  return CLOUDFLARE_MARKERS_RE.test(bodyText);
}

export async function rewriteUpstreamError(response, request, env) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html') && response.status < 400) {
    return null;
  }

  const bodyText = await response.text();
  if (!isHtmlResponse(contentType, bodyText)) {
    return new Response(bodyText, {
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeResponseHeaders(response.headers, request, env),
    });
  }

  if (isCloudflareBlock(response.status, contentType, bodyText)) {
    return jsonError(
      response.status,
      'Upstream xAI security gateway blocked this request.',
      'upstream_waf_error',
      request,
      env,
      { retryable: true },
    );
  }

  return jsonError(
    response.status >= 400 ? response.status : 502,
    'Upstream service returned an HTML error page instead of a JSON API response.',
    'upstream_html_error',
    request,
    env,
    { retryable: response.status >= 500 },
  );
}

export function sanitizeResponseHeaders(sourceHeaders, request, env) {
  const headers = new Headers(sourceHeaders);
  const corsHeaders = buildCorsHeaders(request, env);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  for (const header of HOP_HEADERS) {
    headers.delete(header);
  }

  return headers;
}

export function buildUpstreamUrl(request) {
  const incoming = new URL(request.url);
  const target = new URL(TARGET);

  incoming.protocol = target.protocol;
  incoming.hostname = target.hostname;
  incoming.port = target.port;

  return incoming;
}

export function buildUpstreamRequest(request) {
  const headers = new Headers(request.headers);
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-for');
  headers.delete('X-Proxy-Token');
  headers.set('Host', new URL(TARGET).hostname);

  return {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'follow',
  };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(request, env),
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/__health') {
      return new Response(
        JSON.stringify({
          ok: true,
          target: TARGET,
          authMode: env.PROXY_TOKEN?.trim() ? 'token' : env.ALLOW_OPEN_PROXY?.trim() === 'true' ? 'open' : 'misconfigured',
          allowedPathPrefixes: DEFAULT_ALLOWED_PATH_PREFIXES,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...buildCorsHeaders(request, env),
          },
        },
      );
    }

    if (!isAllowedPath(url.pathname)) {
      return jsonError(404, `Path not allowed: ${url.pathname}`, 'path_not_allowed', request, env);
    }

    if (!isProxyAuthorized(request, env)) {
      const missingProxyToken = !env.PROXY_TOKEN?.trim() && env.ALLOW_OPEN_PROXY?.trim() !== 'true';
      return jsonError(
        missingProxyToken ? 503 : 401,
        missingProxyToken
          ? 'Proxy is not configured. Set PROXY_TOKEN or explicitly allow open access.'
          : 'Unauthorized proxy request.',
        missingProxyToken ? 'proxy_not_configured' : 'proxy_auth_failed',
        request,
        env,
      );
    }

    const upstreamUrl = buildUpstreamUrl(request);

    try {
      const upstreamResponse = await fetch(upstreamUrl.toString(), buildUpstreamRequest(request));
      const rewrittenError = await rewriteUpstreamError(upstreamResponse.clone(), request, env);
      if (rewrittenError) return rewrittenError;

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: sanitizeResponseHeaders(upstreamResponse.headers, request, env),
      });
    } catch (error) {
      return jsonError(
        502,
        `Proxy request failed: ${error instanceof Error ? error.message : String(error)}`,
        'proxy_fetch_failed',
        request,
        env,
        { retryable: true },
      );
    }
  },
};
