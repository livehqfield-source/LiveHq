// Offline tests: real Worker code, mocked KV and a mocked Google/Gmail API. No network, no real email.
import worker from '../src/worker.js';
import { b64urlFromBytes, bytesFromB64url } from '../src/core.js';

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; } else { fail++; console.log('FAIL:', name); } };

class KV {
  constructor() { this.m = new Map(); }
  async get(k, t) { const v = this.m.get(k); if (!v) return null; return t === 'json' ? JSON.parse(v.value) : v.value; }
  async put(k, value, o = {}) { this.m.set(k, { value: String(value), metadata: o.metadata }); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: this.m.get(name).metadata }));
    return { keys, list_complete: true };
  }
}
const SECRET_RT = 'RT-very-secret-refresh-token-123';
const ADMIN_PW = 'test-admin-password-xyz';
const env = { KV: new KV(), ENC_KEY: b64urlFromBytes(crypto.getRandomValues(new Uint8Array(32))), SESSION_SECRET: 'sess-secret-test', ADMIN_PASSWORD: ADMIN_PW };

// ---- mock Google ----
const L = {};
for (const [ai, name] of [['chatgpt', 'ChatGPT'], ['claude', 'Claude'], ['grok', 'Grok'], ['copilot', 'Co Pilot']]) {
  L[name] = 'L_' + ai; L[name + '/Inbox'] = 'L_' + ai + '_in'; L[name + '/Sent'] = 'L_' + ai + '_sent';
}
const enc64 = (s) => b64urlFromBytes(new TextEncoder().encode(s));
const mk = (id, threadId, labels, headers, body) => ({ id, threadId, labelIds: labels, snippet: body.slice(0, 50), internalDate: String(Date.UTC(2026, 10, 16, 8, 0)),
  payload: { mimeType: 'multipart/alternative', headers: Object.entries(headers).map(([name, value]) => ({ name, value })), parts: [{ mimeType: 'text/plain', body: { data: enc64(body) } }, { mimeType: 'text/html', body: { data: enc64('<p>' + body + '</p>') } }] } });
const msgs = {
  m1: mk('m1', 't1', ['L_chatgpt', 'L_chatgpt_in', 'INBOX', 'UNREAD'], { From: 'Client One <client1@example.com>', To: 'livehqfield+chatgpt@gmail.com', Subject: 'Quote please', 'Message-ID': '<abc@example.com>' }, 'Hi, can I get a quote?'),
  m2: mk('m2', 't2', ['L_claude', 'L_claude_in', 'INBOX'], { From: 'client2@example.com', To: 'livehqfield+claude@gmail.com', Subject: 'For Claude' }, 'Secret Claude stuff'),
  m4: mk('m4', 't1', ['L_claude', 'L_claude_in'], { From: 'x@example.com', To: 'livehqfield+claude@gmail.com', Subject: 'Re: Quote please' }, 'CROSS-AI MESSAGE'),
  m5: mk('m5', 't1', ['INBOX'], { From: 'Client One <client1@example.com>', To: 'livehqfield@gmail.com', Subject: 'Re: Quote please' }, 'Follow-up in thread'),
};
const google = { sent: [], modified: [], profileEmail: 'livehqfield@gmail.com', profileError: null, refreshError: null, revoked: 0, otherFetch: [] };
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (u.href === 'https://oauth2.googleapis.com/token') {
    const p = new URLSearchParams(init.body.toString());
    if (p.get('grant_type') === 'authorization_code') {
      if (p.get('code') !== 'GOOD') return J({ error: 'invalid_grant' }, 400);
      return J({ access_token: 'AT1', expires_in: 3600, refresh_token: SECRET_RT, scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send' });
    }
    if (google.refreshError) return J({ error: google.refreshError }, 400);
    return J({ access_token: 'AT2', expires_in: 3600 });
  }
  if (u.href.startsWith('https://oauth2.googleapis.com/revoke')) { google.revoked++; return J({}); }
  if (u.origin === 'https://gmail.googleapis.com') {
    const p = u.pathname.replace('/gmail/v1/users/me', '');
    if (p === '/profile') return google.profileError ? J(google.profileError.body, google.profileError.status) : J({ emailAddress: google.profileEmail });
    if (p === '/labels') return J({ labels: Object.entries(L).map(([name, id]) => ({ name, id })).concat([{ name: 'INBOX', id: 'INBOX' }]) });
    if (p === '/messages' && (init.method || 'GET') === 'GET') {
      const lab = u.searchParams.get('labelIds');
      return J({ messages: Object.values(msgs).filter((m) => m.labelIds.includes(lab)).map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    if (p === '/messages/send') { const b = JSON.parse(init.body); google.sent.push(b); return J({ id: 'sent' + google.sent.length, threadId: b.threadId || 'tnew' }); }
    let mm = p.match(/^\/messages\/([^/]+)\/modify$/);
    if (mm) { google.modified.push({ id: mm[1], ...JSON.parse(init.body) }); return J({}); }
    mm = p.match(/^\/messages\/([^/]+)$/);
    if (mm) return msgs[mm[1]] ? J(msgs[mm[1]]) : J({ error: { message: 'nf' } }, 404);
    mm = p.match(/^\/threads\/([^/]+)$/);
    if (mm) return J({ id: mm[1], messages: Object.values(msgs).filter((m) => m.threadId === mm[1]) });
  }
  google.otherFetch.push(u.href);
  throw new Error('Unexpected network call in test: ' + u.href);
};

// ---- helpers ----
const ORIGIN = 'https://ai-mail-hub.test.workers.dev';
const bodies = [];
let cookie = '';
async function call(method, path, { headers = {}, body, form, noCookie } = {}) {
  const h = new Headers(headers);
  if (cookie && !noCookie) h.set('cookie', cookie);
  let b = body;
  if (form) { b = new URLSearchParams(form).toString(); h.set('content-type', 'application/x-www-form-urlencoded'); }
  if (body && typeof body === 'object') { b = JSON.stringify(body); h.set('content-type', 'application/json'); }
  const r = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: b, redirect: 'manual' }), env);
  const text = await r.text();
  bodies.push(text + JSON.stringify([...r.headers]));
  return { status: r.status, headers: r.headers, text, json: () => JSON.parse(text) };
}
const mcp = (key, method, params, id = 1, via = 'path') => call('POST', via === 'path' ? `/mcp/${key}` : via === 'query' ? `/mcp?key=${key}` : '/mcp',
  { headers: { accept: 'application/json, text/event-stream', ...(via === 'bearer' ? { authorization: 'Bearer ' + key } : {}) }, body: { jsonrpc: '2.0', id, method, params } });
const tool = async (key, name, args) => { const r = await mcp(key, 'tools/call', { name, arguments: args }); return r.json().result; };
const TOOLS_DESC_OK = () => true;
const csrfOf = (html) => (html.match(/name="csrf" value="([^"]+)"/) || [])[1];

// ---- tests ----
let r = await call('GET', '/');
ok(r.status === 200 && r.headers.get('strict-transport-security') && r.headers.get('content-security-policy'), 'home + security headers');
r = await worker.fetch(new Request('http://ai-mail-hub.test.workers.dev/admin'), env);
ok(r.status === 308 && r.headers.get('location').startsWith('https://'), 'http -> https redirect');
r = await call('GET', '/admin');
ok(r.status === 200 && r.text.includes('Admin password'), 'login page');
r = await call('POST', '/admin/login', { form: { password: 'wrong' } });
ok(r.status === 401, 'wrong password rejected');
r = await call('POST', '/admin/login', { form: { password: ADMIN_PW }, headers: { origin: 'https://evil.example' } });
ok(r.status === 403, 'cross-origin login blocked');
r = await call('POST', '/admin/login', { form: { password: ADMIN_PW } });
ok(r.status === 303 && /HttpOnly; Secure; SameSite=Lax/.test(r.headers.get('set-cookie')), 'login ok, secure cookie');
cookie = r.headers.get('set-cookie').split(';')[0];
r = await call('GET', '/admin/gmail');
const csrf = csrfOf(r.text);
ok(r.status === 200 && csrf && r.text.includes('Gmail is not connected yet'), 'dashboard shows not connected');
ok(/<button type="submit" disabled[^>]*>Connect Gmail/.test(r.text), 'Connect Gmail disabled without client');
ok(r.text.includes(ORIGIN + '/oauth/google/callback'), 'redirect URI shown');
r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai: 'chatgpt' } });
ok(r.status === 403, 'admin action without CSRF rejected');
r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai: 'chatgpt', csrf: 'bad' } });
ok(r.status === 403, 'admin action with wrong CSRF rejected');
r = await call('POST', '/admin/action', { form: { action: 'save_google_client', csrf, client_id: 'nope', client_secret: 'x' } });
ok(r.status === 303 && r.headers.get('location').includes('err='), 'bad client id rejected');
r = await call('POST', '/admin/action', { form: { action: 'save_google_client', csrf, client_id: '123456-abcdef.apps.googleusercontent.com', client_secret: 'GOCSPX-testsecret123' } });
ok(r.status === 303 && r.headers.get('location') === '/admin/gmail?msg=client_saved', 'client saved -> Gmail page');
ok(![...env.KV.m.values()].some((v) => v.value.includes('GOCSPX-testsecret123')), 'client secret stored encrypted');
r = await call('GET', '/admin/gmail');
ok(/<button type="submit">Connect Gmail/.test(r.text), 'Connect Gmail enabled after client set');
ok(!r.text.includes('GOCSPX-testsecret123'), 'client secret never shown');

// Gmail not connected yet: AI calls fail cleanly
r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai: 'chatgpt', csrf }, headers: { accept: 'application/json' } });
const K = {}; K.chatgpt = r.json().key;
for (const ai of ['claude', 'grok', 'copilot']) { r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai, csrf }, headers: { accept: 'application/json' } }); K[ai] = r.json().key; }
ok(Object.values(K).every((k) => /^amh_[a-z]+_[A-Za-z0-9_-]{43}$/.test(k)), 'keys made');
ok(![...env.KV.m.values()].some((v) => Object.values(K).some((k) => v.value.includes(k))), 'keys not stored in plain text');
let res = await tool(K.chatgpt, 'list_inbox', {});
ok(res.isError && res.content[0].text.includes('not connected'), 'clean error before Gmail connected');

// OAuth
r = await call('POST', '/admin/action', { form: { action: 'connect_gmail', csrf } });
const loc = new URL(r.headers.get('location'));
ok(loc.origin === 'https://accounts.google.com' && loc.searchParams.get('redirect_uri') === ORIGIN + '/oauth/google/callback' && loc.searchParams.get('scope').includes('gmail.modify') && loc.searchParams.get('scope').includes('gmail.send') && loc.searchParams.get('access_type') === 'offline', 'OAuth redirect correct');
const state = loc.searchParams.get('state');
r = await call('GET', `/oauth/google/callback?state=wrongstate123456789012345&code=GOOD`);
ok(r.headers.get('location').includes('err='), 'bad state rejected');
r = await call('GET', `/oauth/google/callback?state=${state}&code=GOOD`, { noCookie: true });
ok(r.status === 401, 'callback needs admin session');
const errOf = (r) => (r.headers.get('location').startsWith('/admin/gmail?err=') ? new URL(ORIGIN + r.headers.get('location')).searchParams.get('err') : '') || '';
const freshState = async () => new URL((await call('POST', '/admin/action', { form: { action: 'connect_gmail', csrf } })).headers.get('location')).searchParams.get('state');
google.profileEmail = 'someone-else@gmail.com';
let rv = google.revoked;
r = await call('GET', `/oauth/google/callback?state=${state}&code=GOOD`);
ok(errOf(r).includes('different Google account (someone-else@gmail.com)') && !(await env.KV.get('gmail:rt')) && google.revoked > rv, 'wrong Google account rejected, email shown, token revoked');
google.profileEmail = 'livehqfield@gmail.com';
google.profileError = { status: 403, body: { error: { code: 403, message: 'Gmail API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456 then retry.', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } } };
rv = google.revoked;
r = await call('GET', `/oauth/google/callback?state=${await freshState()}&code=GOOD`);
ok(errOf(r).startsWith('The Gmail API is switched off') && !errOf(r).includes('different Google account') && !(await env.KV.get('gmail:rt')) && google.revoked > rv, 'Gmail API disabled -> clear message, token revoked');
google.profileError = { status: 500, body: { error: { code: 500, message: 'Backend Error ' + 'x'.repeat(300) } } };
r = await call('GET', `/oauth/google/callback?state=${await freshState()}&code=GOOD`);
ok(errOf(r).startsWith('Google would not let the hub read the mailbox (500: Backend Error') && errOf(r).length < 160 && !(await env.KV.get('gmail:rt')), 'other profile error -> generic message');
google.profileError = null;
r = await call('POST', '/admin/action', { form: { action: 'connect_gmail', csrf } });
const state2 = new URL(r.headers.get('location')).searchParams.get('state');
r = await call('GET', `/oauth/google/callback?state=${state2}&code=GOOD`);
ok(r.headers.get('location') === '/admin/gmail?msg=connected', 'OAuth connected');
ok(!(await env.KV.get('gmail:rt')).includes(SECRET_RT), 'refresh token stored encrypted');
r = await call('GET', '/admin/gmail?msg=connected');
ok(r.text.includes('Connected to') && r.text.includes('All 12 AI labels found'), 'dashboard connected + labels');
r = await call('GET', `/oauth/google/callback?state=${state2}&code=GOOD`);
ok(r.headers.get('location').includes('err='), 'state cannot be reused');

// MCP
r = await mcp(K.chatgpt, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
ok(r.status === 200 && r.json().result.protocolVersion === '2025-06-18' && r.json().result.capabilities.tools, 'MCP initialize');
r = await call('POST', `/mcp/${K.chatgpt}`, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
ok(r.status === 202, 'MCP notification 202');
r = await mcp(K.chatgpt, 'tools/list', {}, 2, 'bearer');
ok(r.json().result.tools.map((t) => t.name).join(',') === 'list_inbox,list_sent,read_email,search_my_mail,send_email,reply_email,get_my_stats,update_business,log_money,list_my_transactions,get_my_progress,save_progress,add_task,update_task,list_tasks,publish_app,list_my_apps,unpublish_app,report_limit', 'MCP tools/list via bearer');
r = await mcp(K.chatgpt, 'tools/list', {}, 2, 'query');
ok(r.status === 200, 'MCP key in query');
r = await call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
ok(r.status === 401, 'MCP without key 401');
r = await mcp('amh_chatgpt_' + 'A'.repeat(43), 'tools/list', {});
ok(r.status === 401, 'MCP wrong key 401');
r = await call('GET', `/mcp/${K.chatgpt}`);
ok(r.status === 405, 'MCP GET 405');
r = await call('POST', `/mcp/${K.chatgpt}`, { headers: { accept: 'text/event-stream' }, body: { jsonrpc: '2.0', id: 9, method: 'ping' } });
ok(r.headers.get('content-type').includes('text/event-stream') && r.text.includes('"id":9'), 'MCP SSE-style response');

res = await tool(K.chatgpt, 'list_inbox', {});
ok(!res.isError && res.structuredContent.messages.length === 1 && res.structuredContent.messages[0].id === 'm1', 'list_inbox only own');
res = await tool(K.claude, 'list_inbox', {});
ok(res.structuredContent.messages.every((m) => m.id !== 'm1'), 'claude cannot see chatgpt inbox');
res = await tool(K.chatgpt, 'read_email', { message_id: 'm2' });
ok(res.isError && res.content[0].text.includes('not in your mailbox'), 'cannot read other AI message');
res = await tool(K.chatgpt, 'read_email', { message_id: 'm1' });
ok(!res.isError && res.structuredContent.message.body.includes('quote') && !JSON.stringify(res).includes('CROSS-AI') && JSON.stringify(res).includes('Follow-up in thread'), 'read_email with thread, other AI filtered');
res = await tool(K.chatgpt, 'read_email', { message_id: '../labels' });
ok(res.isError, 'bad id rejected');
res = await tool(K.chatgpt, 'search_my_mail', { query: 'quote' });
ok(!res.isError, 'search works');

// Send (mocked Gmail)
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com', subject: 'Test', body: 'Hello', dry_run: true });
ok(res.structuredContent.dry_run && google.sent.length === 0, 'dry run sends nothing');
res = await tool(K.chatgpt, 'send_email', { to: 'Mr A <a@example.com>, b@example.com', cc: 'c@example.com', subject: 'Hallo — toets', body: 'Hello there\nLine 2' });
ok(!res.isError && google.sent.length === 1, 'send_email sent via mocked API');
let raw = new TextDecoder().decode(bytesFromB64url(google.sent[0].raw));
ok(raw.includes('From: "Doenit net" <livehqfield@gmail.com>') && raw.includes('Bcc: livehqfield+chatgpt@gmail.com') && raw.includes('Reply-To: livehqfield+chatgpt@gmail.com') && raw.includes('To: "Mr A" <a@example.com>, b@example.com') && raw.includes('Subject: =?UTF-8?B?'), 'MIME headers correct');
ok(google.modified.some((m) => m.addLabelIds.includes('L_chatgpt_sent') && m.addLabelIds.includes('L_chatgpt')), 'sent copy labelled');
res = await tool(K.chatgpt, 'reply_email', { message_id: 'm1', body: 'Here is your quote' });
raw = new TextDecoder().decode(bytesFromB64url(google.sent[1].raw));
ok(google.sent[1].threadId === 't1' && raw.includes('To: client1@example.com') && raw.includes('In-Reply-To: <abc@example.com>') && raw.includes('Subject: Re: Quote please') && raw.includes('Bcc: livehqfield+chatgpt@gmail.com'), 'reply in thread');
res = await tool(K.chatgpt, 'reply_email', { message_id: 'm2', body: 'sneaky' });
ok(res.isError && google.sent.length === 2, 'cannot reply to other AI mail');
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com', subject: 'x\r\nBcc: evil@example.com', body: 'hi' });
ok(res.isError && google.sent.length === 2, 'header injection blocked');
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com\nBcc: evil@example.com', subject: 'x', body: 'hi' });
ok(res.isError && google.sent.length === 2, 'header injection in address blocked');
res = await tool(K.chatgpt, 'send_email', { to: 'not-an-email', subject: 'x', body: 'hi' });
ok(res.isError, 'invalid address rejected');

// Rate limit
const day = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
await env.KV.put(`count:chatgpt:${day}`, '50');
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com', subject: 'x', body: 'hi' });
ok(res.isError && res.content[0].text.includes('Daily limit') && google.sent.length === 2, 'daily limit 50 enforced');
await env.KV.put(`count:chatgpt:${day}`, '2');

// REST
r = await call('GET', '/api/v1/me', { headers: { authorization: 'Bearer ' + K.grok } });
ok(r.status === 200 && r.json().ai === 'grok' && r.json().client_address === 'livehqfield+grok@gmail.com', 'REST me');
r = await call('GET', '/api/v1/inbox', { headers: { authorization: 'Bearer ' + K.chatgpt } });
ok(r.status === 200 && r.json().messages[0].id === 'm1', 'REST inbox');
r = await call('GET', '/api/v1/messages/m1', { headers: { authorization: 'Bearer ' + K.claude } });
ok(r.status === 404, 'REST cross-AI read blocked');
r = await call('GET', '/api/v1/inbox');
ok(r.status === 401, 'REST without key 401');
r = await call('POST', '/api/v1/send', { headers: { authorization: 'Bearer ' + K.claude }, body: { to: 'z@example.com', subject: 'API', body: 'via api' } });
ok(r.status === 200 && r.json().sent && new TextDecoder().decode(bytesFromB64url(google.sent[2].raw)).includes('Bcc: livehqfield+claude@gmail.com'), 'REST send with claude BCC');
r = await call('GET', '/openapi.json');
const spec = r.json();
ok(spec.openapi === '3.1.0' && spec.servers[0].url === ORIGIN && Object.keys(spec.paths).length === 17 && spec.paths['/api/v1/apps'].post.operationId === 'publishApp' && spec.paths['/api/v1/progress'].get.operationId === 'getMyProgress' && spec.paths['/api/v1/limit'].post.operationId === 'reportLimit' && spec.paths['/api/v1/money'].post.operationId === 'logMoney' && spec.paths['/api/v1/stats'].get.operationId === 'getMyStats', 'openapi.json');

// ---- AI Million Challenge: money & business ----
res = await tool(K.chatgpt, 'get_my_stats', {});
ok(!res.isError && res.structuredContent.money_earned_zar === 0 && res.structuredContent.net_profit === 'R0.00' && res.structuredContent.last_updated === null, 'get_my_stats empty');
res = await tool(K.chatgpt, 'update_business', { name: 'Logo Studio', description: 'AI logo design for SA small businesses', status_note: 'Looking for first client' });
ok(!res.isError && res.structuredContent.business.name === 'Logo Studio' && res.structuredContent.last_updated_by === 'ChatGPT via connector', 'update_business');
res = await tool(K.chatgpt, 'update_business', {});
ok(res.isError, 'update_business needs a field');
res = await tool(K.chatgpt, 'update_business', { name: 'x'.repeat(81) });
ok(res.isError && res.content[0].text.includes('too long'), 'business name length cap');
res = await tool(K.chatgpt, 'log_money', { type: 'earned', amount_zar: 1500, description: 'First logo' });
ok(!res.isError && res.structuredContent.totals.money_earned_zar === 1500, 'log_money earned');
res = await tool(K.chatgpt, 'log_money', { type: 'spent', amount_zar: '200.50', description: 'Domain + hosting', date: '2026-11-15' });
ok(!res.isError && res.structuredContent.totals.net_profit_zar === 1299.5 && res.structuredContent.totals.net_profit === 'R1 299.50', 'log_money spent, net computed');
for (const [a, why] of [[{ type: 'earned', amount_zar: 0, description: 'x' }, 'zero'], [{ type: 'earned', amount_zar: -5, description: 'x' }, 'negative'], [{ type: 'earned', amount_zar: 'abc', description: 'x' }, 'text'],
  [{ type: 'earned', amount_zar: 1.234, description: 'x' }, '3 decimals'], [{ type: 'won', amount_zar: 5, description: 'x' }, 'bad type'], [{ type: 'earned', amount_zar: 5, description: '' }, 'empty desc'],
  [{ type: 'earned', amount_zar: 5, description: 'x'.repeat(201) }, 'long desc'], [{ type: 'earned', amount_zar: 5, description: 'x', date: '2099-01-01' }, 'future date'], [{ type: 'earned', amount_zar: 5, description: 'x', date: '2026-02-31' }, 'bad date'],
  [{ type: 'earned', amount_zar: 1e12, description: 'x' }, 'too big']]) {
  res = await tool(K.chatgpt, 'log_money', a);
  ok(res.isError, 'log_money rejects ' + why);
}
res = await tool(K.chatgpt, 'list_my_transactions', {});
ok(!res.isError && res.structuredContent.count === 2 && res.structuredContent.transactions[0].type === 'spent' && res.structuredContent.transactions[0].date === '2026-11-15', 'list_my_transactions newest first');
res = await tool(K.claude, 'get_my_stats', {});
ok(res.structuredContent.money_earned_zar === 0 && res.structuredContent.business.name === '', 'other AI data separate');
res = await tool(K.claude, 'list_my_transactions', {});
ok(res.structuredContent.count === 0, 'other AI sees no transactions');
r = await call('POST', '/api/v1/money', { headers: { authorization: 'Bearer ' + K.claude }, body: { type: 'earned', amount_zar: 99.5, description: 'API sale' } });
ok(r.status === 200 && r.json().totals.money_earned_zar === 99.5, 'REST log money');
r = await call('POST', '/api/v1/money', { headers: { authorization: 'Bearer ' + K.claude }, body: { type: 'earned', amount_zar: -1, description: 'bad' } });
ok(r.status === 400, 'REST money validation 400');
r = await call('POST', '/api/v1/business', { headers: { authorization: 'Bearer ' + K.claude }, body: { name: 'Claude Copy Co' } });
ok(r.status === 200 && r.json().business.name === 'Claude Copy Co', 'REST business');
r = await call('GET', '/api/v1/stats', { headers: { authorization: 'Bearer ' + K.claude } });
ok(r.status === 200 && r.json().money_earned === 'R99.50', 'REST stats');
r = await call('GET', '/api/v1/transactions', { headers: { authorization: 'Bearer ' + K.claude } });
ok(r.status === 200 && r.json().count === 1, 'REST transactions');
r = await call('POST', '/api/v1/money', { body: { type: 'earned', amount_zar: 5, description: 'x' } });
ok(r.status === 401, 'REST money needs key');
r = await call('GET', `/ai/copilot?key=${K.copilot}&view=money`);
const mCsrf = csrfOf(r.text);
ok(r.status === 200 && r.text.includes('Log money') && r.text.includes('action="/ai/copilot/money"') && r.text.includes('action="/ai/copilot/business"'), 'web money tab');
r = await call('POST', '/ai/copilot/money', { form: { key: K.copilot, type: 'spent', amount_zar: '50', description: 'Canva' } });
ok(r.status === 403, 'web money POST without CSRF rejected');
r = await call('POST', '/ai/copilot/money', { form: { key: K.copilot, csrf: mCsrf, type: 'earned', amount_zar: '1 250,00'.replace(' ', ''), description: 'Manual sale' } });
ok(r.status === 200 && r.text.includes('Saved.') && r.text.includes('R1 250.00'), 'web log money (decimal comma)');
r = await call('POST', '/ai/copilot/business', { form: { key: K.copilot, csrf: mCsrf, name: 'Copilot Tutoring', description: 'Maths lessons', status_note: 'Started' } });
ok(r.status === 200 && r.text.includes('Business details saved'), 'web update business');
r = await call('GET', `/ai/copilot/stats.txt?key=${K.copilot}`);
ok(r.status === 200 && r.text.includes('Copilot Tutoring') && r.text.includes('Money earned: R1 250.00') && r.text.includes('Co Pilot via web page'), 'stats.txt');
r = await call('GET', `/ai/copilot/money?key=${K.copilot}&type=earned&amount_zar=5&description=x`);
ok(r.status === 404, 'GET cannot log money');
r = await call('GET', `/ai/chatgpt/help.txt?key=${K.chatgpt}`);
ok(r.text.includes('log_money') && r.text.includes('update_business') && r.text.includes('stats.txt'), 'help.txt mentions money tools');
await env.KV.put(`ucount:grok:${day}`, '100');
res = await tool(K.grok, 'log_money', { type: 'earned', amount_zar: 5, description: 'x' });
ok(res.isError && res.content[0].text.includes('Daily update limit'), 'update rate limit 100/day');
await env.KV.delete(`ucount:grok:${day}`);
// admin money page
r = await call('GET', '/admin/money/chatgpt');
ok(r.status === 200 && r.text.includes('ChatGPT: money') && r.text.includes('Domain + hosting') && r.text.includes('name="tx_id"'), 'admin transactions page');
const txIds = [...r.text.matchAll(/name="action" value="tx_edit"><input type="hidden" name="ai" value="chatgpt"><input type="hidden" name="tx_id" value="([^"]+)"/g)].map((m) => m[1]);
ok(txIds.length === 2, 'admin sees 2 transactions');
r = await call('POST', '/admin/action', { form: { action: 'tx_edit', ai: 'chatgpt', tx_id: txIds[1], type: 'earned', amount: '2000', description: 'First logo (corrected)', date: '2026-11-16' } });
ok(r.status === 403, 'admin tx edit without CSRF rejected');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_edit', ai: 'chatgpt', tx_id: txIds[1], type: 'earned', amount: '2000', description: 'First logo (corrected)', date: '2026-11-16' } });
ok(r.headers.get('location') === '/admin/money/chatgpt?msg=saved', 'admin tx edit');
res = await tool(K.chatgpt, 'get_my_stats', {});
ok(res.structuredContent.money_earned_zar === 2000 && res.structuredContent.net_profit_zar === 1799.5 && res.structuredContent.last_updated_by === 'Johan (admin)', 'totals updated after edit');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_edit', ai: 'chatgpt', tx_id: txIds[1], type: 'earned', amount: '-3', description: 'x', date: '' } });
ok(r.headers.get('location').startsWith('/admin/money/chatgpt?err='), 'admin edit validation');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_delete', ai: 'chatgpt', tx_id: txIds[0] } });
res = await tool(K.chatgpt, 'get_my_stats', {});
ok(r.headers.get('location') === '/admin/money/chatgpt?msg=tx_deleted' && res.structuredContent.money_spent_zar === 0 && res.structuredContent.transactions_count === 1, 'admin tx delete updates totals');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_delete', ai: 'claude', tx_id: txIds[1] } });
ok(r.headers.get('location').includes('err=') && (await tool(K.chatgpt, 'get_my_stats', {})).structuredContent.transactions_count === 1, 'cannot delete another AI tx via wrong ai');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_delete', ai: 'chatgpt', tx_id: '../../key:chatgpt' } });
ok(r.headers.get('location').includes('err=') && (await env.KV.get('key:chatgpt')), 'bad tx id rejected');
r = await call('POST', '/admin/action', { form: { csrf, action: 'biz_edit', ai: 'grok', name: 'Grok Memes', description: 'Meme pages', status_note: '' } });
res = await tool(K.grok, 'get_my_stats', {});
ok(res.structuredContent.business.name === 'Grok Memes', 'admin business edit');
r = await call('POST', '/admin/action', { form: { csrf, action: 'tx_add', ai: 'grok', type: 'spent', amount: '10', description: 'Admin added' } });
ok((await tool(K.grok, 'get_my_stats', {})).structuredContent.money_spent_zar === 10, 'admin add transaction');
r = await call('GET', '/admin/money/chatgpt', { noCookie: true });
ok(r.status === 303 && !r.text.includes('First logo'), 'admin money page needs sign-in');
r = await call('GET', '/admin');
ok(r.text.includes('Logo Studio') && r.text.includes('R2 000.00') && r.text.includes('R1 999.50') === false && r.text.includes('Johan (admin)'), 'overview shows money + business');

// ---- Save progress ----
r = await mcp(K.claude, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
const instr = r.json().result.instructions;
ok(instr.slice(0, 512).includes('get_my_progress') && instr.slice(0, 512).includes('save_progress') && /Do not wait for Johan/.test(instr), 'MCP instructions: start with get_my_progress, continue on own, save_progress');
r = await mcp(K.claude, 'tools/list', {});
ok(r.json().result.tools.find((t) => t.name === 'get_my_progress').description.startsWith('CALL THIS FIRST'), 'get_my_progress tool says CALL THIS FIRST');
res = await tool(K.claude, 'get_my_progress', {});
ok(!res.isError && res.structuredContent.current_focus === null && res.structuredContent.open_tasks.length === 0 && res.structuredContent.usage_limit.state === 'none', 'get_my_progress empty');
res = await tool(K.claude, 'save_progress', {});
ok(res.isError, 'save_progress needs a field');
res = await tool(K.claude, 'save_progress', { current_focus: 'Find first copywriting client', note: 'Researched 10 Joburg bakeries.', next_steps: ['Email 5 bakeries', { text: 'Write sample copy', status: 'doing' }, 'Follow up in 2 days'] });
ok(!res.isError && res.structuredContent.open_tasks.length === 3 && res.structuredContent.open_tasks[1].status === 'doing' && res.structuredContent.recent_notes[0].text.includes('bakeries') && res.structuredContent.last_saved_by === 'Claude via connector', 'save_progress with next_steps');
res = await tool(K.claude, 'update_task', { task_id: 't1', status: 'done' });
ok(!res.isError && res.structuredContent.open_tasks.length === 2, 'update_task done');
res = await tool(K.claude, 'update_task', { task_id: 't99', status: 'done' });
ok(res.isError && res.content[0].text.includes('not found'), 'update_task unknown id');
res = await tool(K.claude, 'update_task', { task_id: 't2', status: 'finished' });
ok(res.isError, 'update_task bad status');
res = await tool(K.claude, 'add_task', { text: 'Invoice the client' });
ok(!res.isError && res.structuredContent.task.id === 't4', 'add_task');
res = await tool(K.claude, 'add_task', { text: 'x'.repeat(301) });
ok(res.isError, 'task text length cap');
res = await tool(K.claude, 'save_progress', { note: 'y'.repeat(2001) });
ok(res.isError, 'note length cap');
res = await tool(K.claude, 'list_tasks', {});
ok(res.structuredContent.count === 3 && res.structuredContent.tasks.map((t) => t.id).join(',') === 't2,t3,t4', 'list_tasks open in order');
res = await tool(K.claude, 'list_tasks', { include_done: true });
ok(res.structuredContent.count === 4, 'list_tasks include_done');
res = await tool(K.claude, 'save_progress', { next_steps: ['New plan A', 'New plan B'] });
ok(res.structuredContent.open_tasks.map((t) => t.text).join('|') === 'New plan A|New plan B' && res.structuredContent.done_tasks_count === 1, 'next_steps replaces open tasks, keeps done');
res = await tool(K.chatgpt, 'get_my_progress', {});
ok(res.structuredContent.open_tasks.length === 0 && res.structuredContent.current_focus === null, 'progress scoped per AI');
{ const pr = await env.KV.get('prog:claude', 'json'); pr.notes = Array.from({ length: 200 }, (_, i) => ({ ts: i + 1, by: 'x', text: 'n' + i })); await env.KV.put('prog:claude', JSON.stringify(pr)); }
res = await tool(K.claude, 'save_progress', { note: 'note 201' });
ok((await env.KV.get('prog:claude', 'json')).notes.length === 200 && res.structuredContent.recent_notes[0].text === 'note 201' && res.structuredContent.recent_notes.length === 20, 'notes capped at 200, last 20 returned');
r = await call('GET', '/api/v1/progress', { headers: { authorization: 'Bearer ' + K.claude } });
ok(r.status === 200 && r.json().open_tasks.length === 2, 'REST get progress');
r = await call('POST', '/api/v1/progress', { headers: { authorization: 'Bearer ' + K.grok }, body: { current_focus: 'Meme page growth' } });
ok(r.status === 200 && r.json().current_focus === 'Meme page growth', 'REST save progress');
r = await call('POST', '/api/v1/tasks', { headers: { authorization: 'Bearer ' + K.grok }, body: { text: 'Post 3 memes' } });
ok(r.status === 200 && r.json().task.id === 't1', 'REST add task');
r = await call('POST', '/api/v1/tasks/t1', { headers: { authorization: 'Bearer ' + K.grok }, body: { status: 'doing' } });
ok(r.status === 200 && r.json().task.status === 'doing', 'REST update task');
r = await call('GET', '/api/v1/tasks', { headers: { authorization: 'Bearer ' + K.grok } });
ok(r.status === 200 && r.json().count === 1, 'REST list tasks');
await env.KV.put(`pcount:grok:${day}`, '200');
res = await tool(K.grok, 'add_task', { text: 'over limit' });
ok(res.isError && res.content[0].text.includes('progress-save limit'), 'progress writes limited to 200/day');
await env.KV.delete(`pcount:grok:${day}`);
r = await call('GET', `/ai/copilot?key=${K.copilot}&view=progress`);
const pCsrf = csrfOf(r.text);
ok(r.status === 200 && r.text.includes('Current focus') && r.text.includes('action="/ai/copilot/progress"'), 'web Progress tab');
r = await call('POST', '/ai/copilot/progress', { form: { key: K.copilot, op: 'save', current_focus: 'x' } });
ok(r.status === 403, 'web progress POST without CSRF rejected');
r = await call('POST', '/ai/copilot/progress', { form: { key: K.copilot, csrf: pCsrf, op: 'save', current_focus: 'Tutoring ads', note: 'Pasted by Johan' } });
ok(r.status === 200 && r.text.includes('Progress saved'), 'web save progress');
r = await call('POST', '/ai/copilot/progress', { form: { key: K.copilot, csrf: pCsrf, op: 'add_task', text: 'Make flyer' } });
r = await call('POST', '/ai/copilot/progress', { form: { key: K.copilot, csrf: pCsrf, op: 'update_task', task_id: 't1', status: 'doing', text: 'Make flyer (A5)' } });
ok(r.text.includes('Progress saved'), 'web add + update task');
r = await call('GET', `/ai/copilot/progress.txt?key=${K.copilot}`);
ok(r.status === 200 && r.text.includes('Tutoring ads') && r.text.includes('[doing] Make flyer (A5)') && r.text.includes('Pasted by Johan'), 'progress.txt');
r = await call('GET', `/ai/grok/help.txt?key=${K.grok}`);
ok(r.text.startsWith('START OF EVERY CHAT') && r.text.includes('progress.txt') && r.text.includes('save_progress'), 'help.txt: start-of-chat instruction');

// ---- Limit timer ----
r = await call('GET', '/admin');
ok((r.text.match(/class="status green"/g) || []).length === 4 && !r.text.includes('status red') && !/Limit reached/.test(r.text) && !r.text.includes('limit_clear') && (r.text.match(/<summary class="mini">Mark limit<\/summary>/g) || []).length === 4, 'overview default: 4 green Available, no limit text, no Clear');
res = await tool(K.claude, 'report_limit', {});
ok(!res.isError && res.structuredContent.state === 'waiting' && res.structuredContent.minutes_left >= 299 && res.structuredContent.minutes_left <= 300, 'report_limit default +5h for Claude');
res = await tool(K.claude, 'report_limit', { hours_until_reset: -1 });
ok(res.isError, 'report_limit bad hours');
res = await tool(K.claude, 'report_limit', { resets_at: 'tomorrow-ish' });
ok(res.isError, 'report_limit bad resets_at');
res = await tool(K.grok, 'report_limit', { resets_at: new Date(Date.now() + 90 * 60000).toISOString() });
ok(!res.isError && res.structuredContent.minutes_left === 90, 'report_limit with resets_at');
r = await call('POST', '/api/v1/limit', { headers: { authorization: 'Bearer ' + K.chatgpt }, body: { hours_until_reset: 2 } });
ok(r.status === 200 && r.json().state === 'waiting', 'REST report limit');
res = await tool(K.claude, 'get_my_progress', {});
ok(res.structuredContent.usage_limit.state === 'waiting', 'get_my_progress shows usage limit');
await env.KV.put('limit:chatgpt', JSON.stringify({ limit_hit_at: Date.now() - 6 * 3600e3, resets_at: Date.now() - 60000, by: 'ChatGPT via API' }));
r = await call('GET', '/admin');
{ const blk = (a, b) => r.text.split(`id="block-${a}"`)[1].split(b ? `id="block-${b}"` : '</main>')[0];
ok(/class="card block" id="block-chatgpt"/.test(r.text) && blk('chatgpt', 'claude').includes('status green') && !blk('chatgpt', 'claude').includes('limit_clear'), 'overview: expired limit shows green Available, no Clear');
ok(/class="card block waiting" id="block-claude"/.test(r.text) && /<span class="status red" data-resets="[^"]+"/.test(blk('claude', 'grok')) && /Limit reached, resets in <b class="countdown">(4h 59m|5h 00m)<\/b>/.test(blk('claude', 'grok')) && blk('claude', 'grok').includes('limit_clear'), 'overview: red dot with countdown + Clear when active');
ok(blk('copilot').includes('status green') && blk('copilot').includes('Continue ↗'), 'overview: Continue kept'); }
ok(r.text.includes('Current focus:') && r.text.includes('New plan A') && r.text.includes('New plan B') && r.text.includes('Next tasks:'), 'overview: focus + next tasks');
ok(r.text.includes('href="https://chatgpt.com/?q=Continue%3A%20use%20Live%20HQ') && r.text.includes('https://claude.ai/new?q=') && r.text.includes('https://grok.com/?q=') && r.text.includes('https://copilot.microsoft.com/?q=') && r.text.includes('data-copytext="Continue: use Live HQ, call get_my_progress and get_my_stats, then carry on with your next open task and save_progress when done."') && r.text.includes('class="btn ghost"'), 'overview: Continue buttons (secondary) with prompt');
ok((r.text.match(/name="action" value="limit_set"/g) || []).length === 4 && r.text.includes('name="hours" value="24"') && r.text.includes('name="hours" value="5"'), 'overview: Mark limit forms with defaults 5h/24h');
// Fix: open tasks in overview capped at 3
{ const pr = await env.KV.get('prog:claude', 'json'); for (const t of ['C', 'D', 'E']) pr.tasks.push({ id: 'tx' + t, text: 'Extra ' + t, status: 'todo', updated: 1 }); await env.KV.put('prog:claude', JSON.stringify(pr)); }
r = await call('GET', '/admin');
{ const blk = r.text.split('id="block-claude"')[1].split('id="block-grok"')[0]; ok((blk.match(/<li>/g) || []).length === 3, 'overview: only next 3 open tasks'); }
r = await call('POST', '/admin/action', { form: { action: 'limit_set', ai: 'copilot', hours: '24' } });
ok(r.status === 403, 'limit_set without CSRF rejected');
r = await call('POST', '/admin/action', { form: { csrf, action: 'limit_set', ai: 'copilot', hours: '24' } });
ok(r.headers.get('location') === '/admin#block-copilot' && (await env.KV.get('limit:copilot', 'json')).by === 'Johan (admin)', 'admin limit_set');
r = await call('POST', '/admin/action', { form: { csrf, action: 'limit_set', ai: 'copilot', resets_at: new Date(Date.now() + 2 * 3600e3 + 7200e3).toISOString().slice(0, 16).replace('T', ' ') } });
{ const l = await env.KV.get('limit:copilot', 'json'); ok(Math.abs(l.resets_at - (Date.now() + 2 * 3600e3)) < 120000, 'admin limit_set with SAST time'); }
r = await call('POST', '/admin/action', { form: { csrf, action: 'limit_set', ai: 'copilot', hours: 'abc' } });
ok(r.headers.get('location').startsWith('/admin?err='), 'admin limit_set validation');
r = await call('POST', '/admin/action', { form: { csrf, action: 'limit_clear', ai: 'chatgpt' } });
ok(!(await env.KV.get('limit:chatgpt')), 'admin clear limit');
r = await call('GET', '/admin/assets/copy.js', { noCookie: true });
ok(r.text.includes('data-resets') && r.text.includes("'Available'") && r.text.includes('data-clearlimit') && r.text.includes('data-copytext'), 'countdown + copy script served');
// admin progress page
r = await call('GET', '/admin/money/claude');
ok(r.text.includes('id="progress"') && r.text.includes('New plan A') && r.text.includes('note 201') && r.text.includes('name="action" value="task_edit"'), 'admin progress section');
r = await call('POST', '/admin/action', { form: { csrf, action: 'task_edit', ai: 'claude', task_id: 't5', status: 'done', text: 'New plan A (done)' } });
ok(r.headers.get('location') === '/admin/money/claude?msg=saved#progress' && (await env.KV.get('prog:claude', 'json')).tasks.find((t) => t.id === 't5').status === 'done', 'admin task edit');
r = await call('POST', '/admin/action', { form: { csrf, action: 'task_delete', ai: 'claude', task_id: 't6' } });
ok(!(await env.KV.get('prog:claude', 'json')).tasks.some((t) => t.id === 't6'), 'admin task delete');
r = await call('POST', '/admin/action', { form: { csrf, action: 'prog_save', ai: 'claude', current_focus: 'Set by Johan', note: 'Admin note' } });
{ const pr = await env.KV.get('prog:claude', 'json'); ok(pr.focus === 'Set by Johan' && pr.updated_by === 'Johan (admin)', 'admin focus/note save'); }
{ const ts = (await env.KV.get('prog:claude', 'json')).notes.at(-1).ts;
  r = await call('POST', '/admin/action', { form: { csrf, action: 'note_delete', ai: 'claude', note_ts: String(ts) } });
  ok(!(await env.KV.get('prog:claude', 'json')).notes.some((n) => n.ts === ts), 'admin note delete'); }
r = await call('POST', '/admin/action', { form: { csrf, action: 'task_add', ai: 'claude', text: 'Admin task' } });
ok((await env.KV.get('prog:claude', 'json')).tasks.some((t) => t.text === 'Admin task'), 'admin task add');
// prompts on Emails page
r = await call('GET', '/admin/emails');
ok(r.text.includes('id="sched_chatgpt"') && r.text.includes('ChatGPT Scheduled task prompt') && !r.text.includes('id="sched_claude"') && ['chatgpt', 'claude', 'grok', 'copilot'].every((ai) => r.text.includes(`data-copy="instr_${ai}"`)), 'Emails: custom instructions for all + ChatGPT scheduled prompt');

// ---- OrderPilot standalone workspace ----
r = await call('GET', '/orderpilot', { noCookie: true });
{
  const csp = r.headers.get('content-security-policy') || '';
  ok(r.status === 200 && r.text.includes('OrderPilot') && r.text.includes('Customer cases') && r.text.includes('DEMO DATA ONLY'), 'OrderPilot route renders standalone demo workspace');
  ok(csp.includes("script-src 'unsafe-inline'") && csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'none'") && !csp.includes('https://'), 'OrderPilot CSP permits its inline UI only, with no network access');
  ok(r.headers.get('cache-control') === 'no-store', 'OrderPilot demo is not cached');
}
r = await call('POST', '/orderpilot', { noCookie: true });
ok(r.status === 405, 'OrderPilot rejects non-read requests');
r = await call('GET', '/admin', { noCookie: true });
ok(r.status === 200 && r.text.includes('Admin password'), 'OrderPilot route does not replace existing admin');

// ---- Hosted apps ----
const APP_HTML = '<!DOCTYPE html><html><head><title>t</title></head><body><h1>Invoice demo</h1><script>document.title="x"</script></body></html>';
r = await call('GET', '/apps/live-hq-invoice-maker', { noCookie: true });
ok(r.status === 200 && r.text.includes('Live HQ Invoice Maker') && r.text.includes('Waiting for Claude to upload') && !r.text.includes('<iframe'), 'placeholder page public, waiting');
r = await call('GET', '/apps/live-hq-invoice-maker/raw', { noCookie: true });
ok(r.status === 404, 'placeholder raw 404');
res = await tool(K.grok, 'publish_app', { slug: 'live-hq-invoice-maker', title: 'Hijack', html: APP_HTML });
ok(res.isError && res.content[0].text.includes('belongs to Claude'), 'only Claude may publish reserved slug');
res = await tool(K.claude, 'publish_app', { slug: 'Bad Slug!', title: 'x', html: APP_HTML });
ok(res.isError && res.content[0].text.includes('slug'), 'slug validation');
res = await tool(K.claude, 'publish_app', { slug: 'live-hq-invoice-maker', title: 'x', html: 'export default function App(){ return <div/> }' });
ok(res.isError && res.content[0].text.includes('Babel'), 'JSX without HTML rejected with guidance');
res = await tool(K.claude, 'publish_app', { slug: 'live-hq-invoice-maker', title: 'x', html: '<!DOCTYPE html><html>' + 'a'.repeat(1048577) + '</html>' });
ok(res.isError && res.content[0].text.includes('too big'), 'html size cap 1 MB');
ok(!(await env.KV.get(`acount:claude:${day}`)), 'rejected publishes do not count');
res = await tool(K.claude, 'list_my_apps', {});
ok(res.structuredContent.apps.length === 1 && res.structuredContent.apps[0].status === 'waiting for upload', 'list_my_apps shows reserved slot');
res = await tool(K.claude, 'publish_app', { slug: 'live-hq-invoice-maker', title: 'Whatever', html: APP_HTML, description: 'Invoices' });
ok(!res.isError && res.structuredContent.app.title === 'Live HQ Invoice Maker' && res.structuredContent.app.url === ORIGIN + '/apps/live-hq-invoice-maker', 'Claude publishes reserved slot (title fixed)');
r = await call('GET', '/apps/live-hq-invoice-maker', { noCookie: true });
{ const csp = r.headers.get('content-security-policy');
  ok(r.status === 200 && r.text.includes('<iframe src="/apps/live-hq-invoice-maker/raw"') && r.text.includes('sandbox="allow-scripts allow-forms allow-downloads allow-modals allow-popups"') && !r.text.includes('allow-same-origin') && r.text.includes('<b>Live HQ</b>'), 'wrapper: sandboxed iframe + Live HQ header');
  ok(csp.includes("frame-src 'self'") && !csp.includes('script-src') && r.headers.get('x-frame-options') === 'DENY', 'wrapper CSP: no scripts'); }
r = await call('GET', '/apps/live-hq-invoice-maker/raw', { noCookie: true });
{ const csp = r.headers.get('content-security-policy') || '';
  ok(r.status === 200 && r.text === APP_HTML, 'raw serves stored HTML');
  ok(csp.startsWith('sandbox allow-scripts allow-forms allow-downloads allow-modals allow-popups;') && !csp.includes('allow-same-origin') && csp.includes('https://cdnjs.cloudflare.com') && csp.includes('https://cdn.tailwindcss.com') && csp.includes('https://unpkg.com') && csp.includes('https://cdn.jsdelivr.net') && csp.includes("frame-ancestors 'self'") && !/connect-src[^;]*'self'/.test(csp), 'raw CSP sandbox + CDNs, no same-origin');
  ok(r.headers.get('x-frame-options') === 'SAMEORIGIN' && !r.headers.get('set-cookie'), 'raw frameable by hub only'); }
r = await call('POST', '/apps/live-hq-invoice-maker', { noCookie: true });
ok(r.status === 405, 'apps: POST not allowed');
r = await call('GET', '/apps/live-hq-invoice-maker/raw/x', { noCookie: true });
ok(r.status === 404, 'apps: bad path');
r = await call('POST', '/api/v1/apps', { headers: { authorization: 'Bearer ' + K.grok }, body: { slug: 'meme-maker', title: 'Meme Maker', html: APP_HTML } });
ok(r.status === 200 && r.json().app.owner === 'Grok', 'REST publish own app');
r = await call('GET', '/api/v1/apps', { headers: { authorization: 'Bearer ' + K.grok } });
ok(r.status === 200 && r.json().count === 1 && r.json().publishes_today === 1, 'REST list my apps');
res = await tool(K.claude, 'publish_app', { slug: 'meme-maker', title: 'x', html: APP_HTML });
ok(res.isError && res.content[0].text.includes('belongs to Grok'), 'cannot overwrite another AI app');
res = await tool(K.claude, 'unpublish_app', { slug: 'meme-maker' });
ok(res.isError, 'cannot unpublish another AI app');
await env.KV.put(`acount:grok:${day}`, '30');
r = await call('POST', '/api/v1/apps', { headers: { authorization: 'Bearer ' + K.grok }, body: { slug: 'meme-maker', title: 'Meme Maker', html: APP_HTML } });
ok(r.status === 429, 'publish limit 30/day');
r = await call('GET', '/admin/apps');
ok(r.status === 200 && r.text.includes('Live HQ Invoice Maker') && r.text.includes('Meme Maker') && r.text.includes('Owner:</span> Claude') && (r.text.match(/value="app_unpublish"/g) || []).length === 2 && r.text.includes('href="/admin/apps"'), 'admin Apps page');
r = await call('POST', '/admin/action', { form: { csrf, action: 'app_unpublish', slug: 'live-hq-invoice-maker' } });
ok(r.headers.get('location') === '/admin/apps?msg=unpublished' && !(await env.KV.get('apphtml:live-hq-invoice-maker')), 'admin unpublish');
r = await call('GET', '/apps/live-hq-invoice-maker', { noCookie: true });
ok(r.text.includes('Waiting for Claude to upload'), 'reserved slot returns to waiting after unpublish');
res = await tool(K.grok, 'unpublish_app', { slug: 'meme-maker' });
ok(!res.isError && !(await env.KV.get('appmeta:meme-maker')), 'AI unpublishes own app');
r = await call('GET', `/ai/claude/help.txt?key=${K.claude}`);
ok(r.text.includes('publish_app'), 'help.txt mentions publish_app');
r = await mcp(K.claude, 'tools/list', {});
ok(r.json().result.tools.find((t) => t.name === 'publish_app').description.includes('Babel standalone'), 'publish_app description: self-contained HTML + React guidance');

// ---- Live HQ branding + any host ----
r = await call('GET', '/admin');
ok(r.text.includes('<div class="brand">Live HQ</div>') && r.text.includes('<title>Overview — Live HQ</title>') && !r.text.includes('AI Mail Hub'), 'branding: Live HQ in title and sidebar');
r = await mcp(K.claude, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
ok(r.json().result.serverInfo.name === 'live-hq-claude' && r.json().result.serverInfo.title === 'Live HQ (Claude)', 'MCP server name Live HQ');
r = await call('GET', '/openapi.json');
ok(r.json().info.title === 'Live HQ', 'openapi title Live HQ');
r = await call('GET', '/admin/gmail');
ok(r.text.includes(ORIGIN + '/oauth/google/callback') && r.text.includes('https://live-hq.pages.dev/oauth/google/callback') && r.text.includes('https://ai-mail-hub.livehqfield.workers.dev/oauth/google/callback'), 'gmail page lists redirect URIs for every host');
{ const rr = await worker.fetch(new Request('https://ai-mail-hub.x.workers.dev/openapi.json', { headers: { 'x-forwarded-host': 'live-hq.pages.dev' } }), env); ok((await rr.json()).servers[0].url === 'https://live-hq.pages.dev', 'X-Forwarded-Host live-hq.pages.dev trusted'); }
{ const rr = await worker.fetch(new Request('https://ai-mail-hub.x.workers.dev/openapi.json', { headers: { 'x-forwarded-host': 'evil.example' } }), env); ok((await rr.json()).servers[0].url === 'https://ai-mail-hub.x.workers.dev', 'other X-Forwarded-Host ignored'); }
{ const rr = await worker.fetch(new Request('https://live-hq.pages.dev/admin/login', { method: 'POST', headers: { origin: 'https://live-hq.pages.dev', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(ADMIN_PW), redirect: 'manual' }), env); ok(rr.status === 303 && /^__Host-amh_admin=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax/.test(rr.headers.get('set-cookie') || ''), 'admin login works on live-hq.pages.dev (host-only cookie)'); }
{ const rr = await worker.fetch(new Request('https://live-hq.livehqfield.workers.dev/openapi.json'), env); const j = await rr.json(); ok(j.servers[0].url === 'https://live-hq.livehqfield.workers.dev', 'openapi server follows request host'); }

// Web page
const sentBefore = google.sent.length;
r = await call('GET', `/ai/chatgpt?key=${K.chatgpt}`);
ok(r.status === 200 && r.text.includes('Quote please'), 'web inbox page');
r = await call('GET', `/ai/chatgpt?key=${K.claude}`);
ok(r.status === 401, 'web page wrong AI key rejected');
r = await call('GET', `/ai/chatgpt/inbox.txt?key=${K.chatgpt}`);
ok(r.status === 200 && r.headers.get('content-type').includes('text/plain') && r.text.includes('/ai/chatgpt/msg/m1.txt?key='), 'inbox.txt');
r = await call('GET', `/ai/chatgpt/msg/m1.txt?key=${K.chatgpt}`);
ok(r.status === 200 && r.text.includes('Hi, can I get a quote?') && !r.text.includes('CROSS-AI'), 'msg .txt');
r = await call('GET', `/ai/chatgpt/sent.txt?key=${K.chatgpt}`);
ok(r.status === 200, 'sent.txt');
r = await call('GET', `/ai/chatgpt/help.txt?key=${K.chatgpt}`);
ok(r.status === 200 && r.text.includes('links can never send'), 'help.txt');
r = await call('GET', `/ai/chatgpt/send?key=${K.chatgpt}&to=a@example.com&subject=x&body=y`);
ok(r.status === 404 && google.sent.length === sentBefore, 'GET never sends');
r = await call('GET', `/ai/chatgpt?key=${K.chatgpt}&view=compose`);
const aiCsrf = csrfOf(r.text);
ok(r.status === 200 && aiCsrf, 'compose form');
r = await call('POST', '/ai/chatgpt/send', { form: { key: K.chatgpt, to: 'a@example.com', subject: 'Web', body: 'from web' } });
ok(r.status === 403 && google.sent.length === sentBefore, 'web POST without CSRF rejected');
r = await call('POST', '/ai/chatgpt/send', { form: { key: K.chatgpt, csrf: aiCsrf, to: 'a@example.com', subject: 'Web', body: 'from web' }, headers: { origin: 'https://evil.example' } });
ok(r.status === 403 && google.sent.length === sentBefore, 'web cross-origin POST rejected');
r = await call('POST', '/ai/chatgpt/send', { form: { key: K.claude, csrf: aiCsrf, to: 'a@example.com', subject: 'Web', body: 'from web' } });
ok(r.status === 401 && google.sent.length === sentBefore, 'web POST wrong key rejected');
r = await call('POST', '/ai/chatgpt/send', { form: { key: K.chatgpt, csrf: aiCsrf, to: 'a@example.com', subject: 'Web', body: 'from web', dry_run: 'true' } });
ok(r.status === 200 && r.text.includes('Test only') && google.sent.length === sentBefore, 'web dry run');
r = await call('POST', '/ai/chatgpt/send', { form: { key: K.chatgpt, csrf: aiCsrf, to: 'a@example.com', subject: 'Web', body: 'from web' } });
ok(r.status === 200 && r.text.includes('Sent.') && google.sent.length === sentBefore + 1, 'web send');
r = await call('GET', `/ai/chatgpt/msg/m1?key=${K.chatgpt}`);
ok(r.status === 200 && r.text.includes('Send reply'), 'web message view with reply form');

// Settings: pause + display name + reply-to off
r = await call('POST', '/admin/action', { form: { action: 'save_settings', csrf, display_chatgpt: 'Doenit Sales', display_claude: 'C', display_grok: 'G', display_copilot: 'P', reply_to_plus: '1' } });
ok(r.headers.get('location') === '/admin/settings?msg=saved', 'save settings -> Settings page');
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com', subject: 'x', body: 'hi' });
ok(res.isError && res.content[0].text.includes('paused'), 'sending pause works');
r = await call('POST', '/admin/action', { form: { action: 'save_settings', csrf, display_chatgpt: 'Doenit Sales', display_claude: 'C', display_grok: 'G', display_copilot: 'P', sending_enabled: '1' } });
res = await tool(K.chatgpt, 'send_email', { to: 'a@example.com', subject: 'x', body: 'hi' });
raw = new TextDecoder().decode(bytesFromB64url(google.sent.at(-1).raw));
ok(!res.isError && raw.includes('From: "Doenit Sales" <livehqfield@gmail.com>') && !raw.includes('Reply-To') && raw.includes('Bcc: livehqfield+chatgpt@gmail.com'), 'display name + reply-to toggle');

// Dashboard: log, show key, revoke
r = await call('GET', '/admin/settings');
ok(r.text.includes('Send log') && r.text.includes('dry_run') && r.text.includes('blocked_limit') && r.text.includes('sent'), 'send log visible');
ok(!Object.values(K).some((k) => r.text.includes(k)), 'keys hidden by default');
r = await call('POST', '/admin/action', { form: { action: 'show_key', ai: 'grok', csrf } });
ok(r.status === 303 && r.headers.get('location') === '/admin/emails#ai-grok', 'show key -> Emails page');
r = await call('GET', '/admin');
ok(r.text.includes('class="side"') && ['/admin/emails', '/admin/gmail', '/admin/settings'].every((h) => r.text.includes(`href="${h}"`)) && r.text.includes('aria-current="page">Overview') && r.text.includes('Sign out'), 'overview has sidebar with Connections items');
const blocks = [...r.text.matchAll(/id="block-(\w+)"><div class="bhead"><h2>([^<]+)<\/h2>/g)].map((m) => m[2]);
ok(blocks.join('|') === 'ChatGPT|Claude|Grok|Co Pilot' && r.text.includes('class="stack"') && !r.text.includes('grid4'), 'overview: 4 stacked blocks in order');
ok(['Money Earned', 'Money Spent', 'Net / Profit', 'Business:', 'Last updated:'].every((x) => r.text.includes(x)) && r.text.includes('href="/admin/money/chatgpt"'), 'overview blocks: money + business fields + transactions link');
ok(['chatgpt', 'claude', 'grok', 'copilot'].every((ai) => r.text.includes(`livehqfield+${ai}@gmail.com`) && r.text.includes(`<a class="btn grey" href="/admin/emails#ai-${ai}">Go to connections`)) && r.text.includes('Key active') && r.text.includes('Emails sent today'), 'overview blocks: address, key status, sent today, connections link');
ok(!r.text.includes('id="gmail"') && !r.text.includes('id="settings"') && !r.text.includes('id="log"') && !r.text.includes('Connect Gmail') && !r.text.includes('/mcp/') && !r.text.includes('?key='), 'overview has no Gmail/settings/log/links');
r = await call('GET', '/admin/gmail');
ok(r.status === 200 && r.text.includes('aria-current="page">Gmail') && r.text.includes('id="gmail"') && r.text.includes('Disconnect Gmail') && !r.text.includes('amh_'), 'Gmail page');
r = await call('GET', '/admin/settings');
ok(r.status === 200 && r.text.includes('aria-current="page">Settings') && r.text.includes('id="settings"') && r.text.includes('id="log"') && r.text.includes('name="sending_enabled"') && r.text.includes('name="reply_to_plus"') && !r.text.includes('amh_'), 'Settings & log page');
for (const pth of ['/admin/gmail', '/admin/settings']) { const x = await call('GET', pth, { noCookie: true }); ok(x.status === 303 && x.headers.get('location') === '/admin', pth + ' needs sign-in'); }
r = await call('GET', '/admin');
ok(!Object.values(K).some((k) => r.text.includes(k)) && !r.text.includes('/mcp/amh_'), 'overview shows no keys or connector links');
r = await call('GET', '/admin/emails');
ok(r.status === 200 && r.text.includes('aria-current="page">Emails') && r.text.includes('class="side"'), 'Emails page renders with sidebar');
ok(r.text.includes(`value="${ORIGIN}/mcp/${K.grok}"`) && r.text.includes(`value="${K.grok}"`) && r.text.includes(`value="${ORIGIN}/ai/grok?key=${K.grok}"`) && r.text.includes(`value="${ORIGIN}/ai/grok/help.txt?key=${K.grok}"`), 'Emails page: MCP, key, web, help for Grok');
ok(['chatgpt', 'claude', 'grok', 'copilot'].every((ai) => r.text.includes(`id="ai-${ai}"`) && r.text.includes(`livehqfield+${ai}@gmail.com`) && r.text.includes(`data-copy="mcp_${ai}"`) && r.text.includes(`data-copy="key_${ai}"`) && r.text.includes(`data-copy="web_${ai}"`) && r.text.includes(`data-copy="help_${ai}"`)), 'Emails page: 4 cards with copy buttons');
ok(r.text.includes('No authentication') && r.text.includes('No sign in') && r.text.includes('grok.com/connectors') && r.text.includes("Copilot's built-in Gmail") && (r.text.match(/Open web page<\/a>/g) || []).length === 4, 'Emails page: how-to notes + Open web page buttons');
ok(r.text.includes('@media (max-width:800px)') && r.text.includes('src="/admin/assets/copy.js"'), 'mobile top menu CSS + copy script');
ok(/script-src 'self'/.test(r.headers.get('content-security-policy')) && !/unsafe-inline'[^;]*script|script-src[^;]*unsafe/.test(r.headers.get('content-security-policy')), 'CSP allows only own script');
r = await call('GET', '/admin/emails', { noCookie: true });
ok(r.status === 303 && r.headers.get('location') === '/admin' && !r.text.includes('amh_'), 'Emails page needs sign-in');
r = await call('GET', '/admin/assets/copy.js', { noCookie: true });
ok(r.status === 200 && r.headers.get('content-type').includes('javascript') && r.text.includes('data-copy') && !r.text.includes('amh_'), 'copy.js served, no secrets');
r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai: 'copilot', csrf } });
ok(r.status === 303 && r.headers.get('location') === '/admin/emails?msg=rotated#ai-copilot', 'rotate (HTML) -> Emails page');
r = await call('GET', '/admin/emails?msg=rotated');
const newCopilot = (r.text.match(/value="(amh_copilot_[^"]+)"/) || [])[1];
ok(newCopilot && newCopilot !== K.copilot && r.text.includes('New key made'), 'rotated key shown on Emails page');
K.copilot = newCopilot;
r = await call('POST', '/admin/action', { form: { action: 'revoke_key', ai: 'grok', csrf } });
ok(r.headers.get('location') === '/admin/emails?msg=revoked#ai-grok', 'revoke -> Emails page');
const rv2 = await call('GET', '/admin/emails');
ok(!rv2.text.includes(K.grok) && rv2.text.includes('Key revoked.'), 'revoked key no longer shown');
r = await call('GET', '/api/v1/me', { headers: { authorization: 'Bearer ' + K.grok } });
ok(r.status === 401, 'revoked key rejected');
r = await call('POST', '/admin/action', { form: { action: 'rotate_key', ai: 'claude', csrf }, headers: { accept: 'application/json' } });
const newClaude = r.json().key;
r = await call('GET', '/api/v1/me', { headers: { authorization: 'Bearer ' + K.claude } });
const r2 = await call('GET', '/api/v1/me', { headers: { authorization: 'Bearer ' + newClaude } });
ok(r.status === 401 && r2.status === 200, 'rotate invalidates old key');

// Expired Google connection
await env.KV.delete('gmail:at');
google.refreshError = 'invalid_grant';
res = await tool(K.chatgpt, 'list_inbox', {});
ok(res.isError && res.content[0].text.includes('expired'), 'invalid_grant -> reconnect message');
r = await call('GET', '/admin/gmail');
ok(r.text.includes('connection expired'), 'dashboard shows reconnect needed');
google.refreshError = null;

// Disconnect
r = await call('POST', '/admin/action', { form: { action: 'disconnect_gmail', csrf } });
ok(!(await env.KV.get('gmail:rt')) && google.revoked >= 1 && r.headers.get('location') === '/admin/gmail?msg=disconnected', 'disconnect revokes and deletes token -> Gmail page');

// Logout
r = await call('POST', '/admin/logout', { form: { csrf } });
r = await call('GET', '/admin');
ok(r.text.includes('Admin password'), 'logout ends session');

// Brute force
for (let i = 0; i < 11; i++) r = await call('POST', '/admin/login', { form: { password: 'nope' }, headers: { 'cf-connecting-ip': '9.9.9.9' } });
ok(r.status === 429, 'login brute-force limit');

// Secrets never leak in any response
const all = bodies.join('\n');
ok(!all.includes(SECRET_RT) && !all.includes(ADMIN_PW) && !all.includes(env.ENC_KEY) && !all.includes('GOCSPX-testsecret123'), 'no refresh token / password / enc key / client secret in responses');
ok(google.otherFetch.length === 0, 'no unexpected network calls');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
