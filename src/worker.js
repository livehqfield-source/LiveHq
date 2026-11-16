// Live HQ — Cloudflare Worker entry point.
import { AppError, ACCOUNT } from './core.js';
import { handleMcp, handleRest, openapi, json } from './api.js';
import { handleAiWeb } from './aiweb.js';
import { handleAdmin, handleOAuthCallback } from './admin.js';
import { page, COPY_JS } from './html.js';
import { serveApp } from './apps.js';
import { handleOrderPilot } from './orderpilot.js';
export const PUBLIC_HOST = 'live-hq.pages.dev';

function secure(resp, isHtml) {
  const r = new Response(resp.body, resp);
  const h = r.headers;
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'no-referrer');
  if (!h.has('x-frame-options')) h.set('x-frame-options', 'DENY');
  h.set('x-robots-tag', 'noindex, nofollow');
  if (!h.has('cache-control')) h.set('cache-control', 'no-store');
  if (!h.has('content-security-policy') && ((h.get('content-type') || '').includes('text/html') || isHtml)) {
    h.set('content-security-policy', "default-src 'none'; script-src 'self'; connect-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'");
  }
  return r;
}

function sameOriginPost(req, url) {
  const o = req.headers.get('origin');
  if (o && o !== 'null' && o !== url.origin) return false;
  const site = req.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return true;
}

async function route(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') {
    return new Response(page('Live HQ', `<div class="card"><p>Private email hub for ${ACCOUNT}. Nothing to see here.</p><p><a href="/admin">Admin sign in</a></p></div>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  if (path === '/health') return json({ ok: true });
  if (path === '/orderpilot' || path === '/orderpilot/') return handleOrderPilot(req);
  if (path === '/openapi.json') return json(openapi(url.origin), 200, { 'access-control-allow-origin': '*' });
  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });

  if (path === '/mcp') return handleMcp(req, env, url, null);
  const mk = path.match(/^\/mcp\/([A-Za-z0-9_-]{20,120})$/);
  if (mk) return handleMcp(req, env, url, mk[1]);

  if (path.startsWith('/api/v1/')) return handleRest(req, env, url, path.slice('/api/v1/'.length));

  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'apps' && parts.length >= 2) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return serveApp(env, url, parts);
  }
  if (parts[0] === 'ai' && parts.length >= 2) {
    if (req.method === 'POST' && !sameOriginPost(req, url)) return new Response('Forbidden', { status: 403 });
    if (req.method !== 'GET' && req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (req.method === 'POST' && parts.length !== 3) return new Response('Not found', { status: 404 });
    return handleAiWeb(req, env, url, parts);
  }
  if (path === '/admin/assets/copy.js' && req.method === 'GET') return new Response(COPY_JS, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (req.method === 'POST' && !sameOriginPost(req, url)) return new Response('Forbidden', { status: 403 });
    return handleAdmin(req, env, url, path);
  }
  if (path === '/oauth/google/callback' && req.method === 'GET') return handleOAuthCallback(req, env, url);
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Live HQ on Cloudflare Pages proxies here. Only the one known public host is accepted from
    // X-Forwarded-Host, so links, cookies and the Google redirect use https://live-hq.pages.dev.
    if (req.headers.get('x-forwarded-host') === PUBLIC_HOST && url.hostname !== PUBLIC_HOST && url.protocol === 'https:') {
      url.hostname = PUBLIC_HOST; url.port = '';
    }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      url.protocol = 'https:';
      return secure(new Response(null, { status: 308, headers: { location: url.toString() } }));
    }
    if (!env.KV || !env.ENC_KEY || !env.SESSION_SECRET || !env.ADMIN_PASSWORD) {
      return secure(new Response('Live HQ is not set up yet.', { status: 503 }));
    }
    try {
      return secure(await route(req, env, url));
    } catch (e) {
      if (e instanceof AppError) return secure(json({ error: e.message }, e.status));
      console.error('unhandled', String(e && e.message).slice(0, 200));
      return secure(json({ error: 'Something went wrong on the server.' }, 500));
    }
  },
};
