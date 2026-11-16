// Builds the Cloudflare API deploy function for the user-Cloudflare MCP "execute" tool.
// Usage: node scripts/make-deploy.mjs first|update  -> writes .secrets/deploy_payload.js (chmod 600)
// "first" includes the Worker secrets; "update" keeps existing secrets untouched.
import fs from 'node:fs';
const mode = process.argv[2] || 'update';
const KV_ID = 'b4177a174d4540d09b2daf2433a5f87c';
const files = ['worker.js', 'core.js', 'api.js', 'aiweb.js', 'admin.js', 'html.js', 'money.js', 'progress.js', 'limits.js', 'apps.js'];
const mods = Object.fromEntries(files.map((f) => [f, fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')]));
const bindings = [{ type: 'kv_namespace', name: 'KV', namespace_id: KV_ID }];
if (mode === 'first') {
  const rd = (n) => fs.readFileSync(new URL('../.secrets/' + n, import.meta.url), 'utf8').trim();
  bindings.push({ type: 'secret_text', name: 'ADMIN_PASSWORD', text: rd('admin_password.txt') });
  bindings.push({ type: 'secret_text', name: 'SESSION_SECRET', text: rd('session_secret.txt') });
  bindings.push({ type: 'secret_text', name: 'ENC_KEY', text: rd('enc_key.txt') });
}
const metadata = { main_module: 'worker.js', compatibility_date: '2025-09-01', bindings, ...(mode === 'first' ? {} : { keep_bindings: ['secret_text'] }) };
const code = `async () => {
  const mods = ${JSON.stringify(mods)};
  const metadata = ${JSON.stringify(metadata)};
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  for (const [n, src] of Object.entries(mods)) form.append(n, new Blob([src], { type: 'application/javascript+module' }), n);
  const r = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/ai-mail-hub\`, body: form });
  const sub = await cloudflare.request({ method: 'POST', path: \`/accounts/\${accountId}/workers/scripts/ai-mail-hub/subdomain\`, body: { enabled: true, previews_enabled: false } });
  return { ok: r.success, id: r.result && r.result.id, modified: r.result && r.result.modified_on, bindings: (r.result && r.result.bindings || []).map(b => b.name + ':' + b.type), subdomain: sub.result };
}`;
fs.writeFileSync(new URL('../.secrets/deploy_payload.js', import.meta.url), code, { mode: 0o600 });
fs.chmodSync(new URL('../.secrets/deploy_payload.js', import.meta.url), 0o600);
console.log('payload written', mode, code.length, 'bytes');
