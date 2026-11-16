// Save-progress memory per AI: current focus, ordered task list and a notes log (KV, one record per AI).
import { AIS, AppError, sastDate, fmtDate } from './core.js';
import { getLimit, limitView } from './limits.js';

export const PROGRESS_LIMIT = 200;
const MAX_NOTES = 200, MAX_TASKS = 100;
const LIM = { focus: 500, note: 2000, task: 300 };
const STATUSES = ['todo', 'doing', 'done'];

function txt(v, max, field, required = false) {
  if (v === undefined || v === null) { if (required) throw new AppError(400, `Add ${field}.`); return undefined; }
  const s = String(v).replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
  if (s.length > max) throw new AppError(400, `The ${field} is too long (max ${max} characters).`);
  if (required && !s) throw new AppError(400, `Add ${field}.`);
  return s;
}
const status = (v, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const s = String(v).trim().toLowerCase();
  if (!STATUSES.includes(s)) throw new AppError(400, 'status must be "todo", "doing" or "done".');
  return s;
};
const who = (ai, via) => via === 'admin' ? 'Johan (admin)' : `${AIS[ai].name} via ${via === 'mcp' ? 'connector' : via === 'api' ? 'API' : 'web page'}`;

export async function getProg(env, ai) {
  const p = (await env.KV.get('prog:' + ai, 'json')) || {};
  return { focus: p.focus || '', tasks: Array.isArray(p.tasks) ? p.tasks : [], notes: Array.isArray(p.notes) ? p.notes : [], seq: p.seq || 0, updated_at: p.updated_at || null, updated_by: p.updated_by || '' };
}
async function save(env, ai, p, via) {
  p.updated_at = Date.now(); p.updated_by = who(ai, via);
  if (p.notes.length > MAX_NOTES) p.notes = p.notes.slice(-MAX_NOTES);
  await env.KV.put('prog:' + ai, JSON.stringify(p));
}
export async function writesToday(env, ai) { return parseInt((await env.KV.get(`pcount:${ai}:${sastDate()}`)) || '0', 10); }
export async function useProgressWrite(env, ai, via) { return useWrite(env, ai, via); }
async function useWrite(env, ai, via) {
  if (via === 'admin') return;
  const k = `pcount:${ai}:${sastDate()}`;
  const n = parseInt((await env.KV.get(k)) || '0', 10);
  if (n >= PROGRESS_LIMIT) throw new AppError(429, `Daily progress-save limit reached (${PROGRESS_LIMIT} per day). It resets at midnight South African time.`);
  await env.KV.put(k, String(n + 1), { expirationTtl: 3 * 86400 });
}
const taskView = (t) => ({ id: t.id, text: t.text, status: t.status, updated: fmtDate(t.updated) });
const noteView = (n) => ({ at: fmtDate(n.ts), by: n.by, text: n.text });
export const openTasks = (p) => p.tasks.filter((t) => t.status !== 'done');

export async function getProgress(env, ai) {
  const p = await getProg(env, ai);
  return {
    ai, name: AIS[ai].name,
    reminder: 'Continue the first open task now without waiting to be told. Call save_progress before you finish your reply.',
    current_focus: p.focus || null,
    open_tasks: openTasks(p).map(taskView),
    done_tasks_count: p.tasks.length - openTasks(p).length,
    recent_notes: p.notes.slice(-20).reverse().map(noteView),
    last_saved: p.updated_at ? fmtDate(p.updated_at) : null, last_saved_by: p.updated_by || null,
    usage_limit: limitView(await getLimit(env, ai)),
    saves_today: await writesToday(env, ai), daily_save_limit: PROGRESS_LIMIT,
  };
}

function newTask(p, text, st) {
  if (p.tasks.length >= MAX_TASKS) {
    const i = p.tasks.findIndex((t) => t.status === 'done'); // make room by dropping the oldest finished task
    if (i < 0) throw new AppError(400, `Too many open tasks (max ${MAX_TASKS}). Mark some as done first.`);
    p.tasks.splice(i, 1);
  }
  p.seq += 1;
  const t = { id: 't' + p.seq, text, status: st, updated: Date.now() };
  p.tasks.push(t);
  return t;
}

export async function saveProgress(env, ai, via, a = {}) {
  const focus = txt(a.current_focus ?? a.focus, LIM.focus, 'current focus');
  const note = txt(a.note, LIM.note, 'note');
  let steps;
  if (a.next_steps !== undefined && a.next_steps !== null) {
    if (!Array.isArray(a.next_steps)) throw new AppError(400, 'next_steps must be a list of tasks.');
    if (a.next_steps.length > 50) throw new AppError(400, 'next_steps can have at most 50 tasks.');
    steps = a.next_steps.map((x) => (typeof x === 'string' ? { text: txt(x, LIM.task, 'task text', true), status: 'todo' } : { text: txt(x && x.text, LIM.task, 'task text', true), status: status(x && x.status, 'todo') }));
  }
  if (focus === undefined && !note && steps === undefined) throw new AppError(400, 'Give at least one of: current_focus, note, next_steps.');
  await useWrite(env, ai, via);
  const p = await getProg(env, ai);
  if (focus !== undefined) p.focus = focus;
  if (note) p.notes.push({ ts: Date.now(), by: who(ai, via), text: note });
  if (steps !== undefined) {
    p.tasks = p.tasks.filter((t) => t.status === 'done'); // replace the open list, keep finished history
    for (const s of steps) newTask(p, s.text, s.status);
  }
  await save(env, ai, p, via);
  return { saved: true, ...(await getProgress(env, ai)) };
}
export async function addTask(env, ai, via, a = {}) {
  const text = txt(a.text, LIM.task, 'task text', true);
  const st = status(a.status, 'todo');
  await useWrite(env, ai, via);
  const p = await getProg(env, ai);
  const t = newTask(p, text, st);
  await save(env, ai, p, via);
  return { saved: true, task: taskView(t), open_tasks: openTasks(p).map(taskView) };
}
export async function updateTask(env, ai, via, a = {}) {
  const id = String(a.task_id ?? a.id ?? '').trim();
  if (!/^t\d{1,7}$/.test(id)) throw new AppError(400, 'Give a task_id like "t3" (see list_tasks).');
  const text = txt(a.text, LIM.task, 'task text');
  const st = a.status === undefined || a.status === null || a.status === '' ? undefined : status(a.status);
  if (text === undefined && st === undefined) throw new AppError(400, 'Give a new status and/or text.');
  if (text === '') throw new AppError(400, 'The task text cannot be empty.');
  const p0 = await getProg(env, ai);
  if (!p0.tasks.some((t) => t.id === id)) throw new AppError(404, 'Task not found.');
  await useWrite(env, ai, via);
  const p = await getProg(env, ai);
  const t = p.tasks.find((x) => x.id === id);
  if (!t) throw new AppError(404, 'Task not found.');
  if (text !== undefined) t.text = text;
  if (st !== undefined) t.status = st;
  t.updated = Date.now();
  await save(env, ai, p, via);
  return { saved: true, task: taskView(t), open_tasks: openTasks(p).map(taskView) };
}
export async function listTasks(env, ai, { include_done = false } = {}) {
  const p = await getProg(env, ai);
  const inc = include_done === true || include_done === 'true';
  const list = inc ? p.tasks : openTasks(p);
  return { ai, count: list.length, tasks: list.map(taskView) };
}

// ---- admin-only ----
export async function adminDeleteTask(env, ai, id) {
  const p = await getProg(env, ai);
  const n = p.tasks.length;
  p.tasks = p.tasks.filter((t) => t.id !== String(id));
  if (p.tasks.length === n) throw new AppError(404, 'Task not found.');
  await save(env, ai, p, 'admin');
}
export async function adminDeleteNote(env, ai, ts) {
  const p = await getProg(env, ai);
  const n = p.notes.length;
  p.notes = p.notes.filter((x) => String(x.ts) !== String(ts));
  if (p.notes.length === n) throw new AppError(404, 'Note not found.');
  await save(env, ai, p, 'admin');
}
