// Cloudflare Pages (advanced mode) for live-hq.pages.dev.
// Passes every request (method, headers, streaming body) to the ai-mail-hub Worker.
// Preferred: a Service binding named HUB -> ai-mail-hub (no secrets needed here).
// Fallback: fetch the workers.dev address with X-Forwarded-Host so links and cookies use live-hq.pages.dev.
const HUB_URL = 'https://ai-mail-hub.livehqfield.workers.dev';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.host);
    const init = { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, redirect: 'manual' };
    if (env.HUB) return env.HUB.fetch(new Request(request.url, init));
    return fetch(new Request(HUB_URL + url.pathname + url.search, init));
  },
};
