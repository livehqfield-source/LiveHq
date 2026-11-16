// AI Million Challenge: per-AI business info, money earned/spent and transaction history (KV).
import { AIS, AppError, randomToken, sastDate, fmtDate } from './core.js';

export const UPDATE_LIMIT = 100;
const MAX_AMOUNT_CENTS = 100_000_000_00; // R100 million per transaction
const LIM = { name: 80, description: 1000, status: 500, txdesc: 200 };

export function zar(cents) {
  const neg = cents < 0; const c = Math.abs(Math.round(cents));
  const r = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}R${r}.${String(c % 100).padStart(2, '0')}`;
}
const toZar = (cents) => Math.round(cents) / 100;

function cleanText(v, max, field, required = false) {
  if (v === undefined || v === null) { if (required) throw new AppError(400, `Add a ${field}.`); return undefined; }
  let s = String(v).replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
  if (s.length > max) throw new AppError(400, `The ${field} is too long (max ${max} characters).`);
  if (required && !s) throw new AppError(400, `Add a ${field}.`);
  return s;
}
export function parseAmount(v) {
  let s = String(v ?? '').trim().replace(/^R\s*/i, '');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // South African decimal comma, e.g. 99,50
  s = s.replace(/[\s,](?=\d{3}\b)/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new AppError(400, 'The amount must be a number in rand above 0, with at most 2 decimals (e.g. 150 or 99.50).');
  const cents = Math.round(parseFloat(s) * 100);
  if (!(cents > 0)) throw new AppError(400, 'The amount must be more than R0.');
  if (cents > MAX_AMOUNT_CENTS) throw new AppError(400, 'That amount is too large for one transaction.');
  return cents;
}
export function parseDate(v) {
  if (v === undefined || v === null || v === '') return sastDate();
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw new AppError(400, 'The date must look like 2026-11-16.');
  if (s > sastDate(Date.now() + 86400e3)) throw new AppError(400, 'The date cannot be in the future.');
  if (s < '2020-01-01') throw new AppError(400, 'The date is too far in the past.');
  return s;
}
const parseType = (t) => {
  const s = String(t ?? '').trim().toLowerCase();
  if (s !== 'earned' && s !== 'spent') throw new AppError(400, 'type must be "earned" or "spent".');
  return s;
};

export async function getBiz(env, ai) {
  const b = (await env.KV.get('biz:' + ai, 'json')) || {};
  return { name: b.name || '', description: b.description || '', status: b.status || '', earned_cents: b.earned_cents || 0, spent_cents: b.spent_cents || 0, tx_count: b.tx_count || 0, seq: b.seq || 0, updated_at: b.updated_at || null, updated_by: b.updated_by || '' };
}
const saveBiz = (env, ai, b) => env.KV.put('biz:' + ai, JSON.stringify(b));

export async function updatesToday(env, ai) { return parseInt((await env.KV.get(`ucount:${ai}:${sastDate()}`)) || '0', 10); }
async function useUpdate(env, ai) {
  const k = `ucount:${ai}:${sastDate()}`;
  const n = parseInt((await env.KV.get(k)) || '0', 10);
  if (n >= UPDATE_LIMIT) throw new AppError(429, `Daily update limit reached (${UPDATE_LIMIT} updates per day). It resets at midnight South African time.`);
  await env.KV.put(k, String(n + 1), { expirationTtl: 3 * 86400 });
}
const who = (ai, via) => via === 'admin' ? 'Johan (admin)' : `${AIS[ai].name} via ${via === 'mcp' ? 'connector' : via === 'api' ? 'API' : 'web page'}`;

export function statsView(ai, b, updates) {
  return {
    ai, name: AIS[ai].name,
    business: { name: b.name, description: b.description, status_note: b.status },
    money_earned_zar: toZar(b.earned_cents), money_spent_zar: toZar(b.spent_cents), net_profit_zar: toZar(b.earned_cents - b.spent_cents),
    money_earned: zar(b.earned_cents), money_spent: zar(b.spent_cents), net_profit: zar(b.earned_cents - b.spent_cents),
    transactions_count: b.tx_count, last_updated: b.updated_at ? fmtDate(b.updated_at) : null, last_updated_by: b.updated_by || null,
    ...(updates !== undefined ? { updates_today: updates, daily_update_limit: UPDATE_LIMIT } : {}),
  };
}
export async function getStats(env, ai) { return statsView(ai, await getBiz(env, ai), await updatesToday(env, ai)); }

export async function updateBusiness(env, ai, via, a = {}) {
  const name = cleanText(a.name, LIM.name, 'business name');
  const description = cleanText(a.description, LIM.description, 'description');
  const status = cleanText(a.status_note ?? a.status, LIM.status, 'status note');
  if (name === undefined && description === undefined && status === undefined) throw new AppError(400, 'Give at least one of: name, description, status_note.');
  if (via !== 'admin') await useUpdate(env, ai);
  const b = await getBiz(env, ai);
  if (name !== undefined) b.name = name;
  if (description !== undefined) b.description = description;
  if (status !== undefined) b.status = status;
  b.updated_at = Date.now(); b.updated_by = who(ai, via);
  await saveBiz(env, ai, b);
  return { ok: true, ...(await getStats(env, ai)) };
}

function txView(id, t) {
  return { id, type: t.type, amount_zar: toZar(t.cents), amount: zar(t.cents), description: t.desc, date: t.date, logged_at: fmtDate(t.ts), logged_by: t.by, ...(t.edited ? { edited_by_admin: true } : {}) };
}
export async function logMoney(env, ai, via, a = {}) {
  const type = parseType(a.type);
  const cents = parseAmount(a.amount_zar ?? a.amount);
  const desc = cleanText(a.description, LIM.txdesc, 'description', true);
  const date = parseDate(a.date);
  if (via !== 'admin') await useUpdate(env, ai);
  const ts = Date.now();
  const b = await getBiz(env, ai);
  b.seq = (b.seq || 0) + 1; // keeps newest-first order even within the same millisecond
  const id = `${String(9e15 - ts).padStart(16, '0')}${String(999999 - (b.seq % 1e6)).padStart(6, '0')}${randomToken(4)}`;
  const t = { type, cents, desc, date, ts, by: who(ai, via) };
  await env.KV.put(`tx:${ai}:${id}`, JSON.stringify(t), { metadata: t });
  if (type === 'earned') b.earned_cents += cents; else b.spent_cents += cents;
  b.tx_count += 1; b.updated_at = ts; b.updated_by = who(ai, via);
  await saveBiz(env, ai, b);
  return { ok: true, transaction: txView(id, t), totals: statsView(ai, b) };
}
export async function listTransactions(env, ai, { max = 20, cursor } = {}) {
  max = Math.min(Math.max(parseInt(max, 10) || 20, 1), 100);
  const l = await env.KV.list({ prefix: `tx:${ai}:`, limit: max, ...(cursor ? { cursor: String(cursor).slice(0, 500) } : {}) });
  const items = [];
  for (const k of l.keys) {
    const t = k.metadata || (await env.KV.get(k.name, 'json'));
    if (t) items.push(txView(k.name.slice(`tx:${ai}:`.length), t));
  }
  return { ai, count: items.length, transactions: items, next_cursor: l.list_complete ? null : l.cursor || null };
}

const TXID_RE = /^[0-9]{22}[A-Za-z0-9_-]{4,8}$/;
async function getTx(env, ai, id) {
  if (!AIS[ai] || !TXID_RE.test(String(id || ''))) throw new AppError(400, 'Bad transaction id.');
  const t = await env.KV.get(`tx:${ai}:${id}`, 'json');
  if (!t) throw new AppError(404, 'Transaction not found.');
  return t;
}
export async function adminEditTx(env, ai, id, a) {
  const old = await getTx(env, ai, id);
  const t = { ...old, type: parseType(a.type), cents: parseAmount(a.amount), desc: cleanText(a.description, LIM.txdesc, 'description', true), date: parseDate(a.date), edited: Date.now() };
  await env.KV.put(`tx:${ai}:${id}`, JSON.stringify(t), { metadata: t });
  const b = await getBiz(env, ai);
  if (old.type === 'earned') b.earned_cents -= old.cents; else b.spent_cents -= old.cents;
  if (t.type === 'earned') b.earned_cents += t.cents; else b.spent_cents += t.cents;
  b.updated_at = Date.now(); b.updated_by = who(ai, 'admin');
  await saveBiz(env, ai, b);
}
export async function adminDeleteTx(env, ai, id) {
  const old = await getTx(env, ai, id);
  await env.KV.delete(`tx:${ai}:${id}`);
  const b = await getBiz(env, ai);
  if (old.type === 'earned') b.earned_cents -= old.cents; else b.spent_cents -= old.cents;
  b.tx_count = Math.max(0, b.tx_count - 1); b.updated_at = Date.now(); b.updated_by = who(ai, 'admin');
  await saveBiz(env, ai, b);
}
