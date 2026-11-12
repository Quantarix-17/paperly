/* ============================================================
   Pull-to-refresh (মোবাইল ≤850px) — উপর থেকে নিচে টানলে পেজ রিলোড (Ctrl+R-এর মতো)
   ব্যবহার: index.html-এ app.js-এর পরে  <script src="pull-refresh.js"></script>
   ============================================================ */
(function () {
  'use strict';
  if (window.__pullRefreshInit) return;
  window.__pullRefreshInit = true;

  var THRESHOLD = 70;   // কত px টানলে রিফ্রেশ হবে
  var MAX_PULL  = 96;   // সর্বোচ্চ কতটা নামবে
  var RESIST    = 0.5;  // আঙুলের তুলনায় কতটা ধীরে নামবে

  var mq = window.matchMedia('(max-width: 850px)');
  var ind, startY = 0, startX = 0, pull = 0, tracking = false, locked = false, refreshing = false;

  function build() {
    ind = document.createElement('div');
    ind.id = 'ptr-indicator';
    ind.setAttribute('aria-hidden', 'true');
    ind.innerHTML =
      '<div class="ptr-bubble"><svg class="ptr-arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg><span class="ptr-spinner"></span></div>';
    document.body.appendChild(ind);
  }

  function dbg() { if (window.__ptrDebug) console.log.apply(console, ['[ptr]'].concat([].slice.call(arguments))); }

  // true = এখান থেকে টানলে রিফ্রেশ হবে না
  function blocked(el) {
    if (el && el.nodeType === 3) el = el.parentElement;
    if (!el || !el.closest) return 'no-target';
    if (el.closest('textarea, input, select, [contenteditable="true"], iframe, #at-command-menu, #at-command-menu-backdrop, #topbar-actions.open, .modal-card, #slide-present-overlay, #editor-toolbar, .slide-edit-toolbar, .slide-thumbnail-rail')) return 'excluded-area';
    var ov = document.getElementById('global-progress-overlay');
    if (ov && getComputedStyle(ov).display !== 'none') return 'ai-running';
    // উপরের বার (লোগো/ট্যাব/AI Chat-Editor বার) থেকে টানলে সবসময় চলবে
    if (el.closest('#topbar, #tab-bar, #mobile-nav-bar')) return false;
    // বাকি অংশে: যে স্ক্রলযোগ্য জায়গার ভেতরে টাচ, সেটা একদম উপরে থাকতে হবে
    // (চ্যাট লিস্ট সাধারণত নিচে স্ক্রল করা থাকে, তাই সেখানে আগে উপরে যেতে হবে বা উপরের বার থেকে টানতে হবে)
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n.scrollTop > 0) return 'scrolled-down';
    }
    return false;
  }

  function setPull(px) {
    pull = px;
    var p = Math.min(px / THRESHOLD, 1);
    ind.style.setProperty('--ptr-y', px + 'px');
    ind.style.setProperty('--ptr-p', p);
    ind.classList.toggle('ptr-ready', px >= THRESHOLD);
  }

  function reset() {
    tracking = false; locked = false;
    ind.classList.remove('ptr-pulling');
    ind.classList.add('ptr-snap');
    setPull(0);
    setTimeout(function () { ind.classList.remove('ptr-snap'); }, 260);
  }

  function onStart(e) {
    if (refreshing || e.touches.length !== 1) return;
    if (!mq.matches) { dbg('screen wider than 850px'); return; }
    var why = blocked(e.target);
    if (why) { dbg('blocked:', why); return; }
    dbg('tracking');
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    tracking = true; locked = false;
  }

  function onMove(e) {
    if (!tracking || refreshing) return;
    var t = e.touches[0];
    var dy = t.clientY - startY, dx = t.clientX - startX;
    if (!locked) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { tracking = false; return; } // উপরে/পাশে টানা
      locked = true;
      ind.classList.remove('ptr-snap');
      ind.classList.add('ptr-pulling');
    }
    if (e.cancelable) e.preventDefault();
    setPull(Math.min(dy * RESIST, MAX_PULL));
  }

  function onEnd() {
    if (!tracking) return;
    if (locked && pull >= THRESHOLD) {
      refreshing = true; tracking = false;
      ind.classList.remove('ptr-pulling');
      ind.classList.add('ptr-refreshing');
      ind.style.setProperty('--ptr-y', '64px');
      setTimeout(function () { location.reload(); }, 250);
    } else {
      reset();
    }
  }

  function init() {
    build();
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
