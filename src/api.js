// MCP server + REST API + OpenAPI spec.
import { AIS, ACCOUNT, DAILY_LIMIT, AppError, plusAddr, listMail, readEmail, sendMail, authAI, getSettings, sentToday } from './core.js';
import { UPDATE_LIMIT, getStats, updateBusiness, logMoney, listTransactions } from './money.js';
import { PROGRESS_LIMIT, getProgress, saveProgress, addTask, updateTask, listTasks } from './progress.js';
import { reportLimit, parseReset } from './limits.js';
import { useProgressWrite } from './progress.js';
import { publishApp, listMyApps, unpublishApp, PUBLISH_LIMIT } from './apps.js';

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}
export function bearer(req) {
  const a = req.headers.get('authorization') || '';
  const m = a.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : req.headers.get('x-api-key') || null;
}

const listProps = {
  max_results: { type: 'integer', minimum: 1, maximum: 25, default: 10, description: 'How many emails to return (1-25).' },
  page_token: { type: 'string', description: 'Use next_page_token from an earlier result to get older emails.' },
};
export const TOOLS = [
  { name: 'list_inbox', title: 'List my inbox',
    description: 'Use this to see emails that clients sent to you (your Inbox label), newest first.',
    inputSchema: { type: 'object', properties: { ...listProps } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'list_sent', title: 'List my sent mail',
    description: 'Use this to see emails you have sent (your Sent label), newest first.',
    inputSchema: { type: 'object', properties: { ...listProps } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'read_email', title: 'Read one email',
    description: 'Use this to read the full text of one email (by message_id from a list or search), plus the rest of its conversation.',
    inputSchema: { type: 'object', properties: { message_id: { type: 'string', description: 'The id of the email.' }, include_thread: { type: 'boolean', default: true, description: 'Also return the other emails in the same conversation.' } }, required: ['message_id'] },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'search_my_mail', title: 'Search my mail',
    description: 'Use this to search only your own emails (inbox and sent) with Gmail search words, e.g. "from:client@example.com", "invoice", "newer_than:7d".',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search words.' }, ...listProps }, required: ['query'] },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'send_email', title: 'Send a new email',
    description: `Use this to send a NEW email to someone. It is sent straight away from ${ACCOUNT}; a copy is filed in your Sent label automatically. Max ${DAILY_LIMIT} emails per day. Set dry_run=true to test without sending. To answer an existing email, use reply_email instead.`,
    inputSchema: { type: 'object', properties: {
      to: { type: 'string', description: 'Recipient email address(es), comma separated.' },
      cc: { type: 'string', description: 'Optional CC address(es), comma separated.' },
      subject: { type: 'string', description: 'The subject line.' },
      body: { type: 'string', description: 'The email text (plain text).' },
      dry_run: { type: 'boolean', default: false, description: 'true = only check and preview, do not send.' } }, required: ['to', 'subject', 'body'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'reply_email', title: 'Reply to an email',
    description: `Use this to reply inside an existing conversation (keeps the same thread and subject). Sent straight away. Max ${DAILY_LIMIT} emails per day (shared with send_email). Set dry_run=true to test without sending.`,
    inputSchema: { type: 'object', properties: {
      message_id: { type: 'string', description: 'The id of the email you are replying to.' },
      body: { type: 'string', description: 'Your reply text (plain text).' },
      reply_all: { type: 'boolean', default: false, description: 'Also reply to everyone else on the email.' },
      dry_run: { type: 'boolean', default: false, description: 'true = only check and preview, do not send.' } }, required: ['message_id', 'body'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
  { name: 'get_my_stats', title: 'My challenge stats',
    description: 'Use this to see your AI Million Challenge scoreboard: your business name, description and status note, total money earned, money spent and net profit in rand (ZAR), and when it was last updated.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'update_business', title: 'Update my business',
    description: `Use this to set or change what business you are running for the AI Million Challenge: its name, a short description and a status note (what is happening now). Give at least one field. Shown on Johan's dashboard. Max ${UPDATE_LIMIT} updates per day (shared with log_money).`,
    inputSchema: { type: 'object', properties: {
      name: { type: 'string', maxLength: 80, description: 'Business name.' },
      description: { type: 'string', maxLength: 1000, description: 'What the business does and how it makes money.' },
      status_note: { type: 'string', maxLength: 500, description: 'Short current status, e.g. "First 3 clients signed".' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'log_money', title: 'Log money earned or spent',
    description: `Use this every time your business really earns or spends money (in South African rand). It adds a transaction and updates your Money Earned, Money Spent and Net Profit totals on Johan's dashboard. Only log real money, never estimates. Max ${UPDATE_LIMIT} updates per day.`,
    inputSchema: { type: 'object', properties: {
      type: { type: 'string', enum: ['earned', 'spent'], description: '"earned" for income, "spent" for costs.' },
      amount_zar: { type: 'number', exclusiveMinimum: 0, description: 'Amount in rand, more than 0, max 2 decimals, e.g. 150 or 99.50.' },
      description: { type: 'string', maxLength: 200, description: 'What it was for, e.g. "Logo design for client X" or "Domain name".' },
      date: { type: 'string', description: 'Optional date YYYY-MM-DD (default today, South African time).' } }, required: ['type', 'amount_zar', 'description'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'list_my_transactions', title: 'List my transactions',
    description: 'Use this to see your logged money transactions (earned and spent), newest first.',
    inputSchema: { type: 'object', properties: { max_results: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, cursor: { type: 'string', description: 'next_cursor from an earlier call, for older transactions.' } } },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'get_my_progress', title: 'Get my saved progress (call first)',
    description: 'CALL THIS FIRST at the start of EVERY chat (together with get_my_stats). Returns your saved current focus, your open tasks in order and your last 20 notes, so you can carry on where you stopped. Then continue the first open task straight away without waiting for Johan to tell you.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'save_progress', title: 'Save my progress',
    description: `Call this BEFORE you finish every reply, and whenever your usage limit may be near, so you can continue next time. Saves your current focus, adds a note (what you did, what you learned, what is next) and optionally replaces your list of open next steps (done tasks are kept). Give at least one field. Max ${PROGRESS_LIMIT} saves per day.`,
    inputSchema: { type: 'object', properties: {
      current_focus: { type: 'string', maxLength: 500, description: 'What you are working on right now.' },
      note: { type: 'string', maxLength: 2000, description: 'Log entry: what you did, results, what to do next.' },
      next_steps: { type: 'array', maxItems: 50, description: 'Optional: your full ordered list of open next steps. Replaces the current open tasks.',
        items: { type: 'object', properties: { text: { type: 'string', maxLength: 300 }, status: { type: 'string', enum: ['todo', 'doing', 'done'], default: 'todo' } }, required: ['text'] } } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'add_task', title: 'Add a task',
    description: `Use this to add one task to the end of your to-do list. Max ${PROGRESS_LIMIT} progress saves per day (shared).`,
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 300 }, status: { type: 'string', enum: ['todo', 'doing', 'done'], default: 'todo' } }, required: ['text'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
  { name: 'update_task', title: 'Update a task',
    description: 'Use this to change a task\'s status (todo, doing, done) and/or its text. Mark tasks "doing" when you start and "done" when finished.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'Task id like "t3" (from list_tasks or get_my_progress).' }, status: { type: 'string', enum: ['todo', 'doing', 'done'] }, text: { type: 'string', maxLength: 300 } }, required: ['task_id'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'list_tasks', title: 'List my tasks',
    description: 'Use this to see your task list in order (open tasks only, unless include_done is true).',
    inputSchema: { type: 'object', properties: { include_done: { type: 'boolean', default: false } } }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'publish_app', title: 'Publish an app to the Live HQ site',
    description: `Publish (or update) your own web app on Johan's site at /apps/<slug>, for example an invoice maker. Send ONE complete, self-contained HTML document in html (start with <!DOCTYPE html>, max 1 MB) that runs on its own in a browser. Put CSS and JavaScript inline. Libraries may load from cdnjs.cloudflare.com, unpkg.com, cdn.jsdelivr.net, cdn.tailwindcss.com or esm.sh. A React/JSX artifact must be wrapped: load React, ReactDOM and Babel standalone (@babel/standalone) from a CDN and put the component in <script type="text/babel">. The app runs in a sandbox: no localStorage/cookies, no calls to other servers (keep data in memory; download/print/save-as-file works). Publishing the same slug again replaces it. Slug "live-hq-invoice-maker" is reserved for Claude. Max ${PUBLISH_LIMIT} publishes per day.`,
    inputSchema: { type: 'object', required: ['slug', 'title', 'html'], properties: { slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', minLength: 3, maxLength: 60, description: 'kebab-case, e.g. live-hq-invoice-maker' }, title: { type: 'string', maxLength: 100 }, html: { type: 'string', description: 'The full HTML document' }, description: { type: 'string', maxLength: 500 } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'list_my_apps', title: 'List my published apps', description: 'List the apps you own on the Live HQ site (including reserved slots waiting for your upload), with their links.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'unpublish_app', title: 'Unpublish one of my apps', description: 'Remove one of your published apps by slug. A reserved slot goes back to "waiting for upload".',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'report_limit', title: 'Report my usage limit',
    description: 'Call this when you know you are at or near your usage/message limit (call save_progress first). Optionally give resets_at (ISO date-time) or hours_until_reset; if you give neither, the usual reset time for your app is used. Johan\'s dashboard then shows a countdown and turns green when you can continue.',
    inputSchema: { type: 'object', properties: { resets_at: { type: 'string', description: 'When your limit resets, e.g. 2026-11-16T18:30:00+02:00.' }, hours_until_reset: { type: 'number', exclusiveMinimum: 0, maximum: 192 } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];

export async function runTool(env, ai, via, name, a, origin = '') {
  a = a || {};
  switch (name) {
    case 'list_inbox': return listMail(env, ai, 'inbox', { max: a.max_results, pageToken: a.page_token });
    case 'list_sent': return listMail(env, ai, 'sent', { max: a.max_results, pageToken: a.page_token });
    case 'search_my_mail':
      if (!a.query || !String(a.query).trim()) throw new AppError(400, 'Give some search words in "query".');
      return listMail(env, ai, 'all', { max: a.max_results, pageToken: a.page_token, q: a.query });
    case 'read_email': return readEmail(env, ai, a.message_id, a.include_thread !== false && a.include_thread !== 'false');
    case 'send_email': return sendMail(env, ai, via, a, false);
    case 'reply_email': return sendMail(env, ai, via, a, true);
    case 'get_my_stats': return getStats(env, ai);
    case 'update_business': return updateBusiness(env, ai, via, a);
    case 'log_money': return logMoney(env, ai, via, a);
    case 'list_my_transactions': return listTransactions(env, ai, { max: a.max_results, cursor: a.cursor });
    case 'get_my_progress': return getProgress(env, ai);
    case 'save_progress': return saveProgress(env, ai, via, a);
    case 'add_task': return addTask(env, ai, via, a);
    case 'update_task': return updateTask(env, ai, via, a);
    case 'list_tasks': return listTasks(env, ai, { include_done: a.include_done });
    case 'publish_app': return publishApp(env, ai, via, a, origin);
    case 'list_my_apps': return listMyApps(env, ai, origin);
    case 'unpublish_app': return unpublishApp(env, ai, via, a.slug);
    case 'report_limit': parseReset(ai, a); await useProgressWrite(env, ai, via); return reportLimit(env, ai, via, a);
    default: throw new AppError(400, 'Unknown tool: ' + String(name).slice(0, 50));
  }
}

function instructions(ai, settings) {
  return `You are ${AIS[ai].name} in Johan's AI Million Challenge. WORK ON YOUR OWN: at the START of EVERY chat, first call get_my_progress and get_my_stats, ` +
    `then continue the first open task straight away. Do not wait for Johan to tell you to continue. Before you finish ANY reply, or when your usage limit may be near, call save_progress ` +
    `(current_focus, a note on what you did and what is next, next_steps). If you know you are at your usage limit, call save_progress then report_limit. ` +
    `This server is also your private mailbox inside ${ACCOUNT}: clients write to you at ${plusAddr(ai)}. Emails are sent straight away from ${ACCOUNT} as "${settings.display[ai]}" (max ${DAILY_LIMIT} per day). ` +
    `Use reply_email (not send_email) to answer an email. Use dry_run=true to test. ` +
    `Keep Johan's dashboard true: update_business for your business, log_money for every real rand earned or spent (never estimates). ` +
    `To put a web app you built on Johan's Live HQ site, call publish_app with one complete self-contained HTML file (see its description); list_my_apps shows your apps and links.`;
}

async function mcpOne(env, ai, msg, origin) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  const isNote = msg.id === undefined || msg.id === null;
  const reply = (result) => (isNote ? null : { jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => (isNote ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });
  switch (msg.method) {
    case 'initialize': {
      const want = msg.params && msg.params.protocolVersion;
      const settings = await getSettings(env);
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(want) ? want : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: `live-hq-${ai}`, title: `Live HQ (${AIS[ai].name})`, version: '1.0.0' },
        instructions: instructions(ai, settings),
      });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'resources/list': return reply({ resources: [] });
    case 'resources/templates/list': return reply({ resourceTemplates: [] });
    case 'prompts/list': return reply({ prompts: [] });
    case 'tools/call': {
      const p = msg.params || {};
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, 'Unknown tool');
      try {
        const out = await runTool(env, ai, 'mcp', p.name, p.arguments, origin);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        const m = e instanceof AppError ? e.message : 'Something went wrong on the server.';
        if (!(e instanceof AppError)) console.error('tool error', p.name, String(e && e.message).slice(0, 200));
        return reply({ content: [{ type: 'text', text: 'Error: ' + m }], isError: true });
      }
    }
    default:
      if (String(msg.method || '').startsWith('notifications/')) return null;
      return fail(-32601, 'Method not found');
  }
}

export async function handleMcp(req, env, url, pathKey) {
  if (req.method === 'GET' || req.method === 'DELETE') return new Response('This MCP server only uses POST (Streamable HTTP, no separate event stream).', { status: 405, headers: { allow: 'POST' } });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const who = await authAI(env, pathKey || bearer(req) || url.searchParams.get('key'));
  if (!who) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: missing or wrong AI key.' } }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const batch = Array.isArray(body);
  const out = [];
  for (const m of batch ? body.slice(0, 20) : [body]) { const r = await mcpOne(env, who.ai, m, url.origin); if (r) out.push(r); }
  if (!out.length) return new Response(null, { status: 202 });
  const payload = batch ? out : out[0];
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }
  return json(payload);
}

// ---------- REST ----------
export async function handleRest(req, env, url, rest) {
  const who = await authAI(env, bearer(req));
  if (!who) return json({ error: 'Unauthorized: send your AI key as "Authorization: Bearer <key>".' }, 401, { 'www-authenticate': 'Bearer' });
  const ai = who.ai;
  const q = url.searchParams;
  const opts = { max: q.get('max_results'), pageToken: q.get('page_token') };
  try {
    if (req.method === 'GET') {
      if (rest === 'me') {
        const s = await getSettings(env);
        return json({ ai, name: AIS[ai].name, client_address: plusAddr(ai), sends_from: ACCOUNT, display_name: s.display[ai], sent_today: await sentToday(env, ai), daily_limit: DAILY_LIMIT, sending_enabled: s.sending_enabled });
      }
      if (rest === 'inbox') return json(await listMail(env, ai, 'inbox', opts));
      if (rest === 'sent') return json(await listMail(env, ai, 'sent', opts));
      if (rest === 'search') return json(await runTool(env, ai, 'api', 'search_my_mail', { query: q.get('q'), max_results: q.get('max_results'), page_token: q.get('page_token') }));
      if (rest === 'stats') return json(await getStats(env, ai));
      if (rest === 'progress') return json(await getProgress(env, ai));
      if (rest === 'apps') return json(await listMyApps(env, ai, url.origin));
      if (rest === 'tasks') return json(await listTasks(env, ai, { include_done: q.get('include_done') }));
      if (rest === 'transactions') return json(await listTransactions(env, ai, { max: q.get('max_results'), cursor: q.get('cursor') }));
      const mm = rest.match(/^messages\/([A-Za-z0-9_-]{1,64})$/);
      if (mm) return json(await readEmail(env, ai, mm[1], q.get('include_thread') !== 'false'));
    } else if (req.method === 'POST' && (['send', 'reply', 'business', 'money', 'progress', 'tasks', 'limit', 'apps'].includes(rest) || /^tasks\/t\d{1,7}$/.test(rest) || /^apps\/[a-z0-9-]{3,60}\/unpublish$/.test(rest))) {
      let a;
      try { a = await req.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
      if (!a || typeof a !== 'object' || Array.isArray(a)) return json({ error: 'Send a JSON object.' }, 400);
      if (rest === 'business') return json(await updateBusiness(env, ai, 'api', a));
      if (rest === 'money') return json(await logMoney(env, ai, 'api', a));
      if (rest === 'progress') return json(await saveProgress(env, ai, 'api', a));
      if (rest === 'tasks') return json(await addTask(env, ai, 'api', a));
      if (rest === 'apps') return json(await publishApp(env, ai, 'api', a, url.origin));
      if (rest.startsWith('apps/')) return json(await unpublishApp(env, ai, 'api', rest.split('/')[1]));
      if (rest === 'limit') { parseReset(ai, a); await useProgressWrite(env, ai, 'api'); return json(await reportLimit(env, ai, 'api', a)); }
      if (rest.startsWith('tasks/')) return json(await updateTask(env, ai, 'api', { ...a, task_id: rest.slice(6) }));
      return json(await sendMail(env, ai, 'api', a, rest === 'reply'));
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error('api error', String(e && e.message).slice(0, 200));
    return json({ error: 'Something went wrong on the server.' }, 500);
  }
}

export function openapi(origin) {
  const err = { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } };
  const okObj = (d) => ({ description: d, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } });
  const listParams = [
    { name: 'max_results', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 }, description: 'How many emails (1-25).' },
    { name: 'page_token', in: 'query', required: false, schema: { type: 'string' }, description: 'next_page_token from an earlier call, for older emails.' },
  ];
  return {
    openapi: '3.1.0',
    info: { title: 'Live HQ', version: '1.0.0', description: `ALWAYS start every chat with getMyProgress and getMyStats, then continue the first open task without waiting to be told; call saveProgress before finishing every reply. Private mailbox for one AI inside ${ACCOUNT}. Your API key decides which AI you are and only shows your own mail. Emails are sent straight away. Max ${DAILY_LIMIT} sends per day.` },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }, schemas: {} },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/me': { get: { operationId: 'whoAmI', summary: 'Show which AI you are, your client address and how many emails you sent today.', responses: { 200: okObj('Your details'), 401: err } } },
      '/api/v1/inbox': { get: { operationId: 'listInbox', summary: 'List emails clients sent to you, newest first.', parameters: listParams, responses: { 200: okObj('List of emails'), 401: err } } },
      '/api/v1/sent': { get: { operationId: 'listSent', summary: 'List emails you sent, newest first.', parameters: listParams, responses: { 200: okObj('List of emails'), 401: err } } },
      '/api/v1/search': { get: { operationId: 'searchMyMail', summary: 'Search only your own emails with Gmail search words.', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'Gmail search words, e.g. from:someone@example.com' }, ...listParams], responses: { 200: okObj('List of emails'), 401: err } } },
      '/api/v1/messages/{message_id}': { get: { operationId: 'readEmail', summary: 'Read one email in full, with its conversation.', parameters: [{ name: 'message_id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'include_thread', in: 'query', required: false, schema: { type: 'boolean', default: true } }], responses: { 200: okObj('The email'), 404: err } } },
      '/api/v1/send': { post: { operationId: 'sendEmail', summary: 'Send a NEW email straight away. Use replyEmail to answer an existing email.', 'x-openai-isConsequential': false,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'subject', 'body'], properties: {
          to: { type: 'string', description: 'Recipient address(es), comma separated.' }, cc: { type: 'string', description: 'Optional CC address(es).' },
          subject: { type: 'string' }, body: { type: 'string', description: 'Plain text.' }, dry_run: { type: 'boolean', default: false, description: 'true = test only, nothing is sent.' } } } } } },
        responses: { 200: okObj('Result'), 400: err, 429: err } } },
      '/api/v1/reply': { post: { operationId: 'replyEmail', summary: 'Reply inside an existing conversation, sent straight away.', 'x-openai-isConsequential': false,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message_id', 'body'], properties: {
          message_id: { type: 'string' }, body: { type: 'string' }, reply_all: { type: 'boolean', default: false }, dry_run: { type: 'boolean', default: false } } } } } },
        responses: { 200: okObj('Result'), 400: err, 429: err } } },
      '/api/v1/stats': { get: { operationId: 'getMyStats', summary: 'AI Million Challenge: your business info and money earned, spent and net profit (rand).', responses: { 200: okObj('Your stats'), 401: err } } },
      '/api/v1/business': { post: { operationId: 'updateBusiness', summary: 'Set your business name, description and/or status note (at least one).', 'x-openai-isConsequential': false,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
          name: { type: 'string', maxLength: 80 }, description: { type: 'string', maxLength: 1000 }, status_note: { type: 'string', maxLength: 500 } } } } } },
        responses: { 200: okObj('Updated stats'), 400: err, 429: err } } },
      '/api/v1/money': { post: { operationId: 'logMoney', summary: 'Log real money earned or spent (rand). Updates your totals.', 'x-openai-isConsequential': false,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['type', 'amount_zar', 'description'], properties: {
          type: { type: 'string', enum: ['earned', 'spent'] }, amount_zar: { type: 'number', exclusiveMinimum: 0, description: 'Rand, max 2 decimals.' },
          description: { type: 'string', maxLength: 200 }, date: { type: 'string', description: 'Optional YYYY-MM-DD, default today.' } } } } } },
        responses: { 200: okObj('Transaction and new totals'), 400: err, 429: err } } },
      '/api/v1/transactions': { get: { operationId: 'listMyTransactions', summary: 'List your money transactions, newest first.', parameters: [
        { name: 'max_results', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        { name: 'cursor', in: 'query', required: false, schema: { type: 'string' } }], responses: { 200: okObj('Transactions'), 401: err } } },
      '/api/v1/progress': {
        get: { operationId: 'getMyProgress', summary: 'CALL FIRST in every chat: your saved focus, open tasks and last 20 notes. Then continue the first open task without waiting to be told.', responses: { 200: okObj('Your progress'), 401: err } },
        post: { operationId: 'saveProgress', summary: 'Save progress before finishing every reply: current_focus, a note, and optionally the full list of open next_steps.', 'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
            current_focus: { type: 'string', maxLength: 500 }, note: { type: 'string', maxLength: 2000 },
            next_steps: { type: 'array', maxItems: 50, items: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300 }, status: { type: 'string', enum: ['todo', 'doing', 'done'] } } } } } } } } },
          responses: { 200: okObj('Saved progress'), 400: err, 429: err } } },
      '/api/v1/tasks': {
        get: { operationId: 'listTasks', summary: 'List your tasks in order (open only unless include_done=true).', parameters: [{ name: 'include_done', in: 'query', required: false, schema: { type: 'boolean', default: false } }], responses: { 200: okObj('Tasks'), 401: err } },
        post: { operationId: 'addTask', summary: 'Add a task to the end of your list.', 'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 300 }, status: { type: 'string', enum: ['todo', 'doing', 'done'] } } } } } },
          responses: { 200: okObj('Task added'), 400: err, 429: err } } },
      '/api/v1/tasks/{task_id}': { post: { operationId: 'updateTask', summary: 'Change a task status (todo/doing/done) and/or text.', 'x-openai-isConsequential': false,
        parameters: [{ name: 'task_id', in: 'path', required: true, schema: { type: 'string' }, description: 'e.g. t3' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['todo', 'doing', 'done'] }, text: { type: 'string', maxLength: 300 } } } } } },
        responses: { 200: okObj('Task updated'), 400: err, 404: err } } },
      '/api/v1/apps': {
        get: { operationId: 'listMyApps', summary: 'List my published apps (and reserved slots waiting for my upload) with links.', responses: { 200: okObj('Your apps') } },
        post: { operationId: 'publishApp', summary: 'Publish or update my web app at /apps/<slug>. html = ONE complete self-contained HTML document (max 1 MB; CDN libraries from cdnjs/unpkg/jsdelivr/tailwind/esm.sh allowed; wrap React/JSX with React+Babel standalone from a CDN). Runs sandboxed: no localStorage or outside calls.', 'x-openai-isConsequential': false,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['slug', 'title', 'html'], properties: { slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }, title: { type: 'string', maxLength: 100 }, html: { type: 'string' }, description: { type: 'string', maxLength: 500 } } } } } },
          responses: { 200: okObj('Published'), 400: err, 403: err, 413: err, 429: err } } },
      '/api/v1/apps/{slug}/unpublish': { post: { operationId: 'unpublishApp', summary: 'Remove one of my published apps.', 'x-openai-isConsequential': true,
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: okObj('Unpublished'), 404: err } } },
      '/api/v1/limit': { post: { operationId: 'reportLimit', summary: 'Report that you are at or near your usage limit (save progress first). Optional resets_at or hours_until_reset.', 'x-openai-isConsequential': false,
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { resets_at: { type: 'string' }, hours_until_reset: { type: 'number', exclusiveMinimum: 0, maximum: 192 } } } } } },
        responses: { 200: okObj('Limit saved'), 400: err } } },
    },
  };
}
