// ai-quotes.js — প্রতিবার নতুন করে AI দিয়ে উক্তি তৈরি করে।
// কিছুই সেভ/ক্যাশ করা হয় না (localStorage, array, ইতিহাস — কিছুই নেই)।
// ব্যবহার: modal খোলার সময় AIQuote.mount(document.getElementById('your-quote-element'));
const AIQuote = (() => {
  const THEMES = [
    { id: 'life',  w: 4, brief: 'জীবন সম্পর্কে এমন একটি উক্তি যা পড়লে চোখ খুলে যায় — সময়, সাহস, ক্ষতি, নীরবতা, বেড়ে ওঠা বা বেঁচে থাকার অর্থ নিয়ে এক অপ্রত্যাশিত সত্য।' },
    { id: 'love',  w: 4, brief: 'ভালোবাসা নিয়ে গভীর, উষ্ণ ও কোমল একটি উক্তি — যত্ন, অপেক্ষা, কাছে থাকা বা মন ছুঁয়ে যাওয়ার অনুভূতি।' },
    { id: 'lit-philosophy', w: 2, brief: 'সাহিত্যিক ভাষায় জীবনদর্শনের একটি উক্তি — রূপক ও চিত্রকল্পে সাজানো, কবিতার মতো গভীর।' },
    { id: 'lit-romantic',   w: 2, brief: 'সাহিত্যিক ভাষায় রোমান্টিক একটি উক্তি — জোছনা, বৃষ্টি, নদী, পথ, আকাশের মতো চিত্রকল্পে ভরা ভালোবাসার কথা।' }
  ];
  const IMAGERY = ['আকাশ', 'নদী', 'বৃষ্টি', 'আলো', 'পথ', 'ঘুম', 'ঋতু', 'সন্ধ্যা', 'ঢেউ', 'বীজ', 'আয়না', 'হাওয়া', 'ঘড়ি', 'চিঠি', 'জানালা', 'পাখি', 'সমুদ্র', 'পাহাড়', 'প্রদীপ', 'শূন্যতা', 'ভোর', 'জোছনা'];
  const TONES = ['শান্ত', 'দৃঢ়', 'কোমল', 'গভীর', 'আশাবাদী', 'বিষণ্ণ-সুন্দর', 'প্রাণবন্ত'];
  // কোনো লিঙ্গ নির্দেশ করে এমন শব্দ ধরার জন্য (নিরাপত্তা-জাল)।
  // শব্দ আলাদা করে মেলানো হয়, যাতে "সীমা", "ক্ষমা", "সমাজ" এর মতো শব্দ ভুলে বাদ না পড়ে।
  const GENDERED_WORDS = new Set(['ছেলে','ছেলেরা','মেয়ে','মেয়েরা','পুরুষ','নারী','মহিলা','প্রেমিকা','প্রেমিক','স্বামী','স্ত্রী','বউ','বধূ','রমণী','কন্যা','পুত্র','ভাই','বোন','বাবা','মা','বন্ধুটি']);
  const isGendered = q => String(q).split(/[\s,।;:!?"“”‘’'()\-—–…]+/).some(w => GENDERED_WORDS.has(w));

  const rand = n => Math.floor(Math.random() * n);
  const pick = a => a[rand(a.length)];
  function pickTheme() {
    const total = THEMES.reduce((s, t) => s + t.w, 0);
    let r = Math.random() * total;
    for (const t of THEMES) { if ((r -= t.w) < 0) return t; }
    return THEMES[0];
  }
  function buildPrompt(theme) {
    const imgs = [pick(IMAGERY), pick(IMAGERY)].filter((v, i, a) => a.indexOf(v) === i);
    const nonce = Math.random().toString(36).slice(2, 10);
    const system =
      `তুমি একজন দক্ষ বাংলা সাহিত্যিক ও চিন্তক। প্রতিটি অনুরোধে সম্পূর্ণ মৌলিক ও নতুন একটি উক্তি লেখো।\n` +
      `নিয়ম:\n` +
      `- ভাষা: সুন্দর, স্বাভাবিক বাংলা। ১–২টি বাক্য, সর্বোচ্চ ৩০ শব্দ।\n` +
      `- লিঙ্গ-নিরপেক্ষ: কোনো লিঙ্গ নির্দেশ করবে না। ছেলে/মেয়ে/পুরুষ/নারী/প্রেমিক/প্রেমিকা/স্বামী/স্ত্রী/ভাই/বোন ইত্যাদি লিখবে না। "মানুষ", "মন", "হৃদয়", "আমরা", "তুমি", "কেউ" — এ ধরনের নিরপেক্ষ শব্দ ব্যবহার করো।\n` +
      `- জনপ্রিয় বা পরিচিত উক্তি, কোনো লেখকের লাইন বা প্রবাদ হুবহু দেবে না; কারও নামে চালাবে না।\n` +
      `- ক্লিশে (যেমন "জীবন একটি যাত্রা") এড়াও।\n` +
      `শুধু JSON ফেরত দাও: {"quote":"..."}`;
    const user =
      `ধরন: ${theme.brief}\nসুর: ${pick(TONES)}\nসম্ভব হলে এই চিত্রকল্প থেকে অনুপ্রেরণা নাও: ${imgs.join(', ')}\nঅনন্য সংকেত: ${nonce}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }
  function extract(raw) {
    const p = typeof safeParseAIJson === 'function' ? safeParseAIJson(raw, null) : null;
    let q = p && typeof p === 'object' ? (p.quote || p.text || p['উক্তি'] || '') : '';
    if (!q && typeof raw === 'string') {
      const m = raw.match(/"quote"\s*:\s*"((?:[^"\\]|\\.)*)/);   // JSON ভাঙা/অর্ধেক হলেও quote তুলে আনি
      if (m) { try { q = JSON.parse('"' + m[1] + '"'); } catch (_) { q = m[1]; } }
      else if (!raw.trim().startsWith('{') && !raw.trim().startsWith('[')) q = raw;
    }
    if (typeof q !== 'string') q = '';
    return String(q || '').replace(/^["“”«»\s]+|["“”«»\s]+$/g, '').trim();
  }
  // মূল জেনারেশনের সারি (requestGate), ব্যর্থতার কুলডাউন ও model-switch এড়াতে সরাসরি callAIAPIRaw ব্যবহার করা হয়।
  async function _callIsolated(messages) {
    const opts = { forceJson: true, temperature: 1.0 };
    if (typeof callAIAPIRaw === 'function' && typeof getActiveAIModel === 'function') {
      const cfg = getActiveAIModel();
      if (cfg) {
        let prevCtl, hasCtl = false;
        try { prevCtl = activeRequestAbortController; hasCtl = true; } catch (_) {}
        // উক্তির জন্য Google Search grounding দরকার নেই (ধীর, আর JSON-এর বদলে সার্চ-মেশানো লেখা আসতে পারে)
        const p = callAIAPIRaw(messages, { ...opts, modelConfig: { ...cfg, enableGoogleSearch: false }, bypassThinkingCooldown: true });
        // callAIAPIRaw নিজের AbortController বসায়; সঙ্গে সঙ্গে আগেরটা ফিরিয়ে দিই যাতে মূল কাজের Cancel ঠিক থাকে
        if (hasCtl) { try { activeRequestAbortController = prevCtl; } catch (_) {} }
        return p;
      }
    }
    return callAIAPI(messages, opts);
  }

  // প্রতিবার নতুন AI কল। কিছু সেভ হয় না।
  async function generate() {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const theme = pickTheme();
        const res = await _callIsolated(buildPrompt(theme));
        const q = extract(res && res.content);
        if (q && q.length >= 12 && !isGendered(q)) return { text: q, theme: theme.id };
        lastErr = new Error('উত্তর ব্যবহারযোগ্য নয়: ' + String(res && res.content).slice(0, 120));
      } catch (e) {
        lastErr = e;
        console.warn('[AIQuote] attempt ' + (attempt + 1) + ' failed:', e && e.message);
        if (e && (e.kind === 'cancelled' || e.name === 'AbortError')) break;
      }
    }
    if (lastErr) console.warn('[AIQuote] failed:', lastErr.message || lastErr);
    return null;
  }

  // একই element-এ দ্রুত বারবার খুললে পুরোনো (দেরিতে আসা) উত্তর যেন নতুনটাকে ঢেকে না দেয়
  const _tokens = new WeakMap();
  async function mount(el, { loadingText = '✨ নতুন উক্তি তৈরি হচ্ছে…' } = {}) {
    if (!el) return;
    const token = Symbol('quote');
    _tokens.set(el, token);
    el.textContent = loadingText;          // পুরোনো উক্তি সঙ্গে সঙ্গে মুছে যায়
    el.dataset.quoteTheme = '';
    try {
      const q = await generate();
      if (_tokens.get(el) !== token || !el.isConnected) return;   // ততক্ষণে নতুন অনুরোধ হয়েছে
      if (q) { el.textContent = q.text; el.dataset.quoteTheme = q.theme; }
      else el.textContent = '';
    } catch (e) {
      if (_tokens.get(el) === token) el.textContent = '';
      console.warn('[AIQuote] failed:', e && e.message);
    }
  }
  return { generate, mount };
})();
if (typeof window !== 'undefined') window.AIQuote = AIQuote;