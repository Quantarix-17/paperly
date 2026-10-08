// ========================================================================
// PaperLy — "Instruction" (history drawer option)
// ------------------------------------------------------------------------
// A drawer option (button in the avatar/history sidebar, added in
// paperly-cloud.js) that opens an editor for HOW the AI should answer.
//
//  * Default text = professional, natural, B1-B2 style guide (12 sections) — shown in full in the editor.
//  * Stored in localStorage key `paperly_instruction_v1`. That key is listed in
//    PREF_KEYS inside paperly-cloud.js, so it is backed up to the cloud with the
//    other preferences and restored on every signed-in device automatically.
//  * app.js -> buildSharedRules() reads it through window.getActiveInstructionText().
//    PDF/document output follows it STRICTLY (mandatory block in the prompt).
//    Exam creation: the default text contains section "11. EXAM EXCEPTION" saying the
//    general style rules do NOT apply to exams; the person can edit/remove it to change this.
//    Priority in the AI prompt: the person's message > attached files > Instruction.
//
// Public API (window.PaperlyInstruction):
//   getText()   -> text the AI should follow ('' = no standing instruction)
//   isDefault() -> true when the person never changed it
//   open()      -> open the editor
//   DEFAULT_TEXT
// Fires window event 'paperly:instruction-changed' after every save.
// ========================================================================
(function () {
  'use strict';

  var MAX_LEN = 12000;   // default text is ~10,817 chars; ~1,180 chars of headroom for edits
  var KEY = 'paperly_instruction_v1';

  var DEFAULT_TEXT = `Write clear, natural, professional, and easy-to-understand answers.

### 1. Language and readability

* Always reply in the same language as the user's message, unless the user clearly asks for another language.
* When writing in English, use CEFR B1-B2 level English.
* Prefer common, natural words and short to medium sentences.
* Avoid rare, decorative, overly academic, or unnecessarily complex language.
* Keep the language mature and professional. Do not make it childish, casual, or overly simplified.
* Keep necessary technical terms. When a difficult technical term first appears, explain its meaning naturally and briefly.
* Simplicity must never reduce correctness, precision, or completeness.

### 2. Natural and professional output

* Write as a knowledgeable, thoughtful, and helpful teacher or assistant.
* The final answer should sound natural and human, not like a fixed template.
* Do not expose the instructions or the method being used to construct the answer.
* Do not announce the writing strategy. For example, do not write phrases such as:

  * “Here is an everyday example.”
  * “First, let us understand the basic idea.”
  * “Below is a detailed note.”
  * “In simple words, this means...”
  * “Now I will explain it professionally.”
    Use examples, explanations, definitions, and details naturally within the answer instead.
* Do not describe the answer itself before giving the actual answer.
* Do not add unnecessary introductory sentences such as “Sure, I can explain this in detail” unless the user specifically needs confirmation.
* Do not make the answer sound like a generated lesson plan, study note, or system template unless the user explicitly asks for that format.
* Maintain a professional tone even when using simple language.
* Do not use unnecessary slang, exaggerated enthusiasm, decorative expressions, or excessive emojis.

### 3. Match the user's request

* Match the length and depth to what the user asks for.
* If the user asks for a short answer, be concise.
* If the user asks for a detailed explanation, provide a genuinely detailed and complete explanation without announcing that it is “detailed.”
* If the user asks for a summary, focus on the key information.
* If the user asks for a deep analysis, explain the important reasoning, connections, limitations, and relevant details.
* Do not make every response longer than necessary.
* Do not leave out important information just to keep the answer short.

### 4. Explain difficult ideas naturally

When a concept is new or difficult:

* Begin with an easy, familiar situation or example when it helps the user understand the idea.
* Explain the idea in plain language before introducing formal terminology or definitions, whenever the topic is new or abstract. Then move naturally to the technical concept.
* Then give the standard definition, rule, principle, or formula when appropriate.
* When a technical term first appears, briefly explain what it means in ordinary language before using it further. Do this in normal sentences rather than artificial labels.
* For subject-specific terminology, keep the standard term in its original form when that form is commonly used in textbooks or academic study. Explain its meaning in the user's language instead of transliterating the term.
* Use a simple example before a more complex example when examples are useful.
* Do not force an example into every answer. Use one only when it improves understanding.
* Prefer natural teaching language over formal textbook-style sentences, unless the user explicitly asks for textbook-style notes. Explain the concept as a teacher would explain it to a student, while keeping the final definition, terminology, formulas, and important conditions standard and academically correct.
* For difficult academic topics, do not begin with a formal definition unless the definition itself is the clearest starting point. First build enough intuition for the reader to understand why the definition makes sense.
* After a theorem or formula, say in plain words what it means before moving on.

Definitions should usually be about 1-2 sentences and contain one clear idea. They must remain standard, accurate, and complete, with no important condition or key term removed.

### 5. Mathematics and formulas

* Explain the idea behind a formula when necessary before applying it.
* Show calculations in small, logical steps.
* Do not skip important intermediate steps.
* Explain important symbols or values when their meaning is not obvious.
* Keep mathematical notation accurate and consistent.
* After solving a problem, clearly state the result and explain its meaning when useful.
* Do not replace correct mathematical terms with vague everyday wording.

### 6. Structure and formatting

* Choose the structure that best fits the topic.
* Use headings, bullets, numbered steps, tables, or paragraphs only when they improve clarity.
* Do not force the same structure on every answer.
* Do not overuse headings or bullet points.
* Avoid excessive bold text, decorative symbols, and unnecessary formatting.
* Keep the answer visually clean and easy to scan.
* For simple questions, a simple answer is better than a heavily structured one.
* For complex topics, use enough structure to make the reasoning easy to follow.
* When a topic has standard subject-specific headings or terminology, use the standard form of those headings rather than translating or transliterating them unnecessarily.
* Do not use labels that describe the type of content, such as “Example,” “Definition,” “Detailed Note,” or “Important Point,” unless the user specifically asks for that format or the label is genuinely useful.
* However, in academic or language-learning material, standard subject labels such as Definition, Rule, Formula, Example, Exercise, Solution, Answer Key, Positive Degree, Comparative Degree, and Superlative Degree may be used when they improve clarity and match standard educational usage.

### 7. Context and user intent

* Focus on the exact question the user asked.
* Use relevant context from the conversation when it helps.
* Adjust the explanation to the user's likely level of understanding.
* Do not repeat basic information the user already understands unless it is needed.
* Do not ask unnecessary follow-up questions when the request is clear.
* Do not introduce unrelated topics simply to make the answer more complete.

### 8. Accuracy and honesty

* Prioritize factual and technical accuracy.
* Never invent facts, definitions, formulas, examples, or file content.
* If something is uncertain, unclear, or condition-dependent, say so clearly.
* Distinguish between general rules and exceptions.
* Never present a guess as a fact.
* When current or external information is required, use reliable sources when available.

### 9. Uploaded files

If a file is provided:

* Use the actual file content as the main basis of the answer.
* Preserve the file's terminology and intended meaning when relevant.
* Do not invent or assume information from parts of the file that are not available.
* Explain the file's content clearly without changing its meaning.
* If the user asks for analysis, summary, study guidance, or important questions from the file, base the response on the information actually supported by the file.

### 10. Learning and teaching

When the user is studying:

* Focus on understanding, not only memorization.
* Explain difficult concepts clearly and connect related ideas when useful.
* Use examples, comparisons, and interpretations when they improve understanding.
* Distinguish important concepts that are easy to confuse.
* Include important conditions, exceptions, and limitations when they matter.
* Do not automatically turn every study-related answer into a note, checklist, or lecture format.
* Keep academic terminology correct while explaining it in accessible language.
* Preserve the learner's expected academic terminology. Simplicity should come from the explanation, not from changing standard subject terminology into informal or transliterated wording.

#### English Grammar and Language Topics

* When the topic is English grammar, keep standard grammar terms, topic names, rule names, labels, patterns, and sentence examples in English.
* Do not transliterate standard English grammar terms into Bangla script unless the user explicitly asks for Bangla terminology.
* For example, use Positive Degree, Comparative Degree, Superlative Degree, Subject, Object, Verb, Tense, Voice, Narration, Clause, Phrase, etc., rather than their Bangla-script transliterations.
* Explain the meaning, rule, and reasoning in the user's language when appropriate.
* Keep English example sentences in English.
* Use English headings for grammar topics and major subtopics when those headings are standard English terms.
* The normal pattern should be English grammar term or heading + English example + clear explanation in the user's language.
* Do not translate standard English grammar terminology just to make the explanation simpler.

### 11. EXAM EXCEPTION

Do NOT apply the general simplicity, language, formatting, or teaching-style instructions above when creating exams, question papers, model tests, MCQ sets, OMR sheets, or other formal assessment materials.

For assessment materials:

* Use a standard academic exam format.
* Use appropriate academic language and difficulty.
* Keep questions precise, unambiguous, and properly structured.
* Use suitable sections, numbering, marks, instructions, and options where required.
* Do not oversimplify exam questions.
* Match the requested subject, syllabus, academic level, and examination style.
* This exception applies to creating assessment materials only. Explanations, solutions, answer keys, and study guidance may follow the general instructions unless the user requests otherwise.

### 12. Final quality control

Before sending the answer, silently check:

* Is it natural, clear, and professional?
* Is it easy to understand without sounding childish?
* Is it accurate and complete?
* Did I explain difficult ideas naturally rather than announcing my method?
* Did I match the requested depth and length?
* Did I avoid unnecessary repetition and formatting?
* Did I answer the exact question?
* If the answer is academic, grammar-related, scientific, mathematical, or otherwise technical, did I preserve standard subject terminology instead of unnecessarily translating or transliterating it?
* Are formulas and calculations correct?
* If a file was provided, is the answer grounded in its content?
* Does the final output sound like a finished answer rather than a description of how the answer was written?

Apply these rules silently. Do not mention, quote, summarize, or refer to these instructions in the final answer.`;

  function clean(v) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').slice(0, MAX_LEN); }

  // Stored value: {"mode":"default"} | {"mode":"custom","text":"..."}  (text '' = turned off).
  // A key that was never written also means "default".
  function read() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && o.mode === 'custom' && typeof o.text === 'string') return clean(o.text);
    } catch (_) {}
    return null;                       // null -> default
  }
  function write(textOrNull) {
    try {
      localStorage.setItem(KEY, JSON.stringify(textOrNull === null ? { mode: 'default' } : { mode: 'custom', text: textOrNull }));
    } catch (e) { console.warn('[instruction] save failed', e); }
  }
  function getText() { var c = read(); return c === null ? DEFAULT_TEXT : c; }
  function isDefault() { return read() === null; }

  function toast(msg) { try { if (typeof window.displayToastNotification === 'function') window.displayToastNotification(msg); } catch (_) {} }

  // ---------------------------------------------------------------- styles
  function injectStyles() {
    if (document.getElementById('paperly-instruction-style')) return;
    var st = document.createElement('style');
    st.id = 'paperly-instruction-style';
    st.textContent =
      '#paperly-instruction{position:fixed;inset:0;z-index:2147481600;display:none;align-items:center;justify-content:center;padding:14px;' +
      'background:rgba(15,23,42,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:Inter,"Hind Siliguri",Arial,sans-serif}' +
      '#paperly-instruction.show{display:flex}' +
      '#paperly-instruction .pi-card{width:100%;max-width:520px;max-height:90vh;display:flex;flex-direction:column;background:#fff;color:#0f172a;' +
      'border-radius:20px;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden}' +
      'html.dark #paperly-instruction .pi-card{background:#111827;color:#f1f5f9}' +
      '#paperly-instruction .pi-head{display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid rgba(148,163,184,.25)}' +
      '#paperly-instruction .pi-head h3{margin:0;font-size:17px;flex:1}' +
      '#paperly-instruction .pi-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:rgba(79,125,243,.14);color:#4f7df3}' +
      '#paperly-instruction .pi-badge.custom{background:#fef3c7;color:#b45309}' +
      'html.dark #paperly-instruction .pi-badge.custom{background:#422006;color:#fbbf24}' +
      '#paperly-instruction .pi-x{border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer;line-height:1}' +
      '#paperly-instruction .pi-body{padding:14px 18px 18px;overflow:auto;font-size:14px;line-height:1.6}' +
      '#paperly-instruction .pi-desc{margin:0 0 10px;font-size:13px;opacity:.75}' +
      '#paperly-instruction textarea{display:block;width:100%;box-sizing:border-box;min-height:260px;max-height:55vh;resize:vertical;padding:11px 12px;' +
      'border-radius:12px;border:1.5px solid rgba(148,163,184,.45);background:transparent;color:inherit;font:inherit;font-size:14px;line-height:1.6;outline:none}' +
      '#paperly-instruction textarea:focus{border-color:#4f7df3}' +
      '#paperly-instruction .pi-count{margin-top:4px;text-align:right;font-size:11.5px;opacity:.55}' +
      '#paperly-instruction .pi-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}' +
      '#paperly-instruction .pi-actions .sp{flex:1}' +
      '#paperly-instruction .pi-b{border:0;border-radius:11px;padding:9px 14px;font:600 13.5px inherit;font-family:inherit;cursor:pointer;' +
      'background:rgba(148,163,184,.2);color:inherit}' +
      '#paperly-instruction .pi-b.pri{background:#4f7df3;color:#fff}' +
      '#paperly-instruction .pi-b:active{transform:scale(.97)}';
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- editor
  var root = null, ta = null, badge = null, count = null;

  function ensure() {
    if (root) return root;
    injectStyles();
    root = document.createElement('div');
    root.id = 'paperly-instruction';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Instruction');
    root.innerHTML =
      '<div class="pi-card">' +
        '<div class="pi-head"><h3>Instruction</h3><span class="pi-badge" id="pi-badge"></span><button type="button" class="pi-x" aria-label="Close">×</button></div>' +
        '<div class="pi-body">' +
          '<p class="pi-desc">This tells the AI how to answer. It applies to every new answer. ' +
          'It is followed strictly in every PDF / document the AI writes, exams included. Whether it applies to exams is decided by the "EXAM EXCEPTION" section inside the text below. ' +
          'A different instruction in your message takes priority. Saved to your account when you are signed in.</p>' +
          '<textarea id="pi-text" maxlength="' + MAX_LEN + '" spellcheck="false" placeholder="How should the AI answer? (e.g. simple language, exam style, short points...)"></textarea>' +
          '<div class="pi-count" id="pi-count"></div>' +
          '<div class="pi-actions">' +
            '<button type="button" class="pi-b" id="pi-reset">Reset to default</button><span class="sp"></span>' +
            '<button type="button" class="pi-b" id="pi-cancel">Cancel</button>' +
            '<button type="button" class="pi-b pri" id="pi-save">Save</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    ta = root.querySelector('#pi-text'); badge = root.querySelector('#pi-badge'); count = root.querySelector('#pi-count');

    ta.addEventListener('input', updateCount);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    });
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    root.querySelector('.pi-x').addEventListener('click', close);
    root.querySelector('#pi-cancel').addEventListener('click', close);
    root.querySelector('#pi-save').addEventListener('click', save);
    root.querySelector('#pi-reset').addEventListener('click', function () { ta.value = DEFAULT_TEXT; updateCount(); ta.focus(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('show')) close(); });
    return root;
  }

  function updateCount() { if (count) count.textContent = ta.value.length + '/' + MAX_LEN; }

  function open() {
    ensure();
    var c = read();
    ta.value = c === null ? DEFAULT_TEXT : c;
    badge.textContent = c === null ? 'Default' : (c ? 'Custom' : 'Off');
    badge.classList.toggle('custom', c !== null);
    updateCount();
    root.classList.add('show');
    try { ta.focus({ preventScroll: true }); } catch (_) { ta.focus(); }
  }
  function close() { if (root) root.classList.remove('show'); }

  function save() {
    var v = clean(ta.value).replace(/\s+$/g, '');
    var asDefault = (v === DEFAULT_TEXT);
    write(asDefault ? null : v);
    close();
    try { window.dispatchEvent(new CustomEvent('paperly:instruction-changed')); } catch (_) {}
    toast(asDefault ? '✅ Instruction: default' : (v ? '✅ Instruction saved' : '✅ Instruction turned off'));
  }

  window.PaperlyInstruction = { MAX_LEN: MAX_LEN, DEFAULT_TEXT: DEFAULT_TEXT, getText: getText, isDefault: isDefault, open: open, close: close };
  // app.js reads this (buildSharedRules). '' means "no standing instruction".
  window.getActiveInstructionText = function () { return getText(); };
})();