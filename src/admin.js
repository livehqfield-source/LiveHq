// Admin dashboard for Johan (password + session cookie + CSRF tokens).
import { AIS, AI_IDS, ACCOUNT, DAILY_LIMIT, SCOPES, AUTH_URL, TOKEN_URL, GMAIL, REVOKE_URL, plusAddr, AppError,
  getSettings, saveSettings, getGoogleClient, encryptStr, decryptStr, sha256Hex, safeEqual, randomToken,
  newKey, revealKey, readLog, sentToday, labelMap, labelNames, fmtDate } from './core.js';
import { esc, page, adminPage } from './html.js';
import { getBiz, statsView, listTransactions, adminEditTx, adminDeleteTx, updateBusiness, logMoney, zar } from './money.js';
import { getLimit, limitView, reportLimit, clearLimit, continueUrl, CONTINUE_PROMPT, DEFAULT_RESET_HOURS } from './limits.js';
import { appsAdminBody, unpublishApp } from './apps.js';
import { getProg, openTasks, saveProgress, addTask, updateTask, adminDeleteTask, adminDeleteNote } from './progress.js';

const COOKIE = '__Host-amh_admin';
const SESSION_TTL = 12 * 3600;
const html = (s, status = 200, headers = {}) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (loc, headers = {}) => new Response(null, { status: 303, headers: { location: loc, ...headers } });

function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
export async function getSession(req, env) {
  const sid = cookies(req)[COOKIE];
  if (!sid || !/^[A-Za-z0-9_-]{30,80}$/.test(sid)) return null;
  const h = await sha256Hex(sid);
  const s = await env.KV.get('sess:' + h, 'json');
  return s ? { ...s, sidHash: h } : null;
}
const KNOWN_ORIGINS = ['https://live-hq.pages.dev', 'https://ai-mail-hub.livehqfield.workers.dev'];
export const redirectUri = (origin) => `${origin}/oauth/google/callback`;

function loginPage(msg = '') {
  return page('Live HQ — Admin', `<div class="card"><h2>Sign in</h2>${msg ? `<div class="bad">${esc(msg)}</div>` : ''}
<form method="post" action="/admin/login"><label for="p">Admin password</label><input id="p" type="password" name="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form></div>`, 'Private page for Johan');
}

function connectorText(ai, origin, key) {
  const k = key || 'YOUR-KEY';
  return {
    mcp: `${origin}/mcp/${k}`,
    web: `${origin}/ai/${ai}?key=${k}`,
    txt: `${origin}/ai/${ai}/help.txt?key=${k}`,
  };
}

export const PROMPTS = {
  instructions: `You are in Johan's AI Million Challenge and you use the Live HQ connector. At the START of every chat, before anything else, call get_my_progress and get_my_stats, then continue the first open task yourself. Do not wait for Johan to tell you to continue. Mark tasks "doing" and "done" with update_task. Log every real rand earned or spent with log_money (never estimates). Before you finish every reply, or when your usage limit may be near, call save_progress with your current focus, a short note on what you did and what is next, and your next_steps. If you reach your usage limit, call save_progress and then report_limit.`,
  copilot: `You are in Johan's AI Million Challenge. At the start of every chat, open your progress link and stats link (Johan gives them to you) and continue the first open task yourself, without waiting to be told. At the end of every reply, write a short "PROGRESS UPDATE" with: current focus, what you did, money earned or spent (real money only), and your next 3 steps, so Johan can paste it into your Progress tab.`,
  scheduled: `Using the Live HQ app: call get_my_progress and get_my_stats, then check your inbox with list_inbox and reply to any client emails. Do the next open task on your list and mark it with update_task. Log any real money earned or spent with log_money. Finish by calling save_progress with your current focus, a short note on what you did, and your updated next_steps.`,
};

const HOWTO = {
  chatgpt: `<ol><li>On chatgpt.com (web): Settings → Apps → Advanced settings → turn on <b>Developer mode</b>.</li>
<li>Apps (or Plugins) → <b>Create</b> / <b>+</b> → <b>Add custom MCP server</b>. Name: <i>Live HQ</i>.</li>
<li>Server URL: paste the <b>Connector link (MCP)</b>. Authentication: <b>No authentication</b>. Tick "I understand" → Create.</li>
<li>In a chat, click <b>+</b> (or type @) and pick Live HQ.</li></ol>
<p class="muted">Backup: Custom GPT → Actions → Import from URL <code>{ORIGIN}/openapi.json</code> → Authentication: API Key, Bearer, paste the Key.</p>`,
  claude: `<ol><li>claude.ai → Customize (or Settings) → <b>Connectors</b>.</li>
<li><b>Add</b> → <b>Custom</b> → <b>Web</b> (or "Add custom connector"). Name: <i>Live HQ</i>.</li>
<li>URL: paste the <b>Connector link (MCP)</b> → Continue → Authentication: <b>No sign in</b> → Add.</li>
<li>In a chat, switch Live HQ on in the tools menu.</li></ol><p class="muted">Free Claude allows one custom connector.</p>`,
  grok: `<ol><li>Go to grok.com/connectors → <b>New Connector</b> → <b>Custom</b>.</li>
<li>Paste the <b>Connector link (MCP)</b>. No sign-in is needed.</li>
<li>In a chat say: "Use the Live HQ connector to check my inbox."</li></ol>
<p class="muted">If Custom is not on your plan: give Grok the <b>Help link</b> to read mail, and send from the web page yourself.</p>`,
  copilot: `<ol><li>Copilot cannot add custom connectors, so this one is manual.</li>
<li>Reading: give Copilot the <b>Help link</b> (or open the web page and paste the email text into Copilot).</li>
<li>Sending: click <b>Open web page</b>, paste Copilot's text into <b>New email</b> or <b>Reply</b>, and click Send.</li></ol>
<div class="warn">Do <b>not</b> use Copilot's built-in Gmail connector. It sees the whole mailbox, including the other AIs' mail.</div>`,
};

function adminShell(active, session, body, notice = '') {
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const nav = `<nav class="side" aria-label="Admin menu"><div class="brand">Live HQ</div>
<div class="sec">Dashboard</div>
${link('/admin', 'Overview', 'overview')}
<div class="sec">Connections</div>
${link('/admin/emails', 'Emails', 'emails')}
${link('/admin/gmail', 'Gmail', 'gmail')}
${link('/admin/settings', 'Settings &amp; log', 'settings')}
<div class="sec">Apps</div>
${link('/admin/apps', 'Apps', 'apps')}
<div class="sec">Account</div>
<form method="post" action="/admin/logout">${csrf}<button class="navbtn" type="submit">Sign out</button></form></nav>`;
  const titles = { overview: 'Overview', emails: 'Emails', gmail: 'Gmail', settings: 'Settings & log', apps: 'Apps' };
  return adminPage(`${titles[active]} — Live HQ`, nav, notice + body);
}

async function connectionPages(env, origin, session, withLabels = false) {
  const settings = await getSettings(env);
  const client = await getGoogleClient(env);
  const st = (await env.KV.get('gmail:state', 'json')) || { state: 'not_connected' };
  const connected = !!(await env.KV.get('gmail:rt'));
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
  const btn = (action, label, cls = '', extra = '') => `<form method="post" action="/admin/action" class="inline">${csrf}<input type="hidden" name="action" value="${action}">${extra}<button class="${cls}" type="submit">${esc(label)}</button></form>`;

  let gmailBox;
  if (connected && st.state === 'connected') gmailBox = `<div class="ok">Connected to <b>${esc(st.email || ACCOUNT)}</b> since ${esc(fmtDate(st.at))}.</div>`;
  else if (connected && st.state === 'needs_reconnect') gmailBox = `<div class="bad">The Gmail connection expired. Click <b>Connect Gmail</b> again.</div>`;
  else gmailBox = `<div class="warn">Gmail is not connected yet.</div>`;
  let labelBox = '';
  if (withLabels && connected && st.state === 'connected') {
    try {
      const map = await labelMap(env, true);
      const all = AI_IDS.flatMap(labelNames);
      const missing = all.filter((n) => !map[n]);
      labelBox = missing.length ? `<div class="bad">Missing labels: ${esc(missing.join(', '))}</div>` : `<p class="muted">All 12 AI labels found in Gmail.</p>`;
    } catch (e) { labelBox = `<div class="bad">${esc(e instanceof AppError ? e.message : 'Could not check the labels.')}</div>`; }
  }
  const clientBox = client
    ? `<p>Google login key: <b>set</b> (${client.source === 'worker-secret' ? 'stored as a Worker secret' : 'saved on this page, encrypted'}).</p>`
    : `<p>Google login key: <b>not set yet</b>. Follow SETUP_FOR_JOHAN, then paste the Client ID and Client secret below.</p>`;
  const clientForm = client && client.source === 'worker-secret' ? '' : `<details${client ? '' : ' open'}><summary>${client ? 'Change' : 'Paste'} the Google Client ID and secret</summary>
<form method="post" action="/admin/action">${csrf}<input type="hidden" name="action" value="save_google_client">
<label for="cid">Client ID</label><input id="cid" type="text" name="client_id" autocomplete="off" required placeholder="....apps.googleusercontent.com">
<label for="cs">Client secret</label><input id="cs" type="password" name="client_secret" autocomplete="off" required>
<button type="submit">Save</button></form></details>`;
  const connectBtn = `<form method="post" action="/admin/action" class="inline">${csrf}<input type="hidden" name="action" value="connect_gmail"><button type="submit"${client ? '' : ' disabled title="Set the Google Client ID and secret first"'}>${connected ? 'Connect Gmail again' : 'Connect Gmail'}</button></form>`;
  const gmailCard = `<div class="card" id="gmail"><h2>Gmail connection</h2>${gmailBox}${labelBox}${clientBox}
<p class="muted">Redirect URI to paste into Google Cloud: <code>${esc(redirectUri(origin))}</code></p>${KNOWN_ORIGINS.filter((o) => o !== origin).length ? `<p class="muted">Add these too, so Connect Gmail works on every address: ${KNOWN_ORIGINS.filter((o) => o !== origin).map((o) => `<code>${esc(redirectUri(o))}</code>`).join(' ')}</p>` : ''}
${connectBtn}
${connected ? btn('disconnect_gmail', 'Disconnect Gmail', 'red') : ''}${clientForm}</div>`;

  const settingsCard = `<div class="card" id="settings"><h2>Sending settings</h2>
<p>${settings.sending_enabled ? '<span class="pill on">Sending is ON</span>' : '<span class="pill off">Sending is PAUSED</span>'}</p>
<form method="post" action="/admin/action">${csrf}<input type="hidden" name="action" value="save_settings">
${AI_IDS.map((ai) => `<label for="d_${ai}">Sender name for ${esc(AIS[ai].name)}</label><input id="d_${ai}" type="text" name="display_${ai}" value="${esc(settings.display[ai])}" maxlength="80">`).join('')}
<label><input type="checkbox" name="sending_enabled" value="1"${settings.sending_enabled ? ' checked' : ''}> AIs may send emails (untick to pause all sending)</label>
<label><input type="checkbox" name="reply_to_plus" value="1"${settings.reply_to_plus ? ' checked' : ''}> Replies from clients go to the AI's own address (Reply-To: livehqfield+ai@gmail.com)</label>
<button type="submit">Save settings</button></form><p class="muted">Every email is sent from ${ACCOUNT}, with a hidden copy (BCC) to the AI's own address so Gmail files it in that AI's Sent label. Limit: ${DAILY_LIMIT} emails per AI per day.</p></div>`;

  const log = await readLog(env, 100);
  const logCard = `<div class="card" id="log"><h2>Send log (newest first)</h2>${log.length ? `<div style="overflow-x:auto"><table><tr><th>When</th><th>AI</th><th>Status</th><th>To</th><th>Subject</th><th>Via</th></tr>${log.map((e) => `<tr><td>${esc(fmtDate(e.ts))}</td><td>${esc((AIS[e.ai] || {}).name || e.ai)}</td><td>${esc(e.status)}${e.error ? '<br><small>' + esc(e.error) + '</small>' : ''}</td><td>${esc(e.to)}${e.cc ? '<br><small>cc ' + esc(e.cc) + '</small>' : ''}</td><td>${esc(e.kind === 'reply' ? '↩ ' : '')}${esc(e.subject)}</td><td>${esc(e.via)}</td></tr>`).join('')}</table></div>` : '<p class="muted">Nothing sent yet.</p>'}</div>`;
  return { gmailCard, settingsCard, logCard };
}

async function gmailPage(env, origin, session, notice = '') {
  const { gmailCard } = await connectionPages(env, origin, session, true);
  return adminShell('gmail', session, `<h1 class="pt">Gmail</h1>` + gmailCard, notice);
}
async function settingsPage(env, origin, session, notice = '') {
  const { settingsCard, logCard } = await connectionPages(env, origin, session);
  return adminShell('settings', session, `<h1 class="pt">Settings &amp; log</h1>` + settingsCard + logCard, notice);
}

async function progressSnippet(env, ai) {
  const p = await getProg(env, ai);
  const open = openTasks(p).slice(0, 3);
  return `<div class="prog"><p><span class="lbl">Current focus:</span> ${p.focus ? esc(p.focus) : '<span class="muted">not saved yet</span>'}</p>
${open.length ? `<span class="lbl">Next tasks:</span><ol class="tasks">${open.map((t) => `<li><span class="st ${t.status}">${esc(t.status)}</span>${esc(t.text)}</li>`).join('')}</ol>` : '<p class="muted">No open tasks.</p>'}
<p class="muted">Progress saved: ${p.updated_at ? `${esc(fmtDate(p.updated_at))} by ${esc(p.updated_by)}` : 'never'}</p></div>`;
}

const hm = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

async function limitSnippet(env, ai, session) {
  const lv = limitView(await getLimit(env, ai));
  const red = lv.state === 'waiting'; // only when resets_at is still in the future
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}"><input type="hidden" name="ai" value="${ai}">`;
  const dot = red
    ? `<span class="status red" data-resets="${esc(lv.resets_at_iso)}" title="Limit reached at ${esc(lv.limit_hit_at)} (${esc(lv.reported_by || '')}); resets ${esc(lv.resets_at)}"><i class="dot"></i><span class="stxt">Limit reached, resets in <b class="countdown">${hm(lv.minutes_left)}</b></span></span>`
    : '<span class="status green"><i class="dot"></i><span class="stxt">Available</span></span>';
  const info = red ? `<p class="muted limnote" data-limnote>Limit reached at ${esc(lv.limit_hit_at)} · resets ${esc(lv.resets_at)}</p>` : '';
  const setForm = `<details class="limform"><summary class="mini">Mark limit</summary><form method="post" action="/admin/action" class="txrow">${csrf}<input type="hidden" name="action" value="limit_set">
<label for="h_${ai}" style="margin:0">Resets in (hours)</label><input id="h_${ai}" type="text" inputmode="decimal" name="hours" value="${DEFAULT_RESET_HOURS[ai]}" style="width:70px">
<span class="muted">or at</span><input type="text" name="resets_at" placeholder="2026-11-16 18:30" style="width:150px" aria-label="Reset time (SAST)"><button type="submit" class="grey">Save</button></form></details>`;
  const clear = red ? `<form method="post" action="/admin/action" class="inline" data-clearlimit>${csrf}<input type="hidden" name="action" value="limit_clear"><button type="submit" class="grey">Clear limit</button></form>` : '';
  const cont = `<a class="btn ghost" href="${esc(continueUrl(ai))}" target="_blank" rel="noopener noreferrer" data-copytext="${esc(CONTINUE_PROMPT)}" title="Last resort: opens ${esc(AIS[ai].name)} with the continue prompt (also copied)">Continue ↗</a>`;
  return { red, dot, html: `${info}<div class="row limrow">${cont}${clear}${setForm}</div>` };
}

async function appsPage(env, origin, session, notice = '') {
  return adminShell('apps', session, await appsAdminBody(env, origin, session), notice);
}

async function overviewPage(env, origin, session, notice = '') {
  const blocks = [];
  for (const ai of AI_IDS) {
    const lim = await limitSnippet(env, ai, session);
    const rec = await env.KV.get('key:' + ai, 'json');
    const status = rec && rec.hash ? '<span class="pill on">Key active</span>' : rec && rec.revoked ? '<span class="pill off">Key revoked</span>' : '<span class="pill off">No key yet</span>';
    const b = await getBiz(env, ai);
    const net = b.earned_cents - b.spent_cents;
    blocks.push(`<div class="card block${lim.red ? ' waiting' : ''}" id="block-${ai}"><div class="bhead"><h2>${esc(AIS[ai].name)}</h2>${lim.dot}${status}</div>
<div class="money"><div><span>Money Earned</span><b>${esc(zar(b.earned_cents))}</b></div><div><span>Money Spent</span><b>${esc(zar(b.spent_cents))}</b></div><div><span>Net / Profit</span><b class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${esc(zar(net))}</b></div></div>
<p><span class="lbl">Business:</span> ${b.name ? `<b>${esc(b.name)}</b>` : '<span class="muted">not set yet</span>'}${b.description ? `<br><span class="desc">${esc(b.description)}</span>` : ''}${b.status ? `<br><span class="lbl">Status:</span> ${esc(b.status)}` : ''}</p>
<p class="muted">Last updated: ${b.updated_at ? `${esc(fmtDate(b.updated_at))} by ${esc(b.updated_by)}` : 'never'} · ${b.tx_count} transaction${b.tx_count === 1 ? '' : 's'}</p>
${await progressSnippet(env, ai)}
${lim.html}
<p class="muted">Clients write to <code>${esc(plusAddr(ai))}</code> · Emails sent today: <b>${await sentToday(env, ai)}</b> / ${DAILY_LIMIT}</p>
<div class="row"><a class="btn" href="/admin/money/${ai}">Details &amp; edit</a><a class="btn grey" href="/admin/emails#ai-${ai}">Go to connections</a></div></div>`);
  }
  return adminShell('overview', session, `<h1 class="pt">Overview</h1><div class="stack">${blocks.join('')}</div>`, notice);
}

async function moneyPage(env, origin, session, ai, notice = '') {
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
  const st = statsView(ai, await getBiz(env, ai));
  const tx = await listTransactions(env, ai, { max: 100 });
  const hid = (action) => `${csrf}<input type="hidden" name="action" value="${action}"><input type="hidden" name="ai" value="${ai}">`;
  const rows = tx.transactions.map((t) => `<tr><td colspan="5"><form method="post" action="/admin/action" class="txrow">${hid('tx_edit')}<input type="hidden" name="tx_id" value="${esc(t.id)}">
<input type="text" name="date" value="${esc(t.date)}" aria-label="Date" class="w-date">
<select name="type" aria-label="Type"><option value="earned"${t.type === 'earned' ? ' selected' : ''}>earned</option><option value="spent"${t.type === 'spent' ? ' selected' : ''}>spent</option></select>
<input type="text" name="amount" value="${esc(t.amount_zar.toFixed(2))}" aria-label="Amount (R)" class="w-amt">
<input type="text" name="description" value="${esc(t.description)}" maxlength="200" aria-label="Description" class="w-desc">
<button type="submit">Save</button></form>
<form method="post" action="/admin/action" class="inline">${hid('tx_delete')}<input type="hidden" name="tx_id" value="${esc(t.id)}"><button class="red" type="submit">Delete</button></form>
<div class="muted">Logged ${esc(t.logged_at)} by ${esc(t.logged_by)}${t.edited_by_admin ? ' · edited by Johan' : ''}</div></td></tr>`).join('');
  const body = `<p><a href="/admin#block-${ai}">← Back to Overview</a></p><h1 class="pt">${esc(AIS[ai].name)}: money, business &amp; progress</h1><p><a href="#progress">Jump to progress ↓</a></p>
<div class="card"><div class="money"><div><span>Money Earned</span><b>${esc(st.money_earned)}</b></div><div><span>Money Spent</span><b>${esc(st.money_spent)}</b></div><div><span>Net / Profit</span><b>${esc(st.net_profit)}</b></div></div>
<p class="muted">Last updated: ${esc(st.last_updated || 'never')}${st.last_updated_by ? ' by ' + esc(st.last_updated_by) : ''}</p></div>
<div class="card"><h2>Transactions (newest first)</h2>${rows ? `<table>${rows}</table>` : '<p class="muted">No transactions yet.</p>'}
<details><summary>Add a transaction for ${esc(AIS[ai].name)}</summary><form method="post" action="/admin/action">${hid('tx_add')}
<label>Type</label><select name="type"><option value="earned">earned</option><option value="spent">spent</option></select>
<label>Amount (R)</label><input type="text" name="amount" required><label>Description</label><input type="text" name="description" maxlength="200" required>
<label>Date (optional, YYYY-MM-DD)</label><input type="text" name="date"><button type="submit">Add</button></form></details></div>
<div class="card"><h2>Business details</h2><form method="post" action="/admin/action">${hid('biz_edit')}
<label for="bn">Business name</label><input id="bn" type="text" name="name" maxlength="80" value="${esc(st.business.name)}">
<label for="bd">Description</label><textarea id="bd" name="description" maxlength="1000" style="min-height:90px">${esc(st.business.description)}</textarea>
<label for="bs">Status note</label><input id="bs" type="text" name="status_note" maxlength="500" value="${esc(st.business.status_note)}">
<button type="submit">Save business</button></form></div>`;
  const p = await getProg(env, ai);
  const opt = (cur) => ['todo', 'doing', 'done'].map((x) => `<option value="${x}"${x === cur ? ' selected' : ''}>${x}</option>`).join('');
  const taskRows = p.tasks.map((t) => `<div style="margin:6px 0"><form method="post" action="/admin/action" class="txrow">${hid('task_edit')}<input type="hidden" name="task_id" value="${esc(t.id)}">
<span class="muted">${esc(t.id)}</span><select name="status" aria-label="Status">${opt(t.status)}</select><input type="text" name="text" value="${esc(t.text)}" maxlength="300" class="w-desc" aria-label="Task"><button type="submit">Save</button></form>
<form method="post" action="/admin/action" class="inline">${hid('task_delete')}<input type="hidden" name="task_id" value="${esc(t.id)}"><button class="red" type="submit">Delete</button></form></div>`).join('');
  const notes = p.notes.slice(-50).reverse().map((n) => `<div class="card" style="margin:8px 0;box-shadow:none;border:1px solid #e5e8eb"><span class="muted">${esc(fmtDate(n.ts))} · ${esc(n.by)}</span>
<form method="post" action="/admin/action" class="inline" style="float:right">${hid('note_delete')}<input type="hidden" name="note_ts" value="${esc(String(n.ts))}"><button class="red" type="submit">Delete</button></form>
<div>${esc(n.text).replace(/\n/g, '<br>')}</div></div>`).join('');
  const progressHtml = `<h2 style="margin:18px 4px 6px" id="progress">Progress (saved memory)</h2>
<div class="card"><h2>Current focus &amp; note</h2><form method="post" action="/admin/action">${hid('prog_save')}
<label for="pf">Current focus</label><input id="pf" type="text" name="current_focus" maxlength="500" value="${esc(p.focus)}">
<label for="pn">Add a note (optional)</label><textarea id="pn" name="note" maxlength="2000" style="min-height:80px"></textarea>
<button type="submit">Save</button></form><p class="muted">Last saved: ${p.updated_at ? `${esc(fmtDate(p.updated_at))} by ${esc(p.updated_by)}` : 'never'}</p></div>
<div class="card"><h2>Tasks (in order)</h2>${taskRows || '<p class="muted">No tasks yet.</p>'}
<form method="post" action="/admin/action">${hid('task_add')}<label for="nt">New task</label><input id="nt" type="text" name="text" maxlength="300" required><button type="submit">Add task</button></form></div>
<div class="card"><h2>Notes (newest first, last 50 of ${p.notes.length})</h2>${notes || '<p class="muted">No notes yet.</p>'}</div>`;
  return adminShell('overview', session, body + progressHtml, notice);
}

async function emailsPage(env, origin, session, notice = '') {
  const csrf = `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`;
  const btn = (action, label, cls, ai) => `<form method="post" action="/admin/action" class="inline">${csrf}<input type="hidden" name="action" value="${action}"><input type="hidden" name="ai" value="${ai}"><button class="${cls}" type="submit">${esc(label)}</button></form>`;
  const field = (id, label, value) => `<label for="${id}">${label}</label><div class="copyrow"><input id="${id}" type="text" readonly value="${esc(value)}"><button type="button" class="copy" data-copy="${id}">Copy</button></div>`;
  const cards = [];
  for (const ai of AI_IDS) {
    const rec = await env.KV.get('key:' + ai, 'json');
    const active = !!(rec && rec.hash);
    let key = null;
    if (active) { try { key = await revealKey(env, ai); } catch { key = null; } }
    const c = connectorText(ai, origin, key);
    const n = await sentToday(env, ai);
    const body = key
      ? `${field(`mcp_${ai}`, 'Connector link (MCP)', c.mcp)}${field(`key_${ai}`, 'Key', key)}${field(`web_${ai}`, 'Web page link', c.web)}${field(`help_${ai}`, 'Help link (plain text, for reading)', c.txt)}
<p><a class="btn" href="${esc(c.web)}" target="_blank" rel="noopener noreferrer">Open web page</a></p>`
      : `<div class="warn">${rec && rec.revoked ? 'Key revoked.' : 'No key yet.'} Click <b>Make a key</b> to create this AI's links.</div>`;
    cards.push(`<div class="card" id="ai-${ai}"><h2>${esc(AIS[ai].name)}</h2>
<p>Clients write to: <code>${esc(plusAddr(ai))}</code><br>Sent today: ${n}/${DAILY_LIMIT}${active ? ` · key active since ${esc(fmtDate(rec.created))}` : ''}</p>
${body}
<h3>How to connect</h3>${HOWTO[ai].replace('{ORIGIN}', esc(origin))}
<h3>Custom instructions (paste into ${esc(AIS[ai].name)}'s settings so it continues by itself)</h3>
<div class="copyrow"><textarea id="instr_${ai}" class="prompt" readonly>${esc(ai === 'copilot' ? PROMPTS.copilot : PROMPTS.instructions)}</textarea><button type="button" class="copy" data-copy="instr_${ai}">Copy</button></div>
${ai === 'chatgpt' ? `<h3>ChatGPT Scheduled task prompt</h3><p class="muted">In ChatGPT, open a chat with Live HQ turned on and ask it to schedule this daily or hourly (or use Tasks / Schedules if your plan has it).</p>
<div class="copyrow"><textarea id="sched_${ai}" class="prompt" readonly>${esc(PROMPTS.scheduled)}</textarea><button type="button" class="copy" data-copy="sched_${ai}">Copy</button></div>` : ''}
<div class="row">${btn('rotate_key', active ? 'Make a new key (old one stops working)' : 'Make a key', 'grey', ai)}${active ? btn('revoke_key', 'Revoke key', 'red', ai) : ''}</div></div>`);
  }
  const intro = `<h1 class="pt">Emails</h1><div class="card warn"><b>Private.</b> These links and keys open each AI's mailbox. Only paste them into that AI's own settings. If one leaks, click <b>Make a new key</b>.</div>`;
  return adminShell('emails', session, intro + cards.join(''), notice);
}

const NOTICES = {
  unpublished: '<div class="card ok">App unpublished.</div>',
  connected: '<div class="card ok">Gmail is connected. The AIs can use their mail now.</div>',
  disconnected: '<div class="card warn">Gmail is disconnected.</div>',
  saved: '<div class="card ok">Saved.</div>',
  client_saved: '<div class="card ok">Google login key saved. Now click Connect Gmail.</div>',
  revoked: '<div class="card warn">Key revoked. That AI can no longer get in.</div>',
  tx_deleted: '<div class="card warn">Transaction deleted. The totals were updated.</div>',
  rotated: '<div class="card ok">New key made. The old key for this AI has stopped working, so update that AI\'s connector with the new link.</div>',
};

export async function handleAdmin(req, env, url, path) {
  const origin = url.origin;
  // Login
  if (path === '/admin/login' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const fk = 'loginfail:' + (await sha256Hex(ip)).slice(0, 24);
    const fails = parseInt((await env.KV.get(fk)) || '0', 10);
    if (fails >= 10) return html(loginPage('Too many wrong tries. Wait 15 minutes and try again.'), 429);
    const form = await req.formData().catch(() => null);
    const pw = form ? String(form.get('password') || '') : '';
    const ok = safeEqual(await sha256Hex(pw), await sha256Hex(env.ADMIN_PASSWORD || randomToken()));
    if (!ok) {
      await env.KV.put(fk, String(fails + 1), { expirationTtl: 900 });
      return html(loginPage('Wrong password.'), 401);
    }
    const sid = randomToken(32);
    await env.KV.put('sess:' + (await sha256Hex(sid)), JSON.stringify({ csrf: randomToken(24), created: Date.now() }), { expirationTtl: SESSION_TTL });
    return redirect('/admin', { 'set-cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}` });
  }

  const session = await getSession(req, env);
  const PAGES = { '/admin': overviewPage, '/admin/emails': emailsPage, '/admin/gmail': gmailPage, '/admin/settings': settingsPage, '/admin/apps': appsPage };
  const mp = path.match(/^\/admin\/money\/([a-z]+)$/);
  if (mp && AIS[mp[1]] && req.method === 'GET') {
    if (!session) return redirect('/admin');
    const n = url.searchParams.get('msg');
    const err = url.searchParams.get('err');
    const notice = err ? `<div class="card bad">${esc(err.slice(0, 300))}</div>` : NOTICES[n] || '';
    return html(await moneyPage(env, origin, session, mp[1], notice));
  }
  if (PAGES[path] && req.method === 'GET') {
    if (!session) return path === '/admin' ? html(loginPage()) : redirect('/admin');
    const n = url.searchParams.get('msg');
    let notice = NOTICES[n] || '';
    const err = url.searchParams.get('err');
    if (err) notice = `<div class="card bad">${esc(err.slice(0, 300))}</div>`;
    return html(await PAGES[path](env, origin, session, notice));
  }
  if (!session) return path === '/admin' ? html(loginPage()) : redirect('/admin');

  if (req.method !== 'POST') return redirect('/admin');
  const form = await req.formData().catch(() => null);
  if (!form || !safeEqual(String(form.get('csrf') || ''), session.csrf)) return html(page('Live HQ', '<div class="card bad">This form is too old. Go back to <a href="/admin">the admin page</a> and try again.</div>'), 403);

  if (path === '/admin/logout') {
    await env.KV.delete('sess:' + session.sidHash);
    return redirect('/admin', { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }
  if (path !== '/admin/action') return redirect('/admin');
  const action = String(form.get('action') || '');
  const ai = String(form.get('ai') || '');
  const wantsJson = (req.headers.get('accept') || '').includes('application/json');

  if (['show_key', 'rotate_key', 'revoke_key'].includes(action)) {
    if (!AIS[ai]) return redirect('/admin');
    if (action === 'revoke_key') {
      await env.KV.put('key:' + ai, JSON.stringify({ revoked: true, at: Date.now() }));
      return redirect('/admin/emails?msg=revoked#ai-' + ai);
    }
    const key = action === 'rotate_key' ? await newKey(env, ai) : await revealKey(env, ai);
    if (!key) return redirect('/admin/emails');
    if (wantsJson) return new Response(JSON.stringify({ ai, key }), { headers: { 'content-type': 'application/json' } });
    return redirect(`/admin/emails${action === 'rotate_key' ? '?msg=rotated' : ''}#ai-${ai}`);
  }
  if (action === 'app_unpublish') {
    try { await unpublishApp(env, null, 'admin', form.get('slug')); } catch (e) { return redirect('/admin/apps?err=' + encodeURIComponent(e instanceof AppError ? e.message : 'Could not unpublish.')); }
    return redirect('/admin/apps?msg=unpublished');
  }
  if (action === 'limit_set' || action === 'limit_clear') {
    if (!AIS[ai]) return redirect('/admin');
    try {
      if (action === 'limit_clear') await clearLimit(env, ai);
      else {
        let ra = String(form.get('resets_at') || '').trim();
        if (ra && /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(ra)) ra = ra.replace(' ', 'T') + ':00+02:00'; // typed in SAST
        await reportLimit(env, ai, 'admin', ra ? { resets_at: ra } : { hours_until_reset: form.get('hours') });
      }
    } catch (e) {
      return redirect('/admin?err=' + encodeURIComponent(e instanceof AppError ? e.message : 'Could not save that.') + '#block-' + ai);
    }
    return redirect('/admin#block-' + ai);
  }
  if (['prog_save', 'task_add', 'task_edit', 'task_delete', 'note_delete'].includes(action)) {
    if (!AIS[ai]) return redirect('/admin');
    const back = `/admin/money/${ai}`;
    const f = (k) => (form.has(k) ? String(form.get(k)) : undefined);
    try {
      if (action === 'prog_save') await saveProgress(env, ai, 'admin', { current_focus: f('current_focus'), note: f('note') || undefined });
      else if (action === 'task_add') await addTask(env, ai, 'admin', { text: f('text') });
      else if (action === 'task_edit') await updateTask(env, ai, 'admin', { task_id: f('task_id'), status: f('status'), text: f('text') });
      else if (action === 'task_delete') await adminDeleteTask(env, ai, f('task_id'));
      else await adminDeleteNote(env, ai, f('note_ts'));
    } catch (e) {
      return redirect(back + '?err=' + encodeURIComponent(e instanceof AppError ? e.message : 'Could not save that.') + '#progress');
    }
    return redirect(back + '?msg=saved#progress');
  }
  if (['tx_edit', 'tx_delete', 'tx_add', 'biz_edit'].includes(action)) {
    if (!AIS[ai]) return redirect('/admin');
    const back = `/admin/money/${ai}`;
    try {
      const f = (k) => (form.has(k) ? String(form.get(k)) : undefined);
      if (action === 'tx_edit') await adminEditTx(env, ai, f('tx_id'), { type: f('type'), amount: f('amount'), description: f('description'), date: f('date') });
      else if (action === 'tx_delete') await adminDeleteTx(env, ai, f('tx_id'));
      else if (action === 'tx_add') await logMoney(env, ai, 'admin', { type: f('type'), amount_zar: f('amount'), description: f('description'), date: f('date') || undefined });
      else await updateBusiness(env, ai, 'admin', { name: f('name'), description: f('description'), status_note: f('status_note') });
    } catch (e) {
      return redirect(back + '?err=' + encodeURIComponent(e instanceof AppError ? e.message : 'Could not save that.'));
    }
    return redirect(back + '?msg=' + (action === 'tx_delete' ? 'tx_deleted' : 'saved'));
  }
  if (action === 'save_settings') {
    const s = await getSettings(env);
    const display = {};
    for (const x of AI_IDS) {
      const v = String(form.get('display_' + x) || '').replace(/[\r\n\0"<>]/g, '').trim().slice(0, 80);
      display[x] = v || s.display[x];
    }
    await saveSettings(env, { display, sending_enabled: form.get('sending_enabled') === '1', reply_to_plus: form.get('reply_to_plus') === '1' });
    return redirect('/admin/settings?msg=saved');
  }
  if (action === 'save_google_client') {
    const id = String(form.get('client_id') || '').trim();
    const secret = String(form.get('client_secret') || '').trim();
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id) || secret.length < 10 || secret.length > 200 || /\s/.test(secret)) {
      return redirect('/admin/gmail?err=' + encodeURIComponent('That Client ID or secret does not look right. The Client ID ends with .apps.googleusercontent.com.'));
    }
    await env.KV.put('google:client', await encryptStr(env, JSON.stringify({ id, secret })));
    return redirect('/admin/gmail?msg=client_saved');
  }
  if (action === 'connect_gmail') {
    const client = await getGoogleClient(env);
    if (!client) return redirect('/admin/gmail?err=' + encodeURIComponent('Set the Google Client ID and secret first.'));
    const state = randomToken(24);
    await env.KV.put('oauth:' + state, JSON.stringify({ sidHash: session.sidHash }), { expirationTtl: 600 });
    const p = new URLSearchParams({ client_id: client.id, redirect_uri: redirectUri(origin), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state, login_hint: ACCOUNT });
    return redirect(`${AUTH_URL}?${p}`);
  }
  if (action === 'disconnect_gmail') {
    const rtEnc = await env.KV.get('gmail:rt');
    if (rtEnc) {
      try { const rt = await decryptStr(env, rtEnc); await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt }) }); } catch { /* ignore */ }
    }
    await Promise.all(['gmail:rt', 'gmail:at', 'labels'].map((k) => env.KV.delete(k)));
    await env.KV.put('gmail:state', JSON.stringify({ state: 'not_connected', at: Date.now() }));
    return redirect('/admin/gmail?msg=disconnected');
  }
  return redirect('/admin');
}

export async function handleOAuthCallback(req, env, url) {
  const session = await getSession(req, env);
  const fail = (m) => redirect('/admin/gmail?err=' + encodeURIComponent(m));
  if (!session) return html(page('Live HQ', '<div class="card bad">Please sign in to the admin page first, then click Connect Gmail again. <a href="/admin">Admin page</a></div>'), 401);
  const state = url.searchParams.get('state') || '';
  const saved = /^[A-Za-z0-9_-]{20,64}$/.test(state) ? await env.KV.get('oauth:' + state, 'json') : null;
  if (saved) await env.KV.delete('oauth:' + state);
  if (!saved || !safeEqual(saved.sidHash, session.sidHash)) return fail('The Google sign-in link was too old or not valid. Click Connect Gmail again.');
  if (url.searchParams.get('error')) return fail('Google said: ' + String(url.searchParams.get('error')).slice(0, 80) + '. Nothing was changed.');
  const code = url.searchParams.get('code');
  if (!code) return fail('Google did not send a code. Try again.');
  const client = await getGoogleClient(env);
  if (!client) return fail('The Google login key is missing.');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri(url.origin), grant_type: 'authorization_code' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return fail('Google would not finish the sign-in (' + String(j.error || r.status).slice(0, 60) + '). Check the Client ID, secret and redirect URI.');
  const granted = String(j.scope || '').split(' ');
  if (!SCOPES.every((s) => granted.includes(s))) return fail('Please tick ALL the Gmail boxes on the Google screen, then try again.');
  const revoke = async () => {
    try { await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: j.refresh_token || j.access_token }) }); } catch { /* ignore */ }
  };
  const pr = await fetch(GMAIL + '/profile', { headers: { authorization: 'Bearer ' + j.access_token } });
  const prof = await pr.json().catch(() => ({}));
  if (!pr.ok) {
    await revoke();
    const gm = String((prof && prof.error && (prof.error.message || prof.error.status)) || '').replace(/\s+/g, ' ').trim();
    const reasons = JSON.stringify((prof && prof.error && prof.error.details) || []);
    if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(gm + ' ' + reasons)) {
      return fail('The Gmail API is switched off in your Google Cloud project. Enable it at console.cloud.google.com/apis/library/gmail.googleapis.com, wait a minute, then click Connect Gmail again.');
    }
    return fail('Google would not let the hub read the mailbox (' + pr.status + ': ' + (gm || 'no details').slice(0, 100) + ')');
  }
  const seen = String(prof.emailAddress || '').toLowerCase();
  if (seen !== ACCOUNT) {
    await revoke();
    return fail(`You signed in with a different Google account (${seen.slice(0, 100) || 'unknown'}). Please choose ${ACCOUNT}.`);
  }
  if (!j.refresh_token) return fail('Google did not give a long-term key. Go to myaccount.google.com/permissions, remove the app (it may be called "Live HQ" or "AI Mail Hub"), then click Connect Gmail again.');
  await env.KV.put('gmail:rt', await encryptStr(env, j.refresh_token));
  await env.KV.put('gmail:at', await encryptStr(env, JSON.stringify({ token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 })), { expirationTtl: Math.max(60, (Number(j.expires_in) || 3600) - 60) });
  await env.KV.delete('labels');
  await env.KV.put('gmail:state', JSON.stringify({ state: 'connected', email: ACCOUNT, at: Date.now() }));
  return redirect('/admin/gmail?msg=connected');
}
