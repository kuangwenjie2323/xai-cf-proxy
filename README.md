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

All requests are transparently proxied to `api.x.ai`. Your `Authorization: Bearer <XAI_API_KEY>` header passes through unchanged.

## Optional: Access Control

To restrict proxy access to only your services:

```bash
npx wrangler secret put PROXY_TOKEN
# Enter a random token

# Then add this header to your requests:
# X-Proxy-Token: <your-token>
```

If `PROXY_TOKEN` is not set, the proxy is open (relies on the worker URL being private).
