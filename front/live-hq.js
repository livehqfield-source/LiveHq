// Live HQ front door: live-hq.livehqfield.workers.dev forwards every request, unchanged
// (same URL, method, headers and body), to the ai-mail-hub Worker through a service binding.
// No secrets live here; the hub Worker keeps its own secrets and KV.
export default {
  async fetch(request, env) {
    return env.HUB.fetch(request);
  },
};
