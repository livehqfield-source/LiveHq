// Hosted apps: each AI can publish its own single-file HTML app to /apps/<slug>.
// The app runs in a sandbox (opaque origin): it can never read hub/admin cookies or call the hub.
import { AIS, AppError, sastDate, fmtDate } from './core.js';
import { esc } from './html.js';

export const PUBLISH_LIMIT = 30;           // publishes per AI per day
export const MAX_HTML_BYTES = 1048576;     // 1 MB
const MAX_APPS_PER_AI = 20;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SANDBOX = 'allow-scripts allow-forms allow-downloads allow-modals allow-popups';
// Reserved slots: placeholder shown until the owner publishes. Only the owner may publish there; the title is fixed.
export const RESERVED = {
  'live-hq-invoice-maker': { title: 'Live HQ Invoice Maker', owner: 'claude', description: "Claude's invoice maker for Live HQ." },
};
const CDN = 'https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://esm.sh';
export const APP_CSP = `sandbox ${SANDBOX}; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${CDN}; ` +
  `style-src 'unsafe-inline' ${CDN} https://fonts.googleapis.com; font-src data: ${CDN} https://fonts.gstatic.com; img-src data: blob: https:; ` +
  `connect-src ${CDN}; worker-src blob:; media-src data: blob:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;
const WRAP_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

const who = (ai, via) => via === 'admin' ? 'Johan (admin)' : `${AIS[ai].name} via ${via === 'mcp' ? 'connector' : 'API'}`;
function str(v, max, field, required) {
  if (v === undefined || v === null || v === '') { if (required) throw new AppError(400, `Add ${field}.`); return ''; }
  if (typeof v !== 'string') throw new AppError(400, `${field} must be text.`);
  const s = v.replace(/\0/g, '').trim();
  if (s.length > max) throw new AppError(400, `The ${field} is too long (max ${max} characters).`);
  return s;
}
export function checkSlug(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.length < 3 || s.length > 60 || !SLUG_RE.test(s)) throw new AppError(400, 'slug must be 3-60 characters of lowercase letters, numbers and dashes, e.g. live-hq-invoice-maker.');
  return s;
}

export async function getApp(env, slug) {
  const m = await env.KV.get('appmeta:' + slug, 'json');
  if (m) return m;
  const r = RESERVED[slug];
  return r ? { slug, title: r.title, owner: r.owner, description: r.description, status: 'waiting', reserved: true } : null;
}
function view(m, origin) {
  return { slug: m.slug, title: m.title, owner: AIS[m.owner] ? AIS[m.owner].name : m.owner, description: m.description || '', status: m.status === 'live' ? 'live' : 'waiting for upload',
    url: `${origin}/apps/${m.slug}`, updated: m.updated_at ? fmtDate(m.updated_at) : null, updated_by: m.updated_by || null, size_bytes: m.size || 0, reserved: !!RESERVED[m.slug] };
}
export async function listAllApps(env) {
  const out = new Map();
  for (const [slug, r] of Object.entries(RESERVED)) out.set(slug, { slug, title: r.title, owner: r.owner, description: r.description, status: 'waiting' });
  let cursor;
  do {
    const l = await env.KV.list({ prefix: 'appmeta:', cursor });
    for (const k of l.keys) { const m = await env.KV.get(k.name, 'json'); if (m) out.set(m.slug, m); }
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  return [...out.values()].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0) || a.slug.localeCompare(b.slug));
}
export async function listMyApps(env, ai, origin) {
  const apps = (await listAllApps(env)).filter((m) => m.owner === ai).map((m) => view(m, origin));
  return { apps, count: apps.length, publishes_today: parseInt((await env.KV.get(`acount:${ai}:${sastDate()}`)) || '0', 10), daily_publish_limit: PUBLISH_LIMIT };
}

export async function publishApp(env, ai, via, a, origin) {
  const slug = checkSlug(a.slug);
  const res = RESERVED[slug];
  const existing = await env.KV.get('appmeta:' + slug, 'json');
  const owner = res ? res.owner : existing ? existing.owner : ai;
  if (owner !== ai) throw new AppError(403, `The app slot "${slug}" belongs to ${AIS[owner] ? AIS[owner].name : 'another AI'}. Pick another slug.`);
  const title = res ? res.title : str(a.title, 100, 'title', true);
  const description = str(a.description, 500, 'description', false) || (res ? res.description : '');
  if (typeof a.html !== 'string' || !a.html.trim()) throw new AppError(400, 'Add html: one complete, self-contained HTML document.');
  const html = a.html.replace(/\0/g, '');
  const size = new TextEncoder().encode(html).length;
  if (size > MAX_HTML_BYTES) throw new AppError(413, `The html is too big (${Math.round(size / 1024)} KB, max 1 MB).`);
  if (!/<html[\s>]|<!doctype html/i.test(html)) throw new AppError(400, 'html must be a full HTML document (starting with <!DOCTYPE html>). If you have a React/JSX component, wrap it in one HTML file that loads React, ReactDOM and Babel standalone from a CDN and renders it.');
  if (!existing && !res) {
    const mine = (await listAllApps(env)).filter((m) => m.owner === ai).length;
    if (mine >= MAX_APPS_PER_AI) throw new AppError(400, `You already have ${MAX_APPS_PER_AI} apps. Unpublish one first.`);
  }
  const ck = `acount:${ai}:${sastDate()}`;
  const n = parseInt((await env.KV.get(ck)) || '0', 10);
  if (n >= PUBLISH_LIMIT) throw new AppError(429, `Daily publish limit reached (${PUBLISH_LIMIT} per day). It resets at midnight South African time.`);
  await env.KV.put(ck, String(n + 1), { expirationTtl: 172800 });
  await env.KV.put('apphtml:' + slug, html);
  const meta = { slug, title, owner: ai, description, status: 'live', size, created_at: (existing && existing.created_at) || Date.now(), updated_at: Date.now(), updated_by: who(ai, via) };
  await env.KV.put('appmeta:' + slug, JSON.stringify(meta));
  return { ok: true, message: `Published. Johan can open it at ${origin}/apps/${slug}`, app: view(meta, origin) };
}

export async function unpublishApp(env, ai, via, slugIn) {
  const slug = checkSlug(slugIn);
  const m = await getApp(env, slug);
  if (!m || (via !== 'admin' && m.owner !== ai)) throw new AppError(404, 'App not found among your apps.');
  await env.KV.delete('apphtml:' + slug);
  await env.KV.delete('appmeta:' + slug);
  return { ok: true, slug, message: RESERVED[slug] ? 'Unpublished. The slot stays reserved and shows "Waiting for upload" again.' : 'Unpublished and removed.' };
}

// ---- public serving ----
export async function serveApp(env, url, parts) {
  const slug = parts[1];
  if (!slug || !SLUG_RE.test(slug) || parts.length > 3 || (parts[2] && parts[2] !== 'raw')) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const m = await getApp(env, slug);
  if (!m) return new Response('App not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (parts[2] === 'raw') {
    const html = m.status === 'live' ? await env.KV.get('apphtml:' + slug) : null;
    if (!html) return new Response('This app has not been uploaded yet.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': "sandbox; default-src 'none'" } });
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': APP_CSP, 'x-frame-options': 'SAMEORIGIN', 'cross-origin-resource-policy': 'same-origin', 'cache-control': 'no-cache' } });
  }
  const ownerName = AIS[m.owner] ? AIS[m.owner].name : 'the AI';
  const body = m.status === 'live'
    ? `<iframe src="/apps/${esc(slug)}/raw" title="${esc(m.title)}" sandbox="${SANDBOX}" allow="clipboard-write" referrerpolicy="no-referrer"></iframe>`
    : `<div class="wait"><h1>${esc(m.title)}</h1><p>Waiting for ${esc(ownerName)} to upload.</p><p class="m">This page will show the app as soon as ${esc(ownerName)} publishes it.</p></div>`;
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(m.title)} · Live HQ</title>
<style>html,body{margin:0;height:100%;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9}body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#0f1b2d;color:#fff;font-size:15px;flex:0 0 auto}header b{color:#8ab4f8}header span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
iframe{flex:1 1 auto;width:100%;border:0;background:#fff}.wait{margin:40px auto;max-width:520px;background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}.wait h1{font-size:22px}.m{color:#5f6368}</style></head>
<body><header><b>Live HQ</b><span>${esc(m.title)}</span></header>${body}</body></html>`;
  return new Response(doc, { status: m.status === 'live' ? 200 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': WRAP_CSP, 'cache-control': 'no-cache' } });
}

// ---- admin page body ----
export async function appsAdminBody(env, origin, session) {
  const apps = await listAllApps(env);
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
  const rows = apps.map((m) => {
    const live = m.status === 'live';
    return `<div class="card"><div class="bhead"><h2>${esc(m.title)}</h2>${live ? '<span class="pill on">Live</span>' : `<span class="pill off">Waiting for ${esc(AIS[m.owner] ? AIS[m.owner].name : m.owner)} to upload</span>`}</div>
<p><span class="lbl">Owner:</span> ${esc(AIS[m.owner] ? AIS[m.owner].name : m.owner)} · <span class="lbl">Link:</span> <a href="/apps/${esc(m.slug)}" target="_blank" rel="noopener">${esc(origin)}/apps/${esc(m.slug)}</a></p>
${m.description ? `<p class="muted">${esc(m.description)}</p>` : ''}<p class="muted">Updated: ${m.updated_at ? `${esc(fmtDate(m.updated_at))} by ${esc(m.updated_by || '')} · ${Math.round((m.size || 0) / 1024)} KB` : 'not uploaded yet'}</p>
${live ? `<form method="post" action="/admin/action" class="inline">${csrf}<input type="hidden" name="action" value="app_unpublish"><input type="hidden" name="slug" value="${esc(m.slug)}"><button type="submit" class="grey">Unpublish</button></form>` : ''}</div>`;
  }).join('\n');
  return `<h1 class="pt">Apps</h1><p class="muted">Apps the AIs built and published themselves. Anyone with the link can open them (no sign-in), so they work on your phone. Each app runs in a locked box and cannot see your admin or email.</p>${rows || '<div class="card muted">No apps yet.</div>'}`;
}
