// Live HQ — core helpers, Gmail access, mail actions.
export const ACCOUNT = 'livehqfield@gmail.com';
const ACCOUNT_LOCAL = 'livehqfield';
export const AIS = {
  chatgpt: { name: 'ChatGPT', label: 'ChatGPT' },
  claude: { name: 'Claude', label: 'Claude' },
  grok: { name: 'Grok', label: 'Grok' },
  copilot: { name: 'Co Pilot', label: 'Co Pilot' },
};
export const AI_IDS = Object.keys(AIS);
export const DAILY_LIMIT = 50;
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const plusAddr = (ai) => `${ACCOUNT_LOCAL}+${ai}@gmail.com`;
const OWN_RE = /^livehqfield(\+[a-z0-9._-]+)?@gmail\.com$/i;

export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- encoding / crypto ----------
export const te = new TextEncoder();
export const td = new TextDecoder();
export function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64StdFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function bytesFromB64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomToken(n = 32) { return b64urlFromBytes(crypto.getRandomValues(new Uint8Array(n))); }
export async function sha256Hex(str) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(str)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlFromBytes(new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(msg))));
}
// Constant-time string comparison (no early exit).
export function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function aesKey(env) {
  return crypto.subtle.importKey('raw', bytesFromB64url(env.ENC_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptStr(env, s) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), te.encode(s)));
  return 'v1.' + b64urlFromBytes(iv) + '.' + b64urlFromBytes(ct);
}
export async function decryptStr(env, s) {
  const [v, iv, ct] = String(s).split('.');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64url(iv) }, await aesKey(env), bytesFromB64url(ct));
  return td.decode(pt);
}

// ---------- time ----------
export const sastDate = (ms = Date.now()) => new Date(ms + 2 * 3600e3).toISOString().slice(0, 10);
export function fmtDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms) + 2 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' SAST';
}

// ---------- settings ----------
export async function getSettings(env) {
  const s = (await env.KV.get('settings', 'json')) || {};
  const display = {};
  for (const ai of AI_IDS) display[ai] = (s.display && s.display[ai]) || 'Doenit net';
  return {
    sending_enabled: s.sending_enabled !== false,
    reply_to_plus: s.reply_to_plus !== false,
    display,
  };
}
export async function saveSettings(env, s) { await env.KV.put('settings', JSON.stringify(s)); }

export async function getGoogleClient(env) {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, source: 'worker-secret' };
  }
  const e = await env.KV.get('google:client');
  if (e) {
    try { const j = JSON.parse(await decryptStr(env, e)); return { id: j.id, secret: j.secret, source: 'admin-page' }; } catch { return null; }
  }
  return null;
}

// ---------- Gmail API ----------
export async function getAccessToken(env) {
  const cached = await env.KV.get('gmail:at');
  if (cached) {
    try { const j = JSON.parse(await decryptStr(env, cached)); if (j.exp > Date.now() + 60000) return j.token; } catch { /* refresh */ }
  }
  const rtEnc = await env.KV.get('gmail:rt');
  if (!rtEnc) throw new AppError(503, 'Gmail is not connected yet. Johan must click "Connect Gmail" on the admin page.');
  const client = await getGoogleClient(env);
  if (!client) throw new AppError(503, 'The Google login key is not set up yet.');
  const rt = await decryptStr(env, rtEnc);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') {
      const st = (await env.KV.get('gmail:state', 'json')) || {};
      await env.KV.put('gmail:state', JSON.stringify({ ...st, state: 'needs_reconnect', at: Date.now() }));
      throw new AppError(503, 'The Gmail connection has expired. Johan must click "Connect Gmail" again on the admin page.');
    }
    throw new AppError(502, 'Could not refresh Gmail access (' + String(j.error || r.status).slice(0, 60) + ').');
  }
  const ttl = Number(j.expires_in) || 3600;
  await env.KV.put('gmail:at', await encryptStr(env, JSON.stringify({ token: j.access_token, exp: Date.now() + ttl * 1000 })), { expirationTtl: Math.max(60, ttl - 60) });
  return j.access_token;
}

export async function gmail(env, path, opts = {}) {
  const token = await getAccessToken(env);
  const r = await fetch(GMAIL + path, {
    method: opts.method || 'GET',
    headers: { authorization: 'Bearer ' + token, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 404) throw new AppError(404, 'Not found.');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j && j.error && j.error.message ? String(j.error.message).slice(0, 200) : String(r.status);
    throw new AppError(r.status === 429 ? 429 : 502, 'Gmail error: ' + msg);
  }
  return j;
}

export const labelNames = (ai) => [AIS[ai].label, AIS[ai].label + '/Inbox', AIS[ai].label + '/Sent'];

export async function labelMap(env, force = false) {
  let map = force ? null : await env.KV.get('labels', 'json');
  const all = AI_IDS.flatMap(labelNames);
  if (!map || all.some((n) => !map[n])) {
    const j = await gmail(env, '/labels');
    map = {};
    for (const l of j.labels || []) map[l.name] = l.id;
    await env.KV.put('labels', JSON.stringify(map), { expirationTtl: 3600 });
  }
  return map;
}
export async function labelIds(env, ai) {
  const map = await labelMap(env);
  const [a, b, c] = labelNames(ai);
  const missing = [a, b, c].filter((n) => !map[n]);
  if (missing.length) throw new AppError(500, 'Missing Gmail label(s): ' + missing.join(', '));
  const others = new Set(AI_IDS.filter((x) => x !== ai).flatMap(labelNames).map((n) => map[n]).filter(Boolean));
  return { main: map[a], inbox: map[b], sent: map[c], others };
}

// ---------- message parsing ----------
export function hdr(msg, name) {
  const h = (msg.payload && msg.payload.headers) || [];
  const f = h.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return f ? f.value : '';
}
export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function htmlToText(h) {
  return decodeEntities(String(h)
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function extractBody(payload) {
  let text = null, html = null;
  const files = [];
  (function walk(p) {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    if (p.filename) files.push(p.filename);
    else if (p.body && p.body.data) {
      const s = td.decode(bytesFromB64url(p.body.data));
      if (mt === 'text/plain' && text === null) text = s;
      else if (mt === 'text/html' && html === null) html = s;
    }
    (p.parts || []).forEach(walk);
  })(payload);
  let body = text !== null ? text : html !== null ? htmlToText(html) : '';
  if (body.length > 20000) body = body.slice(0, 20000) + '\n[... cut, the message is too long]';
  return { body, attachments: files };
}
function mailboxOf(m, ids) {
  const l = m.labelIds || [];
  if (l.includes(ids.sent) || l.includes('SENT')) return 'sent';
  if (l.includes(ids.inbox)) return 'inbox';
  return 'other';
}
export function summarize(m) {
  return {
    id: m.id,
    thread_id: m.threadId,
    date: fmtDate(m.internalDate),
    from: hdr(m, 'From'),
    to: hdr(m, 'To'),
    subject: hdr(m, 'Subject') || '(no subject)',
    snippet: decodeEntities(m.snippet || ''),
    unread: (m.labelIds || []).includes('UNREAD'),
  };
}
function fullView(m, ids) {
  const { body, attachments } = extractBody(m.payload);
  return { ...summarize(m), cc: hdr(m, 'Cc'), reply_to: hdr(m, 'Reply-To'), mailbox: mailboxOf(m, ids), body, attachments };
}

// ---------- read actions ----------
export async function listMail(env, ai, kind, { max = 10, pageToken, q } = {}) {
  const ids = await labelIds(env, ai);
  max = Math.min(Math.max(parseInt(max, 10) || 10, 1), 25); // keeps us under the Workers sub-request limit
  const p = new URLSearchParams({ maxResults: String(max) });
  p.append('labelIds', kind === 'inbox' ? ids.inbox : kind === 'sent' ? ids.sent : ids.main);
  if (q) p.set('q', String(q).slice(0, 500));
  if (pageToken) p.set('pageToken', String(pageToken).slice(0, 200));
  const j = await gmail(env, '/messages?' + p);
  const msgs = await Promise.all((j.messages || []).map((m) =>
    gmail(env, `/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)));
  return { mailbox: kind === 'all' ? 'search' : kind, query: q || null, count: msgs.length, messages: msgs.map(summarize), next_page_token: j.nextPageToken || null };
}

export async function getOwnedMessage(env, ai, id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''))) throw new AppError(400, 'That message id is not valid.');
  const ids = await labelIds(env, ai);
  const m = await gmail(env, `/messages/${id}?format=full`);
  const l = m.labelIds || [];
  if (!(l.includes(ids.main) || l.includes(ids.inbox) || l.includes(ids.sent))) throw new AppError(404, 'That message is not in your mailbox.');
  return { m, ids };
}

export async function readEmail(env, ai, id, includeThread = true) {
  const { m, ids } = await getOwnedMessage(env, ai, id);
  const out = { message: fullView(m, ids) };
  if (includeThread) {
    const t = await gmail(env, `/threads/${encodeURIComponent(m.threadId)}?format=full`);
    // Show the whole conversation, but never messages that belong to another AI.
    out.thread = (t.messages || [])
      .filter((x) => !(x.labelIds || []).some((l) => ids.others.has(l)))
      .map((x) => fullView(x, ids));
  }
  return out;
}

// ---------- sending ----------
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
function noBreaks(v, max = 998) {
  v = String(v ?? '');
  if (/[\r\n\0]/.test(v)) throw new AppError(400, 'Line breaks are not allowed in names, addresses or the subject.');
  return v.trim().slice(0, max);
}
export function encodeWord(s) {
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64StdFromBytes(te.encode(s))}?=`;
}
function encodeName(n) {
  return /^[\x20-\x7E]*$/.test(n) ? `"${n.replace(/["\\]/g, '\\$&')}"` : encodeWord(n);
}
export function parseAddrList(input) {
  if (input == null || input === '') return [];
  const arr = Array.isArray(input) ? input : String(input).split(/[,;]/);
  const out = [];
  for (let a of arr) {
    a = noBreaks(a, 300);
    if (!a) continue;
    const m = a.match(/^(.*)<([^<>]+)>$/);
    const email = (m ? m[2] : a).trim();
    if (!EMAIL_RE.test(email)) throw new AppError(400, `"${a.slice(0, 80)}" is not a valid email address.`);
    const name = m ? m[1].trim().replace(/^"|"$/g, '') : '';
    out.push({ email: email.toLowerCase(), header: name ? `${encodeName(name)} <${email}>` : email });
  }
  return out;
}
function emailsIn(h) {
  return (String(h || '').match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) || []).map((e) => ({ email: e.toLowerCase(), header: e }));
}
function dedupe(list, exclude = new Set()) {
  const seen = new Set(exclude), out = [];
  for (const x of list) { if (OWN_RE.test(x.email) || seen.has(x.email)) continue; seen.add(x.email); out.push(x); }
  return out;
}
export function buildMime({ fromName, ai, to, cc, subject, body, inReplyTo, references, replyToPlus }) {
  const lines = [
    `From: ${encodeName(fromName)} <${ACCOUNT}>`,
    `To: ${to.map((x) => x.header).join(', ')}`,
    cc.length ? `Cc: ${cc.map((x) => x.header).join(', ')}` : null,
    `Bcc: ${plusAddr(ai)}`,
    replyToPlus ? `Reply-To: ${plusAddr(ai)}` : null,
    `Subject: ${encodeWord(subject)}`,
    inReplyTo ? `In-Reply-To: ${noBreaks(inReplyTo)}` : null,
    references ? `References: ${noBreaks(references)}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  const b = b64StdFromBytes(te.encode(String(body).replace(/\r?\n/g, '\r\n'))).replace(/(.{76})/g, '$1\r\n');
  return lines.join('\r\n') + '\r\n\r\n' + b;
}

const isTrue = (v) => v === true || v === 'true' || v === 'on' || v === '1' || v === 1;

export async function sendMail(env, ai, via, args, isReply) {
  args = args || {};
  const settings = await getSettings(env);
  const body = String(args.body ?? '');
  if (!body.trim()) throw new AppError(400, 'The email body is empty.');
  if (body.length > 50000) throw new AppError(400, 'The email body is too long (max 50 000 characters).');
  const replyAll = isTrue(args.reply_all);
  let to, cc, subject, threadId, inReplyTo, references;
  if (isReply) {
    const { m } = await getOwnedMessage(env, ai, args.message_id);
    const fromEmail = (emailsIn(hdr(m, 'From'))[0] || {}).email || '';
    if (OWN_RE.test(fromEmail)) {
      to = emailsIn(hdr(m, 'To'));
      cc = replyAll ? emailsIn(hdr(m, 'Cc')) : [];
    } else {
      to = emailsIn(hdr(m, 'Reply-To') || hdr(m, 'From'));
      cc = replyAll ? [...emailsIn(hdr(m, 'To')), ...emailsIn(hdr(m, 'Cc'))] : [];
    }
    to = dedupe(to);
    cc = dedupe(cc, new Set(to.map((x) => x.email)));
    if (!to.length) throw new AppError(400, 'Could not work out who to reply to.');
    subject = hdr(m, 'Subject') || '';
    if (!/^re:/i.test(subject.trim())) subject = 'Re: ' + subject;
    const mid = hdr(m, 'Message-ID') || hdr(m, 'Message-Id');
    inReplyTo = mid || null;
    references = [hdr(m, 'References'), mid].filter(Boolean).join(' ') || null;
    threadId = m.threadId;
  } else {
    to = parseAddrList(args.to);
    cc = parseAddrList(args.cc);
    subject = noBreaks(args.subject, 300);
    if (!to.length) throw new AppError(400, 'Add at least one "to" email address.');
    if (!subject) throw new AppError(400, 'Add a subject.');
  }
  subject = noBreaks(subject, 300);
  if (to.length + cc.length > 20) throw new AppError(400, 'Too many recipients (max 20).');
  const fromName = settings.display[ai];
  const raw = buildMime({ fromName, ai, to, cc, subject, body, inReplyTo, references, replyToPlus: settings.reply_to_plus });
  const logBase = { ai, via, kind: isReply ? 'reply' : 'new', to: to.map((x) => x.email).join(', '), cc: cc.map((x) => x.email).join(', '), subject };
  const preview = {
    from: `${fromName} <${ACCOUNT}>`, to: to.map((x) => x.header), cc: cc.map((x) => x.header), bcc: plusAddr(ai),
    reply_to: settings.reply_to_plus ? plusAddr(ai) : ACCOUNT, subject, thread_id: threadId || null,
  };
  if (isTrue(args.dry_run)) {
    await addLog(env, { ...logBase, status: 'dry_run' });
    return { sent: false, dry_run: true, note: 'Test only. Nothing was sent.', would_send: { ...preview, body_preview: body.slice(0, 500) } };
  }
  if (!settings.sending_enabled) {
    await addLog(env, { ...logBase, status: 'blocked_paused' });
    throw new AppError(403, 'Sending is paused by Johan right now. Try again later.');
  }
  const ck = `count:${ai}:${sastDate()}`;
  const n = parseInt((await env.KV.get(ck)) || '0', 10);
  if (n >= DAILY_LIMIT) {
    await addLog(env, { ...logBase, status: 'blocked_limit' });
    throw new AppError(429, `Daily limit reached (${DAILY_LIMIT} emails per day). It resets at midnight South African time.`);
  }
  let res;
  try {
    res = await gmail(env, '/messages/send', { method: 'POST', body: { raw: b64urlFromBytes(te.encode(raw)), ...(threadId ? { threadId } : {}) } });
  } catch (e) {
    await addLog(env, { ...logBase, status: 'error', error: String(e.message || e).slice(0, 150) });
    throw e;
  }
  await env.KV.put(ck, String(n + 1), { expirationTtl: 3 * 86400 });
  // Make sure the sent copy carries this AI's labels (the Gmail filters do this too).
  try {
    const ids = await labelIds(env, ai);
    await gmail(env, `/messages/${encodeURIComponent(res.id)}/modify`, { method: 'POST', body: { addLabelIds: [ids.main, ids.sent] } });
  } catch { /* filters will still label it */ }
  await addLog(env, { ...logBase, status: 'sent', gmail_id: res.id });
  return { sent: true, message_id: res.id, thread_id: res.threadId, ...preview, sent_today: n + 1, daily_limit: DAILY_LIMIT };
}

export async function sentToday(env, ai) {
  return parseInt((await env.KV.get(`count:${ai}:${sastDate()}`)) || '0', 10);
}

// ---------- send log (stored in KV key metadata, newest first) ----------
export async function addLog(env, e) {
  const ts = Date.now();
  const key = `log:${String(9e15 - ts).padStart(16, '0')}:${randomToken(4)}`;
  const meta = { ts, ai: e.ai, via: e.via, kind: e.kind, status: e.status, to: String(e.to || '').slice(0, 200), cc: String(e.cc || '').slice(0, 150), subject: String(e.subject || '').slice(0, 150), gmail_id: e.gmail_id || '', error: String(e.error || '').slice(0, 150) };
  await env.KV.put(key, '', { metadata: meta, expirationTtl: 180 * 86400 });
  console.log(JSON.stringify({ evt: 'send', ai: e.ai, via: e.via, status: e.status }));
}
export async function readLog(env, limit = 100) {
  const l = await env.KV.list({ prefix: 'log:', limit });
  return l.keys.map((k) => k.metadata).filter(Boolean);
}

// ---------- AI keys ----------
export const KEY_RE = /^amh_(chatgpt|claude|grok|copilot)_[A-Za-z0-9_-]{40,60}$/;
export async function authAI(env, key, expectAi) {
  if (!key || typeof key !== 'string') return null;
  const m = key.match(KEY_RE);
  if (!m) return null;
  const ai = m[1];
  if (expectAi && ai !== expectAi) return null;
  const rec = await env.KV.get('key:' + ai, 'json');
  if (!rec || !rec.hash) return null;
  const h = await sha256Hex(key);
  if (!safeEqual(h, rec.hash)) return null;
  return { ai, keyHash: h };
}
export async function newKey(env, ai) {
  const key = `amh_${ai}_${randomToken(32)}`;
  await env.KV.put('key:' + ai, JSON.stringify({ hash: await sha256Hex(key), enc: await encryptStr(env, key), created: Date.now() }));
  return key;
}
export async function revealKey(env, ai) {
  const rec = await env.KV.get('key:' + ai, 'json');
  if (!rec || !rec.enc) return null;
  return decryptStr(env, rec.enc);
}
