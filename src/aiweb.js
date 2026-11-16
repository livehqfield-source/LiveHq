// Private web page + plain-text links for each AI.
import { AIS, ACCOUNT, DAILY_LIMIT, AppError, plusAddr, listMail, readEmail, sendMail, authAI, getSettings, sentToday, hmac, safeEqual } from './core.js';
import { esc, page } from './html.js';
import { UPDATE_LIMIT, getStats, updateBusiness, logMoney, listTransactions } from './money.js';
import { PROGRESS_LIMIT, getProgress, getProg, saveProgress, addTask, updateTask } from './progress.js';

async function formToken(env, ai, keyHash, dayOffset = 0) {
  const day = Math.floor(Date.now() / 86400e3) - dayOffset;
  return hmac(env.SESSION_SECRET, `aiform:${ai}:${keyHash}:${day}`);
}
async function checkFormToken(env, ai, keyHash, t) {
  for (const off of [0, 1]) if (safeEqual(t, await formToken(env, ai, keyHash, off))) return true;
  return false;
}
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const text = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

function listHtml(ai, key, res, origin) {
  if (!res.messages.length) return '<p class="muted">No emails here yet.</p>';
  return res.messages.map((m) => `<a class="mail${m.unread ? ' unread' : ''}" href="/ai/${ai}/msg/${esc(m.id)}?key=${encodeURIComponent(key)}"><b>${esc(m.subject)}</b><br><small>${esc(res.mailbox === 'sent' ? 'To: ' + m.to : 'From: ' + m.from)} · ${esc(m.date)}</small><br><small>${esc(m.snippet.slice(0, 140))}</small></a>`).join('');
}
function listText(ai, key, res, origin) {
  const lines = [`${res.mailbox.toUpperCase()} — ${res.count} email(s)`, ''];
  res.messages.forEach((m, i) => {
    lines.push(`${i + 1}. ${m.subject}`);
    lines.push(`   ${res.mailbox === 'sent' ? 'To: ' + m.to : 'From: ' + m.from}`);
    lines.push(`   Date: ${m.date}${m.unread ? '  (unread)' : ''}`);
    lines.push(`   Preview: ${m.snippet.slice(0, 200)}`);
    lines.push(`   Read it: ${origin}/ai/${ai}/msg/${m.id}.txt?key=${encodeURIComponent(key)}`);
    lines.push('');
  });
  if (res.next_page_token) lines.push(`Older emails: ${origin}/ai/${ai}/${res.mailbox === 'search' ? 'search' : res.mailbox}.txt?key=${encodeURIComponent(key)}&page=${encodeURIComponent(res.next_page_token)}${res.query ? '&q=' + encodeURIComponent(res.query) : ''}`);
  return lines.join('\n');
}
function msgText(r) {
  const out = [];
  const one = (m) => [`From: ${m.from}`, `To: ${m.to}`, m.cc ? `Cc: ${m.cc}` : null, `Date: ${m.date}`, `Subject: ${m.subject}`, `Message id: ${m.id}`, m.attachments.length ? `Attachments: ${m.attachments.join(', ')}` : null, '', m.body].filter((x) => x !== null).join('\n');
  out.push(one(r.message));
  const others = (r.thread || []).filter((m) => m.id !== r.message.id);
  if (others.length) { out.push('\n\n===== Whole conversation (oldest first) ====='); for (const m of r.thread) out.push('\n----------\n' + one(m)); }
  return out.join('\n');
}

export async function handleAiWeb(req, env, url, parts) {
  const ai = parts[1];
  if (!AIS[ai]) return text('Not found', 404);
  const origin = url.origin;
  const isPost = req.method === 'POST';
  let form = null, key;
  if (isPost) {
    form = await req.formData().catch(() => null);
    key = form && form.get('key');
  } else key = url.searchParams.get('key');
  const who = await authAI(env, typeof key === 'string' ? key : '', ai);
  const sub = parts.slice(2).join('/');
  const wantsText = sub.endsWith('.txt');
  if (!who) return wantsText ? text('Wrong or missing key. Ask Johan for your private link.', 401) : html(page('Live HQ', '<div class="card bad">Wrong or missing key. Ask Johan for your private link.</div>'), 401);
  const k = encodeURIComponent(key);
  const settings = await getSettings(env);
  const sentN = await sentToday(env, ai);
  const name = AIS[ai].name;
  const subtitle = `Clients write to ${plusAddr(ai)} · sends as "${settings.display[ai]}" <${ACCOUNT}> · sent today ${sentN}/${DAILY_LIMIT}`;
  const token = await formToken(env, ai, who.keyHash);

  try {
    // ---- plain text links (read only) ----
    if (wantsText) {
      const pg = url.searchParams.get('page') || undefined;
      const max = url.searchParams.get('max') || 15;
      if (sub === 'inbox.txt') return text(listText(ai, key, await listMail(env, ai, 'inbox', { max, pageToken: pg }), origin));
      if (sub === 'sent.txt') return text(listText(ai, key, await listMail(env, ai, 'sent', { max, pageToken: pg }), origin));
      if (sub === 'search.txt') {
        const q = url.searchParams.get('q');
        if (!q) return text('Add &q=your+search+words to the link.', 400);
        return text(listText(ai, key, await listMail(env, ai, 'all', { max, pageToken: pg, q }), origin));
      }
      const mt = sub.match(/^msg\/([A-Za-z0-9_-]{1,64})\.txt$/);
      if (mt) return text(msgText(await readEmail(env, ai, mt[1], true)));
      if (sub === 'stats.txt') {
        const st = await getStats(env, ai);
        const tx = await listTransactions(env, ai, { max: 20 });
        return text([`${name}: AI Million Challenge`, `Business: ${st.business.name || '(not set)'}`, `Description: ${st.business.description || '(not set)'}`, `Status: ${st.business.status_note || '(none)'}`,
          `Money earned: ${st.money_earned}`, `Money spent: ${st.money_spent}`, `Net profit: ${st.net_profit}`, `Last updated: ${st.last_updated || 'never'}${st.last_updated_by ? ' by ' + st.last_updated_by : ''}`, '',
          'Latest transactions:', ...(tx.transactions.length ? tx.transactions.map((t) => `- ${t.date} ${t.type.toUpperCase()} ${t.amount}: ${t.description}`) : ['(none yet)'])].join('\n'));
      }
      if (sub === 'progress.txt') {
        const pr = await getProgress(env, ai);
        return text([`${name}: saved progress`, `Current focus: ${pr.current_focus || '(not set)'}`, '', 'Open tasks (do the first one next):',
          ...(pr.open_tasks.length ? pr.open_tasks.map((t, i) => `${i + 1}. [${t.status}] ${t.text}  (id ${t.id})`) : ['(none)']), '',
          'Latest notes:', ...(pr.recent_notes.length ? pr.recent_notes.map((n) => `- ${n.at} (${n.by}): ${n.text}`) : ['(none)']), '',
          `Last saved: ${pr.last_saved || 'never'}`].join('\n'));
      }
      if (sub === 'help.txt') return text([
        'START OF EVERY CHAT: read your saved progress and stats first, then continue the first open task yourself. Do not wait for Johan to tell you.',
        `Progress: ${origin}/ai/${ai}/progress.txt?key=${k}`,
        `Stats:    ${origin}/ai/${ai}/stats.txt?key=${k}`,
        'Before ending a reply, or when your usage limit may be near, save your progress (save_progress tool, or the Progress tab on your web page).', '',
        `Hello ${name}. This is your private mailbox in Live HQ.`,
        `Clients write to you at: ${plusAddr(ai)} (give clients this address).`,
        `Your emails are sent from ${ACCOUNT} with the name "${settings.display[ai]}".`, '',
        `Read your inbox:  ${origin}/ai/${ai}/inbox.txt?key=${k}`,
        `Read your sent:   ${origin}/ai/${ai}/sent.txt?key=${k}`,
        `Search:           ${origin}/ai/${ai}/search.txt?key=${k}&q=WORDS`,
        `Read one email:   ${origin}/ai/${ai}/msg/MESSAGE_ID.txt?key=${k}`, '',
        'Sending: links can never send email. To send, use the form on your web page:',
        `${origin}/ai/${ai}?key=${k}`,
        'or ask Johan to paste your email text into that form.', '',
        'AI Million Challenge scoreboard (money in rand, ZAR):',
        `Read your stats:  ${origin}/ai/${ai}/stats.txt?key=${k}`,
        `To update your business or log money earned/spent, use the "Business & money" tab on your web page:`,
        `${origin}/ai/${ai}?key=${k}&view=money`,
        'or, with a connector, the tools update_business, log_money, get_my_stats and list_my_transactions.',
        `Only log real money. Max ${UPDATE_LIMIT} updates per day.`, '',
        'Saving progress (so you can continue after your usage limit resets):',
        `Use the "Progress" tab: ${origin}/ai/${ai}?key=${k}&view=progress`,
        'or, with a connector, the tools get_my_progress, save_progress, add_task, update_task and list_tasks.',
        `Max ${PROGRESS_LIMIT} progress saves per day.`, '',
        'Publishing a web app on the Live HQ site (connector AIs only):',
        'Use publish_app with slug (kebab-case), title and html = ONE complete self-contained HTML file (max 1 MB).',
        'CSS/JS inline; libraries from cdnjs, unpkg, jsdelivr, cdn.tailwindcss.com or esm.sh. Wrap React/JSX with React + Babel standalone from a CDN.',
        'The app runs in a sandbox: no localStorage, cookies or calls to other servers. It appears at ' + origin + '/apps/<slug>. list_my_apps / unpublish_app manage it. Max 30 publishes per day.',
      ].join('\n'));
      return text('Not found', 404);
    }

    // ---- form POSTs (the only way to send from the web page) ----
    if (isPost) {
      if (!(await checkFormToken(env, ai, who.keyHash, String(form.get('csrf') || '')))) return html(page('Live HQ', '<div class="card bad">This form is too old or not valid. Go back, reload the page and try again.</div>'), 403);
      if (sub === 'progress') {
        let msg;
        try {
          const op = String(form.get('op') || '');
          const g = (f) => (form.has(f) ? String(form.get(f)) : undefined);
          if (op === 'save') await saveProgress(env, ai, 'web', { current_focus: g('current_focus'), note: g('note') || undefined });
          else if (op === 'add_task') await addTask(env, ai, 'web', { text: g('text') });
          else if (op === 'update_task') await updateTask(env, ai, 'web', { task_id: g('task_id'), status: g('status'), text: g('text') || undefined });
          else throw new AppError(400, 'Unknown action.');
          msg = '<div class="ok"><b>Progress saved.</b></div>';
        } catch (e) {
          msg = `<div class="bad"><b>Not saved.</b> ${esc(e instanceof AppError ? e.message : 'Something went wrong on the server.')}</div>`;
        }
        return html(page(`${name}: mail`, `<div class="card">${msg}<p><a class="btn" href="/ai/${ai}?key=${k}&view=progress">Back to Progress</a></p></div>`, subtitle));
      }
      if (sub === 'money' || sub === 'business') {
        let msg;
        try {
          if (sub === 'money') {
            const r = await logMoney(env, ai, 'web', { type: form.get('type'), amount_zar: form.get('amount_zar'), description: form.get('description'), date: form.get('date') || undefined });
            msg = `<div class="ok"><b>Saved.</b> ${esc(r.transaction.type === 'earned' ? 'Earned' : 'Spent')} ${esc(r.transaction.amount)}: ${esc(r.transaction.description)}. Net profit now ${esc(r.totals.net_profit)}.</div>`;
          } else {
            const pick = (f) => (form.has(f) ? String(form.get(f)) : undefined);
            await updateBusiness(env, ai, 'web', { name: pick('name'), description: pick('description'), status_note: pick('status_note') });
            msg = '<div class="ok"><b>Business details saved.</b></div>';
          }
        } catch (e) {
          msg = `<div class="bad"><b>Not saved.</b> ${esc(e instanceof AppError ? e.message : 'Something went wrong on the server.')}</div>`;
        }
        return html(page(`${name}: mail`, `<div class="card">${msg}<p><a class="btn" href="/ai/${ai}?key=${k}&view=money">Back to Business &amp; money</a></p></div>`, subtitle));
      }
      if (sub !== 'send' && sub !== 'reply') return text('Not found', 404);
      const args = Object.fromEntries(['to', 'cc', 'subject', 'body', 'message_id', 'reply_all', 'dry_run'].map((f) => [f, form.get(f) ?? undefined]));
      let msg;
      try {
        const r = await sendMail(env, ai, 'web', args, sub === 'reply');
        msg = r.dry_run ? `<div class="warn"><b>Test only, nothing was sent.</b><pre class="mono">${esc(JSON.stringify(r.would_send, null, 2))}</pre></div>` : `<div class="ok"><b>Sent.</b> To: ${esc(r.to.join(', '))} — subject: ${esc(r.subject)}. Sent today: ${r.sent_today}/${DAILY_LIMIT}.</div>`;
      } catch (e) {
        msg = `<div class="bad"><b>Not sent.</b> ${esc(e instanceof AppError ? e.message : 'Something went wrong on the server.')}</div>`;
      }
      return html(page(`${name} — mail`, `<div class="card">${msg}<p><a class="btn" href="/ai/${ai}?key=${k}">Back to my mail</a></p></div>`, subtitle));
    }

    // ---- one message ----
    const mm = sub.match(/^msg\/([A-Za-z0-9_-]{1,64})$/);
    if (mm) {
      const r = await readEmail(env, ai, mm[1], true);
      const thread = (r.thread && r.thread.length ? r.thread : [r.message]).map((m) => `<div class="card"><div class="muted">From: ${esc(m.from)}<br>To: ${esc(m.to)}${m.cc ? '<br>Cc: ' + esc(m.cc) : ''}<br>${esc(m.date)}</div><h3>${esc(m.subject)}</h3><pre class="body">${esc(m.body)}</pre>${m.attachments.length ? `<p class="muted">Attachments: ${esc(m.attachments.join(', '))}</p>` : ''}</div>`).join('');
      return html(page(`${name} — mail`, `<p><a href="/ai/${ai}?key=${k}">← Back</a> · <a href="/ai/${ai}/msg/${esc(mm[1])}.txt?key=${k}">plain text</a></p>${thread}
<div class="card"><h2>Reply</h2><form method="post" action="/ai/${ai}/reply">
<input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="csrf" value="${esc(token)}"><input type="hidden" name="message_id" value="${esc(mm[1])}">
<label for="b">Your reply</label><textarea id="b" name="body" required></textarea>
<label><input type="checkbox" name="reply_all" value="true"> Reply to everyone</label>
<label><input type="checkbox" name="dry_run" value="true"> Test only (do not really send)</label>
<button type="submit">Send reply</button></form></div>`, subtitle));
    }

    // ---- main page ----
    if (sub === '') {
      const VIEWS = ['inbox', 'sent', 'search', 'compose', 'money', 'progress'];
      const view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'inbox';
      const tabs = `<div class="tabs">${VIEWS.map((v) => `<a class="${v === view ? 'on' : ''}" href="/ai/${ai}?key=${k}&view=${v}">${{ inbox: 'Inbox', sent: 'Sent', search: 'Search', compose: 'New email', money: 'Business &amp; money', progress: 'Progress' }[v]}</a>`).join('')}</div>`;
      let bodyHtml = '';
      if (view === 'progress') {
        const pr = await getProgress(env, ai);
        const all = (await getProg(env, ai)).tasks;
        const hidden = `<input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="csrf" value="${esc(token)}">`;
        const opt = (cur) => ['todo', 'doing', 'done'].map((x) => `<option value="${x}"${x === cur ? ' selected' : ''}>${x}</option>`).join('');
        bodyHtml = `<div class="card"><h2>Current focus</h2><form method="post" action="/ai/${ai}/progress">${hidden}<input type="hidden" name="op" value="save">
<label for="cf">What is ${esc(name)} working on now?</label><input id="cf" type="text" name="current_focus" maxlength="500" value="${esc(pr.current_focus || '')}">
<label for="nt">Add a note (optional)</label><textarea id="nt" name="note" maxlength="2000" style="min-height:90px"></textarea>
<button type="submit">Save progress</button></form><p class="muted">Last saved: ${esc(pr.last_saved || 'never')}${pr.last_saved_by ? ' by ' + esc(pr.last_saved_by) : ''} · saves today ${pr.saves_today}/${PROGRESS_LIMIT}</p></div>
<div class="card"><h2>Tasks (in order)</h2>${all.length ? all.map((t) => `<form method="post" action="/ai/${ai}/progress" class="txrow" style="margin:6px 0">${hidden}<input type="hidden" name="op" value="update_task"><input type="hidden" name="task_id" value="${esc(t.id)}">
<select name="status">${opt(t.status)}</select><input type="text" name="text" value="${esc(t.text)}" maxlength="300" style="flex:1;min-width:160px"><button type="submit">Save</button></form>`).join('') : '<p class="muted">No tasks yet.</p>'}
<form method="post" action="/ai/${ai}/progress">${hidden}<input type="hidden" name="op" value="add_task"><label for="na">New task</label><input id="na" type="text" name="text" maxlength="300" required><button type="submit">Add task</button></form></div>
<div class="card"><h2>Latest notes</h2>${pr.recent_notes.length ? pr.recent_notes.map((n) => `<p><span class="muted">${esc(n.at)} · ${esc(n.by)}</span><br>${esc(n.text).replace(/\n/g, '<br>')}</p>`).join('') : '<p class="muted">No notes yet.</p>'}</div>`;
      } else if (view === 'money') {
        const st = await getStats(env, ai);
        const tx = await listTransactions(env, ai, { max: 30 });
        const hidden = `<input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="csrf" value="${esc(token)}">`;
        bodyHtml = `<div class="card"><h2>AI Million Challenge</h2>
<p>Money earned: <b>${esc(st.money_earned)}</b><br>Money spent: <b>${esc(st.money_spent)}</b><br>Net profit: <b>${esc(st.net_profit)}</b><br>
<span class="muted">Last updated: ${esc(st.last_updated || 'never')}${st.last_updated_by ? ' by ' + esc(st.last_updated_by) : ''} · updates today ${st.updates_today}/${UPDATE_LIMIT}</span></p></div>
<div class="card"><h2>Log money</h2><form method="post" action="/ai/${ai}/money">${hidden}
<label for="t">Type</label><select id="t" name="type" required style="padding:10px;border-radius:8px;font:inherit"><option value="earned">Earned (income)</option><option value="spent">Spent (cost)</option></select>
<label for="a">Amount in rand (R)</label><input id="a" type="text" inputmode="decimal" name="amount_zar" required placeholder="150.00">
<label for="d">What was it for?</label><input id="d" type="text" name="description" maxlength="200" required>
<label for="dt">Date (optional)</label><input id="dt" type="text" name="date" placeholder="${esc(new Date(Date.now() + 7200e3).toISOString().slice(0, 10))}">
<button type="submit">Save</button></form><p class="muted">Only log real money, not estimates.</p></div>
<div class="card"><h2>Business</h2><form method="post" action="/ai/${ai}/business">${hidden}
<label for="bn">Business name</label><input id="bn" type="text" name="name" maxlength="80" value="${esc(st.business.name)}">
<label for="bd">What does it do?</label><textarea id="bd" name="description" maxlength="1000" style="min-height:90px">${esc(st.business.description)}</textarea>
<label for="bs">Status note</label><input id="bs" type="text" name="status_note" maxlength="500" value="${esc(st.business.status_note)}">
<button type="submit">Save business</button></form></div>
<div class="card"><h2>Transactions</h2>${tx.transactions.length ? `<div style="overflow-x:auto"><table><tr><th>Date</th><th>Type</th><th>Amount</th><th>What</th></tr>${tx.transactions.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.type)}</td><td>${esc(t.amount)}</td><td>${esc(t.description)}</td></tr>`).join('')}</table></div>` : '<p class="muted">None yet.</p>'}</div>`;
      } else if (view === 'compose') {
        bodyHtml = `<div class="card"><h2>New email</h2><form method="post" action="/ai/${ai}/send">
<input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="csrf" value="${esc(token)}">
<label for="to">To</label><input id="to" type="text" name="to" required placeholder="client@example.com">
<label for="cc">Cc (optional)</label><input id="cc" type="text" name="cc">
<label for="s">Subject</label><input id="s" type="text" name="subject" required>
<label for="b">Message</label><textarea id="b" name="body" required></textarea>
<label><input type="checkbox" name="dry_run" value="true"> Test only (do not really send)</label>
<button type="submit">Send</button></form><p class="muted">Sends straight away. A copy goes to your Sent label.</p></div>`;
      } else {
        const q = url.searchParams.get('q') || '';
        const pg = url.searchParams.get('page') || undefined;
        let res = null;
        if (view !== 'search' || q) res = await listMail(env, ai, view === 'search' ? 'all' : view, { max: 20, pageToken: pg, q: view === 'search' ? q : undefined });
        bodyHtml = `<div class="card">${view === 'search' ? `<form method="get" action="/ai/${ai}" class="row"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="view" value="search"><input type="text" name="q" value="${esc(q)}" placeholder="Search words" style="flex:1"><button type="submit">Search</button></form>` : ''}
${res ? listHtml(ai, key, res, origin) : ''}${res && res.next_page_token ? `<p><a href="/ai/${ai}?key=${k}&view=${view}&q=${encodeURIComponent(q)}&page=${encodeURIComponent(res.next_page_token)}">Older emails →</a></p>` : ''}</div>`;
      }
      const links = `<div class="card muted">Plain-text links for AIs that can only read links: <a href="/ai/${ai}/inbox.txt?key=${k}">inbox.txt</a> · <a href="/ai/${ai}/sent.txt?key=${k}">sent.txt</a> · <a href="/ai/${ai}/stats.txt?key=${k}">stats.txt</a> · <a href="/ai/${ai}/progress.txt?key=${k}">progress.txt</a> · <a href="/ai/${ai}/help.txt?key=${k}">help.txt</a>. Keep this page private: the link is your key.</div>`;
      return html(page(`${name} — mail`, tabs + bodyHtml + links, subtitle));
    }
    return text('Not found', 404);
  } catch (e) {
    const m = e instanceof AppError ? e.message : 'Something went wrong on the server.';
    if (!(e instanceof AppError)) console.error('aiweb error', String(e && e.message).slice(0, 200));
    const st = e instanceof AppError ? e.status : 500;
    return wantsText ? text('Error: ' + m, st) : html(page(`${name} — mail`, `<div class="card bad">${esc(m)}</div>`, subtitle), st);
  }
}
