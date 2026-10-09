// ========================================================================
// CODE HIGHLIGHT - fixed dark "VS Code Dark+" theme for code + output blocks
// ------------------------------------------------------------------------
// The AI only writes PLAIN code:
//   <pre class="code-block" data-lang="python"><code>...plain code...</code></pre>
//   <pre class="code-output"><code>...plain output...</code></pre>
// injectCodeBlocks(html) (called from sanitizeHTML in app.js) turns those
// into fully coloured blocks. Works for any language (generic tokenizer).
// Load this file BEFORE app.js.
// ========================================================================
(function () {
  'use strict';

  var KEYWORDS = new Set((
    // control / declarations (union across common languages)
    'if else elif elseif switch case default for foreach while do break continue return yield ' +
    'try catch except finally throw throws raise with as from import export package using namespace include require ' +
    'def function fn func lambda class struct enum interface trait impl extends implements abstract final static ' +
    'public private protected internal virtual override async await new delete typeof instanceof in of is not and or ' +
    'var let const val mut pub use mod where select insert update create table into values join on group order by having ' +
    'int float double long short char byte bool boolean string void unsigned signed auto extern volatile ' +
    'self this super global nonlocal pass del assert defer go chan map range goto type module end begin then fi done echo'
  ).split(/\s+/));

  var LITERALS = new Set('true false null none nil undefined True False None NULL NaN Infinity'.split(/\s+/));

  var HASH_COMMENT_LANGS = new Set(['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'ruby', 'rb', 'perl', 'yaml', 'yml', 'r', 'powershell', 'ps1', 'toml', 'ini', 'makefile', 'dockerfile', 'text']);
  var DASH_COMMENT_LANGS = new Set(['sql', 'lua', 'haskell', 'hs']);

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function span(cls, s) {
    return '<span class="' + cls + '">' + esc(s) + '</span>';
  }

  function highlightCode(code, lang) {
    lang = String(lang || '').toLowerCase().trim();
    if (lang === 'plain' || lang === 'plaintext' || lang === 'txt') return esc(code);

    var isMarkup = /^(html|xml|svg|xhtml|jsx|tsx|vue)$/.test(lang);
    var isCss = /^(css|scss|sass|less)$/.test(lang);
    var isJson = lang === 'json';
    var hashComments = HASH_COMMENT_LANGS.has(lang) || (!lang && /^\s*#(?!include|define|pragma|!)/m.test(code) && !/[{};]\s*$/m.test(code));
    var dashComments = DASH_COMMENT_LANGS.has(lang);
    var slashComments = !hashComments && !dashComments && !isMarkup;
    var ci = /^(sql)$/.test(lang);

    var out = '';
    var i = 0, n = code.length;

    while (i < n) {
      var ch = code[i], rest2 = code.substr(i, 2);

      // HTML / XML comments & tags
      if (isMarkup) {
        if (code.startsWith('<!--', i)) {
          var ce = code.indexOf('-->', i + 4); ce = ce < 0 ? n : ce + 3;
          out += span('tok-comment', code.slice(i, ce)); i = ce; continue;
        }
        if (ch === '<' && /[A-Za-z\/!?]/.test(code[i + 1] || '')) {
          var te = code.indexOf('>', i); te = te < 0 ? n : te + 1;
          var tag = code.slice(i, te);
          var m = tag.match(/^(<\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?>)$/);
          if (m) {
            out += span('tok-punct', m[1]) + span('tok-tag', m[2]);
            out += m[3].replace(/([\w:@.-]+)(\s*=\s*)("[^"]*"|'[^']*')|([\w:@.-]+)|(\s+)/g, function (_, a, eq, v, bare, ws) {
              if (a) return span('tok-attr', a) + span('tok-punct', eq) + span('tok-string', v);
              if (bare) return span('tok-attr', bare);
              return esc(ws);
            });
            out += span('tok-punct', m[4]);
          } else out += esc(tag);
          i = te; continue;
        }
        out += esc(ch); i++; continue;
      }

      // comments
      if (slashComments && rest2 === '//') {
        var e1 = code.indexOf('\n', i); e1 = e1 < 0 ? n : e1;
        out += span('tok-comment', code.slice(i, e1)); i = e1; continue;
      }
      if ((slashComments || isCss) && rest2 === '/*') {
        var e2 = code.indexOf('*/', i + 2); e2 = e2 < 0 ? n : e2 + 2;
        out += span('tok-comment', code.slice(i, e2)); i = e2; continue;
      }
      if (hashComments && ch === '#') {
        var e3 = code.indexOf('\n', i); e3 = e3 < 0 ? n : e3;
        out += span('tok-comment', code.slice(i, e3)); i = e3; continue;
      }
      if (dashComments && rest2 === '--') {
        var e4 = code.indexOf('\n', i); e4 = e4 < 0 ? n : e4;
        out += span('tok-comment', code.slice(i, e4)); i = e4; continue;
      }
      // C-style preprocessor lines (#include, #define ...)
      if (!hashComments && ch === '#' && /^\s*$/.test(code.slice(code.lastIndexOf('\n', i - 1) + 1, i)) && /^#\s*[a-z]+/.test(code.substr(i, 12))) {
        var e5 = code.indexOf('\n', i); e5 = e5 < 0 ? n : e5;
        out += span('tok-keyword2', code.slice(i, e5)); i = e5; continue;
      }

      // strings (incl. triple quotes, template literals)
      if (ch === '"' || ch === "'" || ch === '`') {
        var q = ch, j = i + 1;
        if ((q === '"' || q === "'") && code.substr(i, 3) === q + q + q) {
          var te2 = code.indexOf(q + q + q, i + 3); te2 = te2 < 0 ? n : te2 + 3;
          out += span('tok-string', code.slice(i, te2)); i = te2; continue;
        }
        while (j < n && code[j] !== q) {
          if (code[j] === '\\') j++;
          if (code[j] === '\n' && q !== '`') break;
          j++;
        }
        j = Math.min(j + 1, n);
        // JSON keys get the property colour
        var isKey = isJson && /^\s*:/.test(code.slice(j));
        out += span(isKey ? 'tok-attr' : 'tok-string', code.slice(i, j)); i = j; continue;
      }

      // numbers
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] || '') && !/[\w$]/.test(code[i - 1] || ''))) {
        var nm = code.slice(i).match(/^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|\.\d+)[a-zA-Z]*/);
        if (nm && !/[\w$]/.test(code[i - 1] || '')) { out += span('tok-number', nm[0]); i += nm[0].length; continue; }
      }

      // identifiers
      if (/[A-Za-z_$@]/.test(ch)) {
        var im = code.slice(i).match(/^[@$]?[A-Za-z_][\w$]*/);
        var word = im ? im[0] : ch;
        var key = ci ? word.toLowerCase() : word;
        var next = code.slice(i + word.length).match(/^\s*(.)/);
        var prevWord = (out.match(/(?:^|[^\w])(class|def|function|fn|func|struct|enum|interface|new|extends|implements)\s*(?:<\/span>)?\s*$/) || [])[1];
        if (LITERALS.has(word)) out += span('tok-literal', word);
        else if (KEYWORDS.has(key)) out += span('tok-keyword', word);
        else if (isCss && /^[a-z-]+$/.test(word) && next && next[1] === ':') out += span('tok-attr', word);
        else if (prevWord) out += span(/^(def|function|fn|func)$/.test(prevWord) ? 'tok-func' : 'tok-type', word);
        else if (next && next[1] === '(') out += span('tok-func', word);
        else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && word.length > 1 && !/^[A-Z0-9_]+$/.test(word)) out += span('tok-type', word);
        else if (/^[A-Z][A-Z0-9_]+$/.test(word)) out += span('tok-const', word);
        else out += span('tok-var', word);
        i += word.length; continue;
      }

      out += esc(ch); i++;
    }
    return out;
  }

  // Decode the text content of a <code> element back to plain text.
  function plainText(el) { return el.textContent || ''; }

  // Light, language-neutral colouring for program OUTPUT (errors, ok lines, numbers)
  function highlightOutput(text) {
    return text.split('\n').map(function (line) {
      var e = esc(line);
      if (/^\s*(\$|>>>|>|#)\s/.test(line)) {
        return e.replace(/^(\s*)(\$|&gt;&gt;&gt;|&gt;|#)(\s)/, '$1<span class="tok-prompt">$2</span>$3');
      }
      if (/(error|exception|traceback|fatal|failed)\b/i.test(line)) return '<span class="out-error">' + e + '</span>';
      if (/\b(warning|warn)\b/i.test(line)) return '<span class="out-warn">' + e + '</span>';
      if (/\b(success|passed|done|ok)\b/i.test(line)) return '<span class="out-ok">' + e + '</span>';
      return e;
    }).join('\n');
  }

  var LANG_LABELS = {
    py: 'Python', python: 'Python', js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
    java: 'Java', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', go: 'Go', rust: 'Rust', rs: 'Rust',
    php: 'PHP', ruby: 'Ruby', rb: 'Ruby', swift: 'Swift', kotlin: 'Kotlin', sql: 'SQL', html: 'HTML', css: 'CSS',
    json: 'JSON', xml: 'XML', bash: 'Bash', sh: 'Shell', shell: 'Shell', powershell: 'PowerShell', r: 'R',
    yaml: 'YAML', yml: 'YAML', lua: 'Lua', dart: 'Dart', matlab: 'MATLAB'
  };

  // Main entry: HTML string in -> HTML string out.
  function injectCodeBlocks(html) {
    if (!html || html.indexOf('<pre') === -1 && html.indexOf('<code') === -1) return html;
    var tpl = document.createElement('template');
    tpl.innerHTML = html;

    // 1) <pre> blocks
    tpl.content.querySelectorAll('pre').forEach(function (pre) {
      if (pre.closest('.code-frame')) return; // already processed
      var codeEl = pre.querySelector('code') || pre;
      var cls = (pre.className || '') + ' ' + (codeEl.className || '');
      var isOutput = /\bcode-output\b/.test(cls);
      var lang = (pre.getAttribute('data-lang') || '').toLowerCase();
      if (!lang) { var lm = cls.match(/(?:language|lang)-([\w+#-]+)/); if (lm) lang = lm[1].toLowerCase(); }
      var text = plainText(codeEl).replace(/^\n+|\s+$/g, '');

      var frame = document.createElement('div');
      frame.className = 'code-frame ' + (isOutput ? 'code-frame-output' : 'code-frame-source') + (text.split('\n').length > 28 ? ' code-frame-long' : '');
      var bar = document.createElement('div');
      bar.className = 'code-frame-bar';
      var label = isOutput ? 'Output' : (LANG_LABELS[lang] || (lang ? lang.toUpperCase() : 'Code'));
      bar.innerHTML = '<span class="code-frame-dots"><i></i><i></i><i></i></span><span class="code-frame-label">' + esc(label) + '</span>';
      var newPre = document.createElement('pre');
      newPre.className = isOutput ? 'code-output' : 'code-block';
      if (lang) newPre.setAttribute('data-lang', lang);
      var newCode = document.createElement('code');
      newCode.innerHTML = isOutput ? highlightOutput(text) : highlightCode(text, lang);
      newPre.appendChild(newCode);
      frame.appendChild(bar);
      frame.appendChild(newPre);
      pre.replaceWith(frame);
    });

    // 2) inline <code> (outside pre) gets a small fixed dark chip
    tpl.content.querySelectorAll('code').forEach(function (c) {
      if (c.closest('pre')) return;
      c.classList.add('code-inline');
    });

    return tpl.innerHTML;
  }

  // Prompt text for buildSharedRules()
  function getCodeBlockRuleForPrompt() {
    return [
      '=== CODE & PROGRAM OUTPUT BLOCKS (MANDATORY WHENEVER THE DOCUMENT CONTAINS CODE) ===',
      'Whenever ANY source code appears in the document (any programming/markup/query/shell language, even a single line), write it as PLAIN text inside exactly this wrapper — never as a table, never as a normal paragraph, never in a callout box:',
      '<pre class="code-block" data-lang="LANG"><code>...the code, exactly as typed, with real line breaks and indentation...</code></pre>',
      'LANG is a lowercase language name such as python, javascript, java, c, cpp, csharp, html, css, sql, bash, json, php, go, rust, kotlin, swift, r, matlab, plain.',
      'When you need to show what a program PRINTS / what the terminal displays, put it in a SEPARATE block directly under the code:',
      '<pre class="code-output"><code>...the output exactly as printed...</code></pre>',
      'RULES: (1) Do NOT add any <span>, colour, style attribute or syntax markup yourself — the app applies the fixed dark VS Code-style colours automatically. (2) Escape < > & inside code as &lt; &gt; &amp;. (3) Keep indentation exact; one statement per line; no line-number prefixes. (4) Short inline code words inside a sentence use <code>word</code>. (5) Never mix the source and its output in one block. (6) Do not wrap code in markdown ``` fences.'
    ].join('\n    ');
  }

  window.highlightCode = highlightCode;
  window.injectCodeBlocks = injectCodeBlocks;
  window.getCodeBlockRuleForPrompt = getCodeBlockRuleForPrompt;
})();
