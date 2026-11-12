// ai-quotes.js — প্রতিবার নতুন করে AI দিয়ে ইংরেজি উক্তি তৈরি করে।
// কিছুই সেভ/ক্যাশ করা হয় না (localStorage, array, ইতিহাস — কিছুই নেই)।
// ব্যবহার: modal খোলার সময় AIQuote.mount(document.getElementById('your-quote-element'));
const AIQuote = (() => {
  // ওজন (w): যত বেশি, তত ঘন ঘন আসবে। ক্রম: love > separation > philosophy > question > life।
  const THEMES = [
    { id: 'love',       w: 10, tones: ['gentle', 'warm', 'calm', 'deep'],
      brief: 'A simple but deep line about love: care, waiting, being close, or the feeling of someone touching your heart.' },
    { id: 'separation', w: 7,  tones: ['bittersweet', 'calm', 'deep', 'gentle'],
      brief: 'A simple but deep line about separation: distance, losing someone, words left unsaid, or the quiet after someone leaves.' },
    { id: 'philosophy', w: 5,  tones: ['calm', 'deep', 'firm'],
      brief: 'A philosophical line about time, existence, truth, or a thought that makes people stop and think, in plain words.' },
    { id: 'question',   w: 4,  tones: ['deep', 'calm', 'gentle'],
      brief: 'One question thrown to the reader (about love, losing someone, or the self inside) that does not answer itself and makes the mind wonder.' },
    { id: 'life',       w: 3,  tones: ['calm', 'hopeful', 'firm', 'deep'],
      brief: 'A simple but deep line about life: being alive, growing, or an unexpected truth about time.' }
  ];
  const IMAGERY = ['sky', 'river', 'rain', 'light', 'road', 'sleep', 'season', 'evening', 'wave', 'seed', 'mirror', 'wind', 'clock', 'letter', 'window', 'bird', 'sea', 'mountain', 'lamp', 'silence', 'morning', 'moonlight'];
  // লিঙ্গ নির্দেশ করে এমন ইংরেজি শব্দ ধরার নিরাপত্তা-জাল (শব্দ আলাদা করে মেলানো হয়, তাই "human" বাদ পড়ে না)।
  const GENDERED_WORDS = new Set(['boy','boys','girl','girls','man','men','woman','women','lady','ladies','guy','gentleman','he','him','his','she','her','hers','himself','herself','husband','wife','boyfriend','girlfriend','brother','sister','father','mother','dad','mom','mum','son','daughter','king','queen']);
  const MAX_WORDS = 22;       // প্রম্পটে সর্বোচ্চ ১৫; এর বেশি এলে বাতিল করে আবার চেষ্টা
  const MAX_WORD_LEN = 11;    // খুব লম্বা (কঠিন) শব্দ থাকলে বাতিল — উক্তি সহজ রাখার জন্য
  const wordsOf = q => String(q).toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const isTooLong = q => String(q).trim().split(/\s+/).length > MAX_WORDS;
  const isGendered = q => wordsOf(q).some(w => GENDERED_WORDS.has(w.replace(/'s$/, '')));
  const isTooFancy = q => wordsOf(q).some(w => w.length > MAX_WORD_LEN);
  const isEnglish = q => (String(q).match(/[A-Za-z]/g) || []).length >= String(q).replace(/[\s\W\d_]/g, '').length * 0.9;

  const rand = n => Math.floor(Math.random() * n);
  const pick = a => a[rand(a.length)];
  function pickTheme() {
    const total = THEMES.reduce((s, t) => s + t.w, 0);
    let r = Math.random() * total;
    for (const t of THEMES) { if ((r -= t.w) < 0) return t; }
    return THEMES[0];
  }
  function buildPrompt(theme) {
    const img = pick(IMAGERY);
    const nonce = Math.random().toString(36).slice(2, 10);
    const isQuestion = theme.id === 'question';
    const system =
      `You are a skilled writer and thinker. For every request, write one completely original short quote in English.\n` +
      `Rules:\n` +
      `- Length: short. ${isQuestion ? 'Exactly one short question' : 'Exactly one short sentence'}, at most 15 words.\n` +
      `- Language: English only, using simple everyday words a 12-year-old would understand. No rare, fancy, poetic or old-fashioned words. No long metaphors or heavy imagery.\n` +
      `- Depth: say a true thing or a feeling in very few words, so the reader pauses for a moment.\n` +
      `- Gender-neutral: never point to a gender. Do not write boy, girl, man, woman, he, she, him, her, husband, wife, boyfriend, girlfriend, brother, sister, mother, father and similar words. Use neutral words like "people", "heart", "we", "you", "someone".\n` +
      `- Do not copy a famous quote, a line from any author, or a proverb. Never credit it to anyone.\n` +
      `- Avoid cliches (for example "life is a journey", "time heals all wounds").\n` +
      `Return JSON only: {"quote":"..."}`;
    const user =
      `Type: ${theme.brief}\nTone: ${pick(theme.tones)}\nYou may take inspiration from this word if it fits (do not force it): ${img}\nUnique token: ${nonce}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }
  function extract(raw) {
    const p = typeof safeParseAIJson === 'function' ? safeParseAIJson(raw, null) : null;
    let q = p && typeof p === 'object' ? (p.quote || p.text || '') : '';
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
        if (q && q.length >= 12 && isEnglish(q) && !isTooLong(q) && !isGendered(q) && !isTooFancy(q)) return { text: q, theme: theme.id };
        lastErr = new Error('Unusable answer: ' + String(res && res.content).slice(0, 120));
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
  async function mount(el, { loadingText = '✨ Writing a fresh quote for you…' } = {}) {
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
