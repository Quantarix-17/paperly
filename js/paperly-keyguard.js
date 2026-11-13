// PaperLy key guard — a tiny CLASSIC script that must be loaded FIRST in index.html, before every other script:
//   <script src="js/paperly-keyguard.js"></script>
//
// Once the account PIN is set up (paperly-cloud.js turns the guard on), API keys are never written to localStorage:
//   * on disk (localStorage) the model list is saved with every "apiKey" emptied; the keys themselves live there only
//     as an AES-GCM encrypted blob (paperly_keys_enc) made by paperly-cloud.js;
//   * while the tab is open the plaintext keys are kept in sessionStorage (this tab only, gone when it closes), and
//     this guard hands them to the app transparently whenever it reads aiModelsConfig_v1.
// The app code does not need to change: it keeps reading / writing aiModelsConfig_v1 as before.
(function () {
  'use strict';
  const CFG = 'aiModelsConfig_v1', RT = 'paperly_keys_rt', ON = 'paperly_keys_on';
  let ss; try { ss = window.sessionStorage; localStorage.length; } catch (_) { return; }
  const P = Storage.prototype, rawGet = P.getItem, rawSet = P.setItem;
  let on = false; try { on = rawGet.call(localStorage, ON) === '1'; } catch (_) {}
  const rt = () => { try { const v = rawGet.call(ss, RT); return v == null ? null : JSON.parse(v); } catch (_) { return null; } };
  const setRt = m => { try { rawSet.call(ss, RT, JSON.stringify(m || {})); } catch (_) {} };
  const loadedWithKeys = rt() !== null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  P.getItem = function (k) {
    const v = rawGet.apply(this, arguments);
    if (!on || k !== CFG || this !== localStorage || !v) return v;
    const keys = rt(); if (!keys) return v;
    try {
      const cfg = JSON.parse(v);
      if (!cfg || !Array.isArray(cfg.models)) return v;
      cfg.models.forEach(m => { if (m && keys[m.id]) m.apiKey = keys[m.id]; });
      return JSON.stringify(cfg);
    } catch (_) { return v; }
  };
  P.setItem = function (k, val) {
    if (!on || k !== CFG || this !== localStorage) return rawSet.apply(this, arguments);
    let cfg; try { cfg = JSON.parse(val); } catch (_) { return rawSet.apply(this, arguments); }
    if (!cfg || !Array.isArray(cfg.models)) return rawSet.apply(this, arguments);
    const old = rt(), next = {};
    cfg.models.forEach(m => {
      if (!m || !m.id) return;
      // An empty key never overwrites a known one: the app may be saving a stale copy that was loaded before the PIN was entered.
      const key = m.apiKey || (old && old[m.id]) || '';
      if (key) next[m.id] = key;
      m.apiKey = '';
    });
    if (old !== null || Object.keys(next).length) {       // not unlocked yet and nothing to store → leave the runtime copy untouched
      if (!same(old || {}, next)) { setRt(next); try { window.dispatchEvent(new CustomEvent('paperly:keys-changed')); } catch (_) {} }
    }
    return rawSet.call(this, k, JSON.stringify(cfg));
  };
  window.__paperlyKeyguard = {
    rt, setRt, loadedWithKeys,
    on: () => on,
    setOn: v => { on = !!v; try { rawSet.call(localStorage, ON, on ? '1' : '0'); } catch (_) {} },
    rawGet: k => rawGet.call(localStorage, k),
    rawSet: (k, v) => rawSet.call(localStorage, k, v)
  };
})();
