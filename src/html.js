export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f6f8;color:#1b1f24;font-size:16px;line-height:1.45}
header{background:#14213d;color:#fff;padding:14px 16px}header h1{font-size:20px;margin:0}header p{margin:4px 0 0;opacity:.85;font-size:14px}
main{max-width:900px;margin:0 auto;padding:12px}
.card{background:#fff;border-radius:10px;padding:14px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h2{font-size:18px;margin:0 0 10px}h3{font-size:16px;margin:12px 0 6px}
a{color:#0b57d0}.tabs a{display:inline-block;padding:8px 12px;margin:0 6px 6px 0;border-radius:8px;background:#e8eef7;text-decoration:none}
.tabs a.on{background:#0b57d0;color:#fff}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 6px;border-bottom:1px solid #e5e8eb;text-align:left;vertical-align:top}
.mail{display:block;padding:10px 4px;border-bottom:1px solid #e5e8eb;text-decoration:none;color:inherit}.mail b{color:#0b57d0}.mail small{color:#5f6368}
.unread b{font-weight:800}
label{display:block;font-weight:600;margin:10px 0 4px}input[type=text],input[type=email],input[type=password],textarea{width:100%;padding:10px;border:1px solid #c4c9cf;border-radius:8px;font:inherit}
textarea{min-height:160px}button,.btn{background:#0b57d0;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer;margin:6px 6px 0 0;display:inline-block;text-decoration:none}
button.grey{background:#5f6368}button.red{background:#b3261e}button[disabled]{background:#aab;cursor:not-allowed}
.ok{background:#e6f4ea;border-left:4px solid #1e8e3e;padding:10px;border-radius:6px}.bad{background:#fce8e6;border-left:4px solid #b3261e;padding:10px;border-radius:6px}
.warn{background:#fef7e0;border-left:4px solid #f9ab00;padding:10px;border-radius:6px}
pre,.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;word-break:break-all}
pre.body{background:#fafbfc;border:1px solid #e5e8eb;border-radius:8px;padding:10px;word-break:break-word}
.inline{display:inline}.muted{color:#5f6368;font-size:14px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
code{background:#eef1f4;padding:2px 5px;border-radius:4px;word-break:break-all}
.txrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.txrow input,.txrow select{padding:6px;border:1px solid #c4c9cf;border-radius:6px;font:inherit;width:auto}.txrow button{margin:0}
select{padding:8px;border:1px solid #c4c9cf;border-radius:8px;font:inherit}
.tasks{margin:6px 0 4px;padding-left:20px}.tasks li{margin:2px 0}.st{font-size:12px;font-weight:700;border-radius:999px;padding:1px 7px;background:#e8eef7;color:#0b57d0;margin-right:4px}.st.doing{background:#fef7e0;color:#a56600}
textarea.prompt{min-height:120px;font-family:inherit;font-size:14px;background:#fafbfc}
`;
export function page(title, body, sub = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}</style></head><body><header><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header><main>${body}</main></body></html>`;
}

const ADMIN_CSS = `
body{margin:0}.layout{display:flex;min-height:100vh}
.side{width:230px;flex:0 0 230px;background:#14213d;color:#fff;padding:16px 12px;position:sticky;top:0;height:100vh;overflow-y:auto}
.side .brand{font-weight:800;font-size:18px;margin:0 6px 14px}
.side .sec{text-transform:uppercase;font-size:11px;letter-spacing:.08em;opacity:.6;margin:16px 8px 4px}
.side a{display:block;color:#dfe6f3;text-decoration:none;padding:8px 10px;border-radius:8px;margin:2px 0}
.side a.sub{font-size:14px;padding:5px 10px 5px 22px;opacity:.85}
.side a:hover{background:rgba(255,255,255,.08)}.side a.on{background:#0b57d0;color:#fff;font-weight:600}
.side form{margin:0}.navbtn{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;width:100%;text-align:left;margin:4px 0 0}
.content{flex:1;min-width:0}.content main{max-width:920px}
h1.pt{font-size:24px;margin:16px 4px 4px}
.copyrow{display:flex;gap:6px}.copyrow input{flex:1;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:#fafbfc}
.copyrow button{margin:0;white-space:nowrap}
.pill{display:inline-block;padding:4px 10px;border-radius:999px;font-weight:700;font-size:14px}.pill.on{background:#e6f4ea;color:#1e8e3e}.pill.off{background:#fce8e6;color:#b3261e}
ol{padding-left:22px;margin:6px 0}
.stack{display:flex;flex-direction:column;gap:14px}.stack .card{margin:0;width:100%}.block h2{font-size:20px;margin:0}.block p{margin:8px 0}
.bhead{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.money{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:6px 0 10px}.money div{background:#f4f6f8;border-radius:8px;padding:10px}
.money span{display:block;font-size:13px;color:#5f6368}.money b{font-size:20px}.money b.pos{color:#1e8e3e}.money b.neg{color:#b3261e}
.block.waiting{border-left:5px solid #d93025}
.status{display:inline-flex;align-items:center;gap:6px;font-size:14px;font-weight:600;padding:3px 10px;border-radius:999px}
.status .dot{width:12px;height:12px;border-radius:50%;display:inline-block}
.status.green{background:#e6f4ea;color:#14532d}.status.green .dot{background:#1e8e3e}
.status.red{background:#fce8e6;color:#a50e0e}.status.red .dot{background:#d93025}
.limrow{align-items:flex-start}.limnote{margin:4px 0}
.limform summary.mini{cursor:pointer;color:#5f6368;font-size:13px;padding:6px 10px;border:1px solid #dadce0;border-radius:8px;list-style:none;display:inline-block}
.limform summary.mini::-webkit-details-marker{display:none}.limform form{margin-top:6px}
.btn.ghost{background:#fff;color:#0b57d0;border:1px solid #c4c9cf}.btn.grey,button.grey{background:#5f6368}
.lbl{font-weight:600}.prog{border-top:1px solid #e5e8eb;margin-top:8px;padding-top:4px}.desc{color:#3c4043}
.txrow{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0}.txrow input,.txrow select{padding:6px;border:1px solid #c4c9cf;border-radius:6px;font:inherit;width:auto}
.txrow .w-date{width:110px}.txrow .w-amt{width:110px}.txrow .w-desc{flex:1;min-width:160px}.txrow button{margin:0}
select{padding:8px;border:1px solid #c4c9cf;border-radius:8px;font:inherit}li{margin:3px 0}
@media (max-width:800px){
 .layout{display:block}
 .money{grid-template-columns:1fr}
 .side{width:auto;height:auto;position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:8px 10px}
 .side .brand{margin:0 8px 0 2px;font-size:16px;flex-basis:100%}
 .side .sec,.side a.sub{display:none}
 .side a{display:inline-block;padding:6px 10px;margin:0}
 .side form{display:inline-block}.navbtn{width:auto;margin:0;padding:6px 10px}
}`;
export function adminPage(title, nav, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${CSS}${ADMIN_CSS}</style><script src="/admin/assets/copy.js" defer></script></head><body><div class="layout">${nav}<div class="content"><main>${body}</main></div></div></body></html>`;
}

export const COPY_JS = `(function () {
  function tick() {
    var els = document.querySelectorAll('.status[data-resets]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], left = Date.parse(el.getAttribute('data-resets')) - Date.now();
      if (isNaN(left)) continue;
      if (left <= 0) {
        el.removeAttribute('data-resets'); el.className = 'status green'; el.removeAttribute('title');
        el.querySelector('.stxt').textContent = 'Available';
        var block = el.closest('.block');
        if (block) {
          block.classList.remove('waiting');
          var x = block.querySelectorAll('[data-clearlimit],[data-limnote]');
          for (var j = 0; j < x.length; j++) x[j].parentNode.removeChild(x[j]);
        }
        continue;
      }
      var s = Math.floor(left / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      var c = el.querySelector('.countdown'); if (c) c.textContent = h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (sec < 10 ? '0' : '') + sec + 's';
    }
  }
  if (document.querySelector('[data-resets]')) { tick(); setInterval(tick, 1000); }
})();
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('[data-copytext]');
  if (a && navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(a.getAttribute('data-copytext')).catch(function () {}); }
});
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('button[data-copy]');
  if (!b) return;
  var el = document.getElementById(b.getAttribute('data-copy'));
  if (!el) return;
  var done = function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(el.value).then(done, function () { el.select(); document.execCommand('copy'); done(); });
  else { el.select(); document.execCommand('copy'); done(); }
});`;
