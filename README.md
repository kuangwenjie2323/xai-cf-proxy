# xai-cf-proxy

Cloudflare Worker reverse proxy for xAI API (`api.x.ai`).

Solves Cloudflare 403 blocks when calling `api.x.ai` from VPS/data-center IPs.

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Your proxy will be available at: `https://xai-cf-proxy.<your-subdomain>.workers.dev`

## Usage

Set your `GROK_BASE_URL` to the worker URL:

```bash
GROK_BASE_URL=https://xai-cf-proxy.<your-subdomain>.workers.dev/v1
```

Your `Authorization: Bearer <XAI_API_KEY>` header passes through unchanged.

If you enable a proxy token, also send:

```bash
curl https://xai-cf-proxy.<your-subdomain>.workers.dev/v1/models \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "X-Proxy-Token: $PROXY_TOKEN"
```

## Security model

- The proxy is **open by default** when `PROXY_TOKEN` is not set.
- Set `PROXY_TOKEN` if you want private access enforced.
- Only `/v1/*` API paths are forwarded.
- Cloudflare / HTML upstream error pages are rewritten into JSON errors so downstream clients do not receive raw HTML.

## Environment

Recommended secrets / vars:

```bash
npx wrangler secret put PROXY_TOKEN
```

Optional plain vars:

```bash
# Restrict browser callers if needed. Default behavior reflects request Origin.
ALLOWED_ORIGIN=https://your-app.example.com

# Optional hard fail when PROXY_TOKEN is absent.
ALLOW_OPEN_PROXY=false
```

## Health check

```bash
curl https://xai-cf-proxy.<your-subdomain>.workers.dev/__health
```

Example response:

```json
{
  "ok": true,
  "target": "https://api.x.ai",
  "authMode": "open",
  "allowedPathPrefixes": ["/v1/"]
}
```

## Notes

- If xAI still returns a Cloudflare challenge / WAF block, this Worker converts it into structured JSON.
- Browser usage requires CORS preflight support for `X-Proxy-Token`.
- For server-to-server traffic, keep this Worker private and do not rely on a hidden workers.dev URL alone.
