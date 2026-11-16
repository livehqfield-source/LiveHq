// Usage-limit timer per AI: when an AI hits its chat limit and when it resets.
import { AIS, AppError, fmtDate } from './core.js';

export const DEFAULT_RESET_HOURS = { chatgpt: 5, claude: 5, grok: 5, copilot: 24 };
export const CONTINUE_PROMPT = 'Continue: use Live HQ, call get_my_progress and get_my_stats, then carry on with your next open task and save_progress when done.';
const APP_URL = {
  chatgpt: 'https://chatgpt.com/?q=', claude: 'https://claude.ai/new?q=', grok: 'https://grok.com/?q=', copilot: 'https://copilot.microsoft.com/?q=',
};
export const continueUrl = (ai) => APP_URL[ai] + encodeURIComponent(CONTINUE_PROMPT);

export async function getLimit(env, ai) {
  return (await env.KV.get('limit:' + ai, 'json')) || null;
}
export function limitView(l, now = Date.now()) {
  if (!l || !l.resets_at) return { state: 'none', limit_hit_at: null, resets_at: null, ready: false };
  const ready = l.resets_at <= now;
  return { state: ready ? 'ready' : 'waiting', ready, limit_hit_at: fmtDate(l.limit_hit_at), resets_at: fmtDate(l.resets_at), resets_at_iso: new Date(l.resets_at).toISOString(), reported_by: l.by || null, minutes_left: ready ? 0 : Math.ceil((l.resets_at - now) / 60000) };
}

export function parseReset(ai, a = {}) {
  const now = Date.now();
  if (a.resets_at !== undefined && a.resets_at !== null && a.resets_at !== '') {
    const t = Date.parse(String(a.resets_at).slice(0, 40));
    if (isNaN(t)) throw new AppError(400, 'resets_at must be a date-time like 2026-11-16T18:30:00+02:00.');
    if (t < now - 60000) throw new AppError(400, 'resets_at is in the past.');
    if (t > now + 8 * 86400e3) throw new AppError(400, 'resets_at is too far ahead (max 8 days).');
    return t;
  }
  let h = DEFAULT_RESET_HOURS[ai];
  if (a.hours_until_reset !== undefined && a.hours_until_reset !== null && a.hours_until_reset !== '') {
    h = Number(String(a.hours_until_reset).replace(',', '.'));
    if (!isFinite(h) || h <= 0 || h > 192) throw new AppError(400, 'hours_until_reset must be a number of hours between 0 and 192.');
  }
  return now + Math.round(h * 3600e3);
}
export async function reportLimit(env, ai, via, a = {}) {
  const resets = parseReset(ai, a);
  const by = via === 'admin' ? 'Johan (admin)' : `${AIS[ai].name} via ${via === 'mcp' ? 'connector' : via === 'api' ? 'API' : 'web page'}`;
  const l = { limit_hit_at: Date.now(), resets_at: resets, by };
  await env.KV.put('limit:' + ai, JSON.stringify(l), { expirationTtl: 30 * 86400 });
  return { saved: true, ...limitView(l), reminder: 'Call save_progress now if you have not yet, so you can continue after the reset.' };
}
export async function clearLimit(env, ai) { await env.KV.delete('limit:' + ai); }
