// ========================================================================
// EXAM LIBRARY — MCQ + OMR (Compact / Classic / Grid 2×2 / Auto)
// ------------------------------------------------------------------------
// v1.7.0:
//   • ★ নতুন "grid" (২×২ অপশন) OMR টেমপ্লেট — ১০ কলাম/সারি, ২ সারি অপশন
//   • ★ "auto" মোড: জায়গা থাকলে grid (সুন্দর), না হলে compact
//   • Clarify-এ নতুন অপশন: না / চাই (auto) / চাই (গ্রিড) / চাই (কমপ্যাক্ট)
//   • সব স্টাইল exact count দেয় (dynamic bubble sizing)
// ========================================================================
(function () {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;

  const EXAM_LIBRARY = {
    version: '1.7.0',
    enabled: true,

    detect: {
      patterns: [
        'প্রশ্নপত্র', 'question\\s*paper', 'exam\\s*paper', 'এমসিকিউ', '\\bmcqs?\\b',
        'বহুনির্বাচন[িী]', 'বহুপদী', 'মডেল\\s*টেস্ট', 'model\\s*test',
        '(?:পরীক্ষ[াএ]\\S*|exam|test)[^\\n]{0,25}(?:প্রশ্ন|questions?)',
        '(?:প্রশ্ন|questions?)[^\\n]{0,25}(?:পরীক্ষ[াএ]\\S*|exam\\b)',
        'কুইজ', '\\bquiz\\b', 'টিক\\s*প্রশ্ন', '\\btick\\b',
        'ওএমআর', '\\bomr\\b', 'উত্তরপত্র', 'answer\\s*sheet',
        'পরীক্ষা\\s*(?:তৈরি|তৈরী|বানাও|বানান|করো|করুন)',
        '\\b(?:create|make|build|generate|give)\\s+(?:an?\\s+)?(?:exam|test|paper|mcq)'
      ],
      omrOnlyPatterns: [
        'শুধু\\s*(?:একটি\\s*|একটা\\s*)?(?:ওএমআর|ওমআর)',
        '(?:ওএমআর|ওমআর)\\s*শিট\\s*(?:শুধু|মাত্র)',
        '(?:শুধু|মাত্র|একটি|একটা)\\s*(?:ওএমআর|ওমআর)\\s*(?:শিট)?\\s*(?:তৈরি|বানাও|বানিয়ে|বানাতে|দাও|দিন|চাই|করো|করুন)',
        '(?:ওএমআর|ওমআর)\\s*(?:শিট)?\\s*(?:তৈরি\\s*করো|বানাও|বানিয়ে\\s*দাও|দাও|দিন|চাই)',
        '(?:ওএমআর|ওমআর)\\s*(?:শিট)?\\s*(?:তৈরি|বানাও|বানান|বানিয়ে|দাও|দিন|করো|করুন|চাই)',
        '(?:^|[\\s।,.;])(?:only|just)\\s+(?:the\\s+)?(?:an?\\s+)?(?:omr|ওএমআর|ওমআর)',
        '(?:omr|ওএমআর|ওমআর)\\s+(?:only|just)',
        '\\b(?:create|make|generate|build|give|need|want|produce|render)\\s+(?:me\\s+)?(?:an?\\s+)?(?:omr|ওএমআর|ওমআর)(?:\\s+(?:sheet|answer\\s*sheet))?\\b',
        '\\b(?:omr|ওএমআর|ওমআর)\\s+(?:sheet|answer\\s*sheet)\\s*(?:only|just|please|now)?\\s*[.!?]?$',
        '^(?:please\\s+)?(?:create|make|generate|build|give|need|want)\\s+(?:me\\s+)?(?:an?\\s+)?(?:omr|ওএমআর|ওমআর)(?:\\s+(?:sheet|answer\\s*sheet))?\\s*[.!?]?$',
        '^\\s*(?:omr|ওএমআর|ওমআর)\\s*(?:sheet|শিট)?\\s*[.!?]?$'
      ],
      omrNotOnlyPatterns: [
        'প্রশ্ন\\s*(?:সহ|সহকারে|আর|এবং|ও|দিয়ে|সহযোগে)',
        'questions?\\s*(?:with|and|along|plus)',
        '\\d+\\s*(?:টি|টা)?\\s*প্রশ্ন',
        '\\d+\\s*questions?',
        'প্রশ্নপত্র', 'question\\s*paper',
        '\\bquiz\\b', 'কুইজ', '\\btick\\b', 'টিক\\s*প্রশ্ন',
        '\\bmcqs?\\b', 'এমসিকিউ', 'বহুনির্বাচন[িী]'
      ],
      topicFillerWords: [
        'পরীক্ষা','পরীক্ষার','পরীক্ষায়','প্রশ্নপত্র','প্রশ্ন','প্রশ্নের','তৈরি','তৈরী','বানাও','বানিয়ে',
        'বানান','দাও','দিন','করো','কর','করুন','চাই','জন্য','একটি','একটা','ওএমআর','সহ','ছাড়া',
        'পেজ','পৃষ্ঠা','মডেল','টেস্ট','এমসিকিউ','বহুনির্বাচনি','বহুনির্বাচনী','বহুপদী','নির্বাচনী',
        'মানের','মান','টি','টা','নিয়ে','আমাকে','আমার','সহজ','মাঝারি','কঠিন','মিশ্র','যুক্ত','লাগবে',
        'omr','mcq','mcqs','exam','test','model','question','questions','paper','create','make','generate',
        'for','a','an','the','of','with','without','page','pages','easy','medium','hard','mixed',
        'please','need','want','me','on','about','and','quiz','tick','কুইজ','টিক','টিক্চিহ্ন','উত্তরপত্র',
        'শুধু','only','just','sheet','শিট','answer','build','give','produce','render','grid','গ্রিড'
      ]
    },

    defaults: {
      optionsPerQuestion: 4,
      minutesPerQuestion: 1,
      marksPerQuestion: 1,
      showPerQuestionMark: true,
      maxQuestions: 200,
      batchSize: 20,
      shuffleOptions: true,
      includeAnswerKey: false,
      questionsPerPageEstimate: { first: 20, other: 26 },
      countOptionFractions: [0.5, 0.75, 1, 1.25],
      omrOnlyPerPage: { compact: 100, full: 50, grid: 100 }
    },

    layout: {
      pageContentWidthPx: 678,
      pageContentHeightPx: 985,
      columnGapPx: 20,
      columnRule: '1px solid #444',
      fontSizesPt: [10, 9.5, 9, 8.5, 8],
      lineHeight: 1.38,
      questionGapPx: 7,
      optionWideChars: 22,
      titlePt: 15, subtitlePt: 10.5, metaPt: 10.5,
      color: '#111',
      fontStack: "'Times New Roman','Tinos','Liberation Serif',Times,'Kalpurush',serif",

      // কমপ্যাক্ট: ১০ কলাম, স্ট্যাক করা ছোট বৃত্ত
      omrCompact: {
        questionsPerRow: 10, bubblePx: 11, numFontPt: 9,
        gapPx: 2, rowGapPx: 6,
        headerBg: '#dcdcdc', rowShade: '#ededed',
        optionBorderRadius: '3px', optionBorderColor: '#000'
      },

      // ক্লাসিক: দুই কলাম, আড়াআড়ি বড় বৃত্ত
      omrClassic: {
        columns: 2, bubblePx: 26, bubbleFontPt: 13, numFontPt: 16,
        rowGapPx: 10, optionGapPx: 10, numberWidthPx: 32, columnGapPx: 30,
        rowBorder: '1px dotted #ccc', rowPadding: '4px 8px'
      },

      // ★★★ NEW: গ্রিড ২×২ — ১০ কলাম, ২ সারি অপশন (সবচেয়ে সুন্দর) ★★★
      omrGrid: {
        questionsPerRow: 10,
        bubblePx: 26,
        bubbleFontPx: 15,
        numFontPx: 12,
        gapPx: 5,
        rowGapPx: 12,
        cellPaddingPx: 4,
        headerPadPx: 4,
        optionGapPx: 4,
        headerBg: '#dcdcdc',
        rowShade: '#ededed',
        optionBorderColor: '#000'
      },

      omr: { gapBelowQuestionsPx: 8 }
    },

    labels: {
      bn: {
        time: 'সময়', minutes: 'মিনিট', fullMarks: 'পূর্ণমান', perQuestion: 'প্রতিটি প্রশ্নের মান',
        omrTitle: 'OMR উত্তরপত্র', name: 'নাম', roll: 'রোল', cls: 'শ্রেণি', date: 'তারিখ',
        omrNote: 'সঠিক উত্তরের বৃত্তটি কালো কলমে সম্পূর্ণ ভরাট করুন। একটি প্রশ্নে একটির বেশি বৃত্ত ভরাট করবেন না।',
        answerKey: 'উত্তরমালা', options: ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'], digits: '০১২৩৪৫৬৭৮৯'
      },
      en: {
        time: 'Time', minutes: 'minutes', fullMarks: 'Full Marks', perQuestion: 'Marks per question',
        omrTitle: 'OMR Answer Sheet', name: 'Name', roll: 'Roll', cls: 'Class', date: 'Date',
        omrNote: 'Fill the correct bubble completely with a black pen. Do not mark more than one bubble per question.',
        answerKey: 'Answer Key', options: ['A', 'B', 'C', 'D', 'E', 'F'], digits: '0123456789'
      }
    },

    clarify: {
      order: ['pages', 'omr', 'difficulty', 'count'],
      topic: {
        bn: 'কোন বিষয় বা অধ্যায়ের ওপর পরীক্ষার প্রশ্ন তৈরি করব? বিষয়টি লিখে পাঠান।',
        en: 'Which subject or chapter should the exam cover? Please type it.'
      },
      createWhat: {
        bn: 'কী তৈরি করব? নিচের অপশন থেকে বেছে নিন।',
        en: 'What should I create? Please pick one below.'
      },
      createWhatOptions: {
        omrOnly:          { bn: 'শুধু OMR শিট',            en: 'OMR sheet only' },
        questionsOnly:    { bn: 'প্রশ্নপত্র (OMR ছাড়া)',    en: 'Question paper (no OMR)' },
        questionsPlusOmr: { bn: 'প্রশ্ন + OMR',             en: 'Questions + OMR' }
      },
      pages: {
        bn: 'প্রশ্নপত্র কত পেজ জুড়ে তৈরি করব?',
        en: 'How many pages should the question paper span?',
        options: [
          { value: 1, bn: '১ পেজ', en: '1 page' },
          { value: 2, bn: '২ পেজ', en: '2 pages' },
          { value: 3, bn: '৩ পেজ', en: '3 pages' },
          { value: 4, bn: '৪ পেজ', en: '4 pages' }
        ], max: 12
      },
      // ★★★ OMR — auto + grid যোগ ★★★
      omr: {
        bn: 'OMR উত্তরপত্র যুক্ত করতে চান?',
        en: 'Do you want to add an OMR answer sheet?',
        options: [
          { value: 'none',    bn: 'না',                en: 'No' },
          { value: 'auto',    bn: 'চাই',               en: 'Yes' },
          { value: 'grid',    bn: 'চাই (গ্রিড)',       en: 'Yes (grid)' },
          { value: 'compact', bn: 'চাই (কমপ্যাক্ট)',   en: 'Yes (compact)' },
          { value: 'full',    bn: 'চাই (ক্লাসিক)',     en: 'Yes (classic)' }
        ]
      },
      difficulty: {
        bn: 'প্রশ্নের কাঠিন্য মান কেমন হবে?',
        en: 'How difficult should the questions be?',
        options: [
          { value: 'easy',   bn: 'সহজ',                        en: 'Easy' },
          { value: 'medium', bn: 'মাঝারি',                     en: 'Medium' },
          { value: 'hard',   bn: 'কঠিন',                       en: 'Hard' },
          { value: 'mixed',  bn: 'মিশ্র (সহজ + মাঝারি + কঠিন)', en: 'Mixed (easy + medium + hard)' }
        ]
      },
      count: {
        bn: 'মোট কতটি প্রশ্ন তৈরি করব?',
        en: 'How many questions should I create in total?'
      },
      countOmrOnly: {
        bn: 'OMR-এ কতটি প্রশ্নের ঘর থাকবে?',
        en: 'How many question bubbles should the OMR contain?'
      },
      pagesOmrOnly: {
        bn: 'OMR কত পেজ জুড়ে তৈরি করব?',
        en: 'How many pages should the OMR span?',
        options: [
          { value: 1, bn: '১ পেজ', en: '1 page' },
          { value: 2, bn: '২ পেজ', en: '2 pages' },
          { value: 3, bn: '৩ পেজ', en: '3 pages' },
          { value: 4, bn: '৪ পেজ', en: '4 pages' },
          { value: 5, bn: '৫ পেজ', en: '5 pages' }
        ], max: 20
      }
    },

    difficulty: {
      easy:   { label: { bn: 'সহজ', en: 'Easy' },
        guidance: 'EASY: direct recall and basic definitions, single-step, commonly known facts. Distractors clearly different from the answer.' },
      medium: { label: { bn: 'মাঝারি', en: 'Medium' },
        guidance: 'MEDIUM: understanding and simple application, one or two reasoning steps. Distractors plausible but distinguishable.' },
      hard:   { label: { bn: 'কঠিন', en: 'Hard' },
        guidance: 'HARD: competitive/admission level — multi-step reasoning, subtle distinctions, analytical or tricky application. Distractors very plausible (close values, common misconceptions).' },
      mixed:  { label: { bn: 'মিশ্র', en: 'Mixed' }, ratio: { easy: 30, medium: 40, hard: 30 },
        guidance: 'MIXED: spread the questions across easy, medium and hard in the given ratio, shuffled (do not group by difficulty).' }
    },

    subjects: [
      { id: 'bangla', match: ['বাংলা', 'bangla', 'bengali'],
        guidance: 'Bangla language/literature: cover grammar (সন্ধি, সমাস, কারক-বিভক্তি, বাগধারা), literature (author-work, characters, poetry lines) and spelling. Use standard Bangla spelling.' },
      { id: 'english', match: ['ইংরেজি', 'english'],
        guidance: 'English: write the question and options in English (grammar, vocabulary, synonyms/antonyms, fill in the blanks, right form of verbs, prepositions, sentence correction).' },
      { id: 'math', match: ['গণিত', 'math', 'mathematics'],
        guidance: 'Mathematics: keep numbers clean, exactly one correct value, wrong options from typical calculation slips. Write formulas in LaTeX inside $...$ (double-escape backslashes in JSON).' },
      { id: 'physics', match: ['পদার্থ', 'physics'],
        guidance: 'Physics: include units in options, mix conceptual and numerical items, use LaTeX $...$ for formulas.' },
      { id: 'chemistry', match: ['রসায়ন', 'chemistry'],
        guidance: 'Chemistry: use correct symbols/formulas (LaTeX $\\mathrm{H_2O}$ style), balance concept and numerical items.' },
      { id: 'biology', match: ['জীববিজ্ঞান', 'biology'],
        guidance: 'Biology: use standard terminology, include diagram-free conceptual items only.' },
      { id: 'ict', match: ['আইসিটি', 'ict', 'তথ্য ও যোগাযোগ', 'কম্পিউটার', 'computer'],
        guidance: 'ICT: number systems, logic gates, networking, HTML/programming basics, internet — avoid questions that need a figure.' },
      { id: 'gk', match: ['সাধারণ জ্ঞান', 'general knowledge', 'gk', 'বিসিএস', 'bcs', 'নিয়োগ'],
        guidance: 'General knowledge / job-recruitment style: Bangladesh affairs, international affairs, current-affairs-neutral facts, science & tech, mental ability. Use only facts that are stable and verifiable.' },
      { id: 'bd_studies', match: ['বাংলাদেশ ও বিশ্বপরিচয়', 'ইতিহাস', 'history', 'ভূগোল', 'geography', 'পৌরনীতি'],
        guidance: 'History/geography/civics: dates, places, personalities, causes-effects; use only well-established facts.' }
    ],

    promptRules: [
      'You are a professional exam-paper setter for Bangladeshi and international exams. You write ONLY multiple-choice questions (MCQ / বহুনির্বাচনি প্রশ্ন / টিক-প্রশ্ন / কুইজ).',
      'Every question has exactly {OPTIONS} options and exactly ONE correct answer. Never write "none/all of the above" more than once per 20 questions. Options that refer to other options (e.g. "ক ও খ") are allowed only when they are genuinely needed.',
      'Questions must be factually correct, unambiguous and answerable without any figure, image or diagram. Never write a question that needs a picture.',
      'Keep each question stem SHORT (ideally one line, two at most) and each option SHORT (a word, a number, a short phrase) — the paper is printed in a compact two-column format.',
      'Do NOT put numbering in the question text and do NOT put labels like (ক), (A), a), 1. in front of options — the layout adds them automatically.',
      'Do not repeat or paraphrase a question, and spread topics across the whole requested scope.',
      'Distractors must be plausible; do not make the correct option systematically longest or always in the same position.',
      'Write in the language of the user request (Bangla request → Bangla questions, except English-language subjects which are written in English). Use standard spelling.',
      'Math/science formulas go inside $...$ as LaTeX; in the JSON string, escape every backslash (\\\\frac). Plain text otherwise; no HTML, no markdown.',
      'If an attached SOURCE MATERIAL is provided, build the questions from that material only.'
    ],

    sampleQuestions: [
      { q: 'বাংলাদেশের জাতীয় ফুল কোনটি?', options: ['গোলাপ', 'শাপলা', 'কৃষ্ণচূড়া', 'রজনীগন্ধা'], answer: 1 },
      { q: 'কোনটি সন্ধির উদাহরণ?', options: ['নমস্কার', 'সুধাকর', 'হাতঘড়ি', 'পাঠশালা'], answer: 1 },
      { q: 'পানির রাসায়নিক সংকেত কোনটি?', options: ['$\\mathrm{CO_2}$', '$\\mathrm{H_2O}$', '$\\mathrm{NaCl}$', '$\\mathrm{O_2}$'], answer: 1 }
    ],

    templates: {
      // কমপ্যাক্ট (১০ কলাম, স্ট্যাক)
      compactHorizontal: [
        '<div class="omr-grid" style="display:flex;gap:2px;justify-content:space-between;width:100%;">',
        '  <div class="q-col" style="border:1px solid #000;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;flex:1;min-width:0;background:#fff;">',
        '    <div class="q-number" style="background:#dcdcdc;text-align:center;font-weight:bold;font-size:9px;padding:2px 0;border-bottom:1px solid #000;line-height:1.1;">১</div>',
        '    <div class="options" style="display:flex;flex-direction:column;padding:2px 1px;gap:1.5px;">',
        '      <div class="opt-row" style="background:#ededed;"><div class="circle" style="width:11px;height:11px;border:1px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:bold;background:#fff;">ক</div></div>',
        '      <div class="opt-row"><div class="circle" style="width:11px;height:11px;border:1px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:bold;background:#fff;">খ</div></div>',
        '      <div class="opt-row" style="background:#ededed;"><div class="circle" style="width:11px;height:11px;border:1px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:bold;background:#fff;">গ</div></div>',
        '      <div class="opt-row"><div class="circle" style="width:11px;height:11px;border:1px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:bold;background:#fff;">ঘ</div></div>',
        '    </div>', '  </div>', '  <!-- এভাবে ১০টি q-col পাশাপাশি -->', '</div>'
      ].join('\n'),

      // ★★★ NEW: গ্রিড ২×২ (১০ কলাম × ২ সারি অপশন) ★★★
      compactGrid2x2: [
        '<div class="omr-grid" style="display:flex;gap:5px;justify-content:space-between;width:100%;margin-bottom:12px;">',
        '  <div class="q-col" style="border:1.5px solid #000;border-radius:5px;overflow:hidden;display:flex;flex-direction:column;flex:1;min-width:0;background:#fff;">',
        '    <div class="q-number" style="background:#dcdcdc;text-align:center;font-weight:bold;font-size:12px;padding:4px 0;border-bottom:1.5px solid #000;line-height:1.1;">১</div>',
        '    <div class="options" style="display:grid;grid-template-columns:1fr 1fr;padding:4px;row-gap:4px;column-gap:4px;">',
        '      <div class="opt-row-top" style="display:flex;align-items:center;justify-content:center;padding:4px 0;border-radius:4px;background:#ededed;"><div class="circle" style="width:26px;height:26px;border:1.4px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:bold;background:#fff;">ক</div></div>',
        '      <div class="opt-row-top" style="display:flex;align-items:center;justify-content:center;padding:4px 0;border-radius:4px;background:#ededed;"><div class="circle" style="width:26px;height:26px;border:1.4px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:bold;background:#fff;">খ</div></div>',
        '      <div class="opt-row-bottom" style="display:flex;align-items:center;justify-content:center;padding:4px 0;border-radius:4px;background:#fff;"><div class="circle" style="width:26px;height:26px;border:1.4px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:bold;background:#fff;">গ</div></div>',
        '      <div class="opt-row-bottom" style="display:flex;align-items:center;justify-content:center;padding:4px 0;border-radius:4px;background:#fff;"><div class="circle" style="width:26px;height:26px;border:1.4px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:bold;background:#fff;">ঘ</div></div>',
        '    </div>', '  </div>',
        '  <!-- এভাবে ১০টি q-col পাশাপাশি, প্রতিটি সারিতে ১০টি প্রশ্ন -->', '</div>',
        '<div class="omr-grid" style="display:flex;gap:5px;justify-content:space-between;width:100%;">',
        '  <!-- সারি ২: প্রশ্ন ১১-২০ একই কাঠামোয় -->',
        '</div>'
      ].join('\n'),

      // ক্লাসিক (দুই কলাম, আড়াআড়ি)
      classicVertical: [
        '<div class="omr-grid" style="display:flex;justify-content:space-between;gap:30px;">',
        '  <div class="column" style="width:48%;">',
        '    <div class="q-row" style="display:flex;align-items:center;justify-content:flex-start;gap:15px;margin-bottom:10px;padding:4px 8px;border-bottom:1px dotted #ccc;">',
        '      <span class="q-number" style="font-weight:bold;font-size:16px;width:32px;text-align:right;">১.</span>',
        '      <div class="options" style="display:flex;gap:10px;">',
        '        <div class="circle" style="width:26px;height:26px;border:1.5px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;">ক</div>',
        '        <div class="circle" style="width:26px;height:26px;border:1.5px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;">খ</div>',
        '        <div class="circle" style="width:26px;height:26px;border:1.5px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;">গ</div>',
        '        <div class="circle" style="width:26px;height:26px;border:1.5px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;">ঘ</div>',
        '      </div>', '    </div>', '    <!-- এভাবে ১০টি q-row -->', '  </div>',
        '  <div class="column" style="width:48%;">', '    <!-- পরের ১০টি একই কাঠামোয় -->', '  </div>',
        '</div>'
      ].join('\n')
    }
  };

  // ======================================================================
  // ২. সহায়ক
  // ======================================================================
  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  const BN_WORD_NUMS = { 'এক': 1, 'দুই': 2, 'দু': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7, 'আট': 8, 'নয়': 9, 'দশ': 10 };

  function toAsciiDigits(s) { return String(s == null ? '' : s).replace(/[০-৯]/g, d => String(BN_DIGITS.indexOf(d))); }
  function fmtNum(n, lang) { const digits = (EXAM_LIBRARY.labels[lang] || EXAM_LIBRARY.labels.en).digits; return String(n).replace(/\d/g, d => digits[+d]); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hasBengali(s) { return /[\u0980-\u09FF]/.test(String(s || '')); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function isCancelled() { try { return typeof isCancellationRequested !== 'undefined' && !!isCancellationRequested; } catch (_) { return false; } }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function hasOmr(spec) { return !!spec && (spec.omr === 'full' || spec.omr === 'compact' || spec.omr === 'grid' || spec.omr === 'auto'); }

  // ★★★ auto রিজলভার: জায়গা থাকলে grid (সবচেয়ে সুন্দর), না হলে compact ★★★
  function resolveOmrStyle(style, count) {
    if (style !== 'auto') return style;
    if (count <= 100) return 'grid';   // ≤১০০ → গ্রিড ২×২ (সবচেয়ে সুন্দর)
    return 'compact';                  // >১০০ → কমপ্যাক্ট
  }

  function isOmrOnlyRequest(text) {
    const t = String(text || '');
    const only = EXAM_LIBRARY.detect.omrOnlyPatterns || [];
    const notOnly = EXAM_LIBRARY.detect.omrNotOnlyPatterns || [];
    const hasOnly = only.some(p => { try { return new RegExp(p, 'i').test(t); } catch (_) { return false; } });
    if (!hasOnly) return false;
    const hasQuestions = notOnly.some(p => { try { return new RegExp(p, 'i').test(t); } catch (_) { return false; } });
    return !hasQuestions;
  }

  function isGenericExamCreate(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 60) return false;
    const examKw = /পরীক্ষ[াএ]|exam|test|paper|প্রশ্নপত্র|\bomr\b|ওএমআর|mcq|এমসিকিউ|quiz|কুইজ/i;
    if (!examKw.test(t)) return false;
    const createVerb = /(?:তৈরি|তৈরী|বানাও|বানান|বানিয়ে|দাও|দিন|করো|করুন|create|make|build|generate|give|need|want)/i;
    return createVerb.test(t);
  }

  function countOmrOptions(lang) {
    const nums = [20, 50, 100, 150, 200];
    return nums.map(n => lang === 'bn' ? `${fmtNum(n, 'bn')}টি প্রশ্ন` : `${n} questions`);
  }

  // ======================================================================
  // ৩. শনাক্ত ও পার্সিং
  // ======================================================================
  function isExamRequest(text) {
    if (!EXAM_LIBRARY.enabled) return false;
    const t = String(text || '');
    if (isOmrOnlyRequest(t)) return true;
    return EXAM_LIBRARY.detect.patterns.some(p => { try { return new RegExp(p, 'i').test(t); } catch (_) { return false; } });
  }

  function splitClarification(promptText) {
    const text = String(promptText || '');
    const idx = text.indexOf('[Clarification already given');
    if (idx < 0) return { original: text.trim(), pairs: [] };
    const original = text.slice(0, idx).trim();
    const tail = text.slice(idx).replace(/^\[[^\]]*\]\s*/, '');
    const pairs = [];
    const re = /Q:\s*([\s\S]*?)\nA:\s*([\s\S]*?)(?=\nQ:|$)/g;
    let m;
    while ((m = re.exec(tail))) pairs.push({ q: m[1].trim(), a: m[2].trim() });
    return { original, pairs };
  }

  function clarifyKeyOfQuestion(q) {
    const C = EXAM_LIBRARY.clarify;
    const nq = norm(q);
    const keys = ['createWhat', 'topic', 'pages', 'pagesOmrOnly', 'omr', 'difficulty', 'count', 'countOmrOnly'];
    for (const key of keys) {
      const def = C[key];
      if (!def) continue;
      for (const lang of ['bn', 'en']) {
        const ref = norm(def[lang]);
        if (ref && (nq === ref || nq.includes(ref.slice(0, 14)))) return key;
      }
    }
    return null;
  }

  function firstInt(s) { const m = toAsciiDigits(s).match(/\d+/); return m ? parseInt(m[0], 10) : null; }
  function wordNumber(s) { for (const w of Object.keys(BN_WORD_NUMS)) if (new RegExp(w).test(s)) return BN_WORD_NUMS[w]; return null; }

  function parseDifficulty(text) {
    const t = String(text || '');
    const hit = {
      mixed:  /মিশ্র|mixed|সব\s*ধরনের|all\s*levels?/i.test(t),
      hard:   /কঠিন|hard|difficult|challenging|প্রতিযোগিতামূলক/i.test(t),
      medium: /মাঝারি|মধ্যম|medium|moderate/i.test(t),
      easy:   /সহজ|easy|beginner/i.test(t)
    };
    if (hit.mixed) return 'mixed';
    const found = ['easy', 'medium', 'hard'].filter(k => hit[k]);
    if (found.length >= 2) return 'mixed';
    return found[0] || undefined;
  }

  // ★★★ OMR পার্স — none | auto | grid | compact | full ★★★
  function parseOmrChoice(text, strictStart) {
    const t = String(text || '').trim();
    // গ্রিড আগে
    if (/গ্রিড|grid|২\s*[x×]\s*২|2\s*[x×]\s*2|2x2/i.test(t)) return 'grid';
    if (/কমপ্যাক্ট|compact|ছোট\s*আকার|সংক্ষিপ্ত/i.test(t)) return 'compact';
    if (/ক্লাসিক|classic|উলম্ব|vertical|বড়/i.test(t)) return 'full';
    if (/অটো|\bauto\b|স্বয়ংক্রিয়/i.test(t)) return 'auto';
    // পরিষ্কার অস্বীকার
    if (/(?:ওএমআর|ওমআর|omr)\s*(?:ছাড়া|ছাড়াই|লাগবে\s*না|লাগবেনা|দরকার\s*নেই|বাতিল|নয়)|\b(?:without|no)\s*omr\b|ছাড়া\s*(?:ওএমআর|omr)/i.test(t)) return 'none';
    if (strictStart) {
      if (/^(?:না\b|না,|না |no\b|n\b|ছাড়া|লাগবে\s*না)/i.test(t)) return 'none';
      if (/^(?:হ্যাঁ|হ্যা|হাঁ|yes|y\b|যুক্ত|চাই)/i.test(t)) return 'auto';
    }
    if (/ওএমআর|ওমআর|\bomr\b/i.test(t)) return 'auto';
    return undefined;
  }

  function parseCreateWhat(a) {
    const s = String(a || '').trim().toLowerCase();
    if (/(?:omr|ওএমআর|ওমআর)\s*(?:শিট|sheet|only|ছাড়া\s*প্রশ্ন)|শুধু\s*(?:omr|ওএমআর|ওমআর)|only\s+omr|omr\s+only|just\s+omr/i.test(s)) return 'omrOnly';
    if (/(?:প্রশ্ন|question)[^\n]{0,20}(?:omr|ওএমআর|ওমআর)|(?:omr|ওএমআর|ওমআর)[^\n]{0,20}(?:প্রশ্ন|question)|both|questions?\s*\+\s*omr|omr\s*\+\s*questions?/i.test(s)) return 'questionsPlusOmr';
    if (/প্রশ্নপত্র|question\s*paper|no\s*omr|omr\s*বিহীন|omr\s*ছাড়া|without\s*omr|questions?\s*only/i.test(s)) return 'questionsOnly';
    return null;
  }

  function parseTopicWords(text) {
    let t = ' ' + toAsciiDigits(String(text || '')).toLowerCase() + ' ';
    const fillers = EXAM_LIBRARY.detect.topicFillerWords.slice().sort((a, b) => b.length - a.length);
    fillers.forEach(w => { t = t.split(w.toLowerCase()).join(' '); });
    t = t.replace(/[\d\s.,;:!?()"'“”‘’\-–—_/\\|+*=<>@#$%^&\[\]{}~`]+/g, ' ').trim();
    return t;
  }

  function parseExamRequest(promptText, opts) {
    const o = opts || {};
    const { original, pairs } = splitClarification(promptText);
    const spec = {
      promptText: String(promptText || ''),
      original,
      lang: hasBengali(original) ? 'bn' : 'en',
      isEmptyCanvas: !!o.isEmptyCanvas,
      isReplace: !!o.isReplace,
      hasAttachment: !!o.hasAttachment,
      topicAnswer: ''
    };
    const orig = toAsciiDigits(original);

    spec.omrOnly = isOmrOnlyRequest(original);

    let m = orig.match(/(\d+)\s*(?:পেজ|পৃষ্ঠা|পাতা|pages?|pgs?\b)/i);
    if (m) spec.pages = parseInt(m[1], 10);
    else { const w = original.match(/(এক|দুই|তিন|চার|পাঁচ|ছয়|সাত|আট)\s*(?:পেজ|পৃষ্ঠা|পাতা)/); if (w) spec.pages = BN_WORD_NUMS[w[1]]; }

    m = orig.match(/(\d+)\s*(?:টি|টা|ট)?\s*(?:প্রশ্ন|মাল্টিপল|এমসিকিউ|mcqs?|questions?|q\b)/i)
      || orig.match(/(?:প্রশ্ন(?:\s*সংখ্যা)?|questions?|total)\s*[:：\-=]?\s*(\d+)/i)
      || orig.match(/(\d+)\s*(?:টি|টা)(?!\s*(?:পেজ|পৃষ্ঠা))/);
    if (m) spec.count = parseInt(m[1], 10);

    const hours = orig.match(/(\d+(?:\.\d+)?)\s*(?:ঘণ্টা|ঘন্টা|hours?|hrs?)/i);
    const mins  = orig.match(/(\d+)\s*(?:মিনিট|minutes?|mins?)/i);
    if (hours || mins) spec.minutes = Math.round((hours ? parseFloat(hours[1]) * 60 : 0) + (mins ? parseInt(mins[1], 10) : 0));

    m = orig.match(/(?:পূর্ণমান|পূর্ণ\s*মান|full\s*marks?|total\s*marks?|marks)\s*[:：\-=]?\s*(\d+)/i);
    if (m) spec.fullMarks = parseInt(m[1], 10);

    spec.omr = parseOmrChoice(original, false);
    spec.difficulty = parseDifficulty(original);

    if (spec.omrOnly && !spec.omr) spec.omr = 'auto';

    pairs.forEach(({ q, a }) => {
      const key = clarifyKeyOfQuestion(q);
      if (key === 'createWhat') {
        const v = parseCreateWhat(a);
        if (v) {
          spec.createWhat = v;
          if (v === 'omrOnly') { spec.omrOnly = true; if (!spec.omr) spec.omr = 'auto'; }
          else if (v === 'questionsOnly') { spec.omr = 'none'; }
        }
      }
      else if (key === 'pages' || key === 'pagesOmrOnly') { const n = firstInt(a) || wordNumber(a); if (n) spec.pages = n; }
      else if (key === 'count' || key === 'countOmrOnly') { const n = firstInt(a); if (n) spec.count = n; }
      else if (key === 'omr') { const v = parseOmrChoice(a, true); if (v !== undefined) spec.omr = v; }
      else if (key === 'difficulty') { const v = parseDifficulty(a); if (v) spec.difficulty = v; }
      else if (key === 'topic') { spec.topicAnswer = (spec.topicAnswer + ' ' + a).trim(); }
    });

    if (spec.pages) spec.pages = Math.min(spec.pages, 20);
    if (spec.count) spec.count = Math.min(spec.count, EXAM_LIBRARY.defaults.maxQuestions);

    const topicText = parseTopicWords(original) || parseTopicWords(spec.topicAnswer);
    spec.hasTopic = spec.hasAttachment || topicText.length >= 3 || parseTopicWords(spec.topicAnswer).length >= 2;

    if (!spec.omrOnly && spec.omr === undefined && !spec.hasTopic && !spec.count
        && !spec.createWhat && isGenericExamCreate(original)) {
      spec.needsCreateWhat = true;
    }
    return spec;
  }

  function nextClarification(spec) {
    const C = EXAM_LIBRARY.clarify;
    const L = spec.lang;

    if (spec.needsCreateWhat && !spec.createWhat) {
      const opt = C.createWhatOptions;
      return {
        question: C.createWhat[L] || C.createWhat.en,
        options: [opt.omrOnly[L], opt.questionsOnly[L], opt.questionsPlusOmr[L]]
      };
    }

    if (spec.omrOnly) {
      if (spec.count === undefined) {
        const q = C.countOmrOnly ? (C.countOmrOnly[L] || C.countOmrOnly.en) : 'How many bubbles?';
        return { question: q, options: countOmrOptions(L) };
      }
      if (spec.pages === undefined) {
        const def = C.pagesOmrOnly || C.pages;
        return { question: def[L] || def.en, options: def.options.map(op => op[L] || op.en) };
      }
      return null;
    }

    if (!spec.hasTopic) return { question: C.topic[L] || C.topic.en, options: [] };
    for (const key of C.order) {
      if (spec[key] !== undefined && spec[key] !== null) continue;
      if (key === 'count') return { question: C.count[L] || C.count.en, options: countOptions(spec.pages || 1, L) };
      const def = C[key];
      if (!def) continue;
      return { question: def[L] || def.en, options: def.options.map(op => op[L] || op.en) };
    }
    return null;
  }

  function countOptions(pages, lang) {
    const est = EXAM_LIBRARY.defaults.questionsPerPageEstimate;
    const cap = est.first + Math.max(0, pages - 1) * est.other;
    const set = new Set();
    EXAM_LIBRARY.defaults.countOptionFractions.forEach(f => set.add(Math.max(5, Math.round((cap * f) / 5) * 5)));
    return Array.from(set).sort((a, b) => a - b).map(n => lang === 'bn' ? `${fmtNum(n, 'bn')}টি প্রশ্ন` : `${n} questions`);
  }

  // ======================================================================
  // ৪. AI প্রম্পট
  // ======================================================================
  function matchSubjects(text) { const t = norm(text); return EXAM_LIBRARY.subjects.filter(s => (s.match || []).some(k => t.includes(norm(k)))).slice(0, 2); }
  function difficultyBlock(spec) {
    const D = EXAM_LIBRARY.difficulty;
    const key = D[spec.difficulty] ? spec.difficulty : 'medium';
    let s = D[key].guidance;
    if (key === 'mixed' && D.mixed.ratio) { const r = D.mixed.ratio; s += ` Ratio: easy ${r.easy}%, medium ${r.medium}%, hard ${r.hard}%.`; }
    return s;
  }

  function getExamRulesForPrompt(spec, batchCount, isFirstBatch) {
    const opts = EXAM_LIBRARY.defaults.optionsPerQuestion;
    const rules = EXAM_LIBRARY.promptRules.map((r, i) => `${i + 1}. ${r.replace(/\{OPTIONS\}/g, String(opts))}`).join('\n');
    const subj = matchSubjects(spec.promptText).map(s => `- ${s.guidance}`).join('\n');
    const samples = JSON.stringify(EXAM_LIBRARY.sampleQuestions.map(q => ({ q: q.q, options: q.options, answer: q.answer })));

    const tplRef = [
      'OMR TEMPLATE REFERENCE — the OMR answer sheet MUST be rendered using EXACTLY one of these HTML structures. Do NOT invent your own layout. Do NOT write "Roll Number 0 1 2 3 ..." as a plain text list:',
      '--- OPTION A — GRID 2×2 (10 cols/row, 2 rows of bubbles per question, grey header, top row shaded) — MOST BEAUTIFUL, use when space allows:',
      EXAM_LIBRARY.templates.compactGrid2x2,
      '--- OPTION B — COMPACT (10 cols/row, tiny stacked bubbles, grey header + zebra rows):',
      EXAM_LIBRARY.templates.compactHorizontal,
      '--- OPTION C — CLASSIC (two-column, number then 4 large bubbles side by side, dotted bottom border):',
      EXAM_LIBRARY.templates.classicVertical
    ].join('\n');

    return [
      'EXAM LIBRARY RULES:', rules,
      subj ? `SUBJECT GUIDANCE:\n${subj}` : '',
      `DIFFICULTY: ${difficultyBlock(spec)}`,
      `FORMAT EXAMPLE (style only): ${samples}`,
      tplRef,
      `Write exactly ${batchCount} NEW questions in this response.`,
      'OUTPUT: return ONLY one JSON object, no markdown fences, no commentary:',
      `{"action":"exam","title":"exam/paper title","subtitle":"short line","questions":[{"q":"question text","options":[${Array.from({ length: opts }, (_, i) => `"option ${i + 1}"`).join(',')}],"answer":0}]}`,
      '"answer" is the 0-based index of the single correct option.',
      isFirstBatch
        ? '"title" must be a short, proper paper title derived from the request (e.g. subject + "মডেল টেস্ট").'
        : '"title" and "subtitle" may be empty strings in this response.',
      'NEVER include any HTML, CSS, OMR markup, headers, footers, roll-number columns inside "q", "options", "title" or "subtitle".',
      'If the request has NO identifiable subject/topic at all and no source material, return exactly {"action":"need_topic"} instead.'
    ].filter(Boolean).join('\n');
  }

  function getExamCatalogForPrompt() {
    const D = EXAM_LIBRARY.defaults;
    return `Exam paper / OMR generation is handled by the dedicated Exam Library (v${EXAM_LIBRARY.version}): ${D.optionsPerQuestion} options per question, compact two-column layout, optional OMR sheet with four styles:
 • grid    — 2×2 option grid, 10 columns/row, most beautiful when space allows
 • compact — tiny stacked bubbles, 10 columns/row
 • classic — two-column vertical, large horizontal bubbles
 • auto    — let the engine pick the best fit for the current count

IMPORTANT — when suggesting a follow-up action button related to exams, use these EXACT phrases as button labels (Bangla / English):
 • OMR only         →  "OMR তৈরি করুন"  /  "Create OMR"
 • Full question    →  "প্রশ্নপত্র তৈরি করুন"  /  "Create Question Paper"
 • Never use the generic label "পরীক্ষা তৈরি করুন" / "Create Exam".`;
  }

  // ======================================================================
  // ৫. প্রশ্ন সংগ্রহ
  // ======================================================================
  const POSITIONAL_REF = /উপরের|সবগুলো|সকল|সবই|কোনটিই|none of|all of the above|both|\b[কখগঘ]\s*(?:ও|এবং|ও\s*[কখগঘ])|\([কখঘA-D]\)/i;

  function cleanOption(o) {
    let s = (o && typeof o === 'object') ? (o.text || o.label || o.value || '') : o;
    s = String(s == null ? '' : s).trim();
    s = s.replace(/^\s*[\(\[]?(?:[কখগঘঙচ]|[A-Fa-f]|[1-6১-৬])[\)\]\.:]\s+/, '').replace(/^\s*\((?:[কখগঘঙচ]|[A-Fa-f])\)\s*/, '');
    return s.trim();
  }
  function cleanStem(q) { return String(q == null ? '' : q).trim().replace(/^\s*(?:প্রশ্ন\s*)?[\(\[]?[\d০-৯]+[\)\]\.:]\s*/, '').trim(); }
  function answerIndex(a, n) {
    if (typeof a === 'number' && a >= 0 && a < n) return a;
    const s = toAsciiDigits(String(a == null ? '' : a)).trim();
    if (/^\d+$/.test(s)) { const v = parseInt(s, 10); return v >= 0 && v < n ? v : (v >= 1 && v <= n ? v - 1 : -1); }
    const bn = EXAM_LIBRARY.labels.bn.options.indexOf(s.replace(/[()\s]/g, '')); if (bn >= 0 && bn < n) return bn;
    const en = 'abcdef'.indexOf(s.replace(/[()\s]/g, '').toLowerCase()); if (s.length <= 3 && en >= 0 && en < n) return en;
    return -1;
  }
  function normalizeQuestions(arr, seen) {
    const need = EXAM_LIBRARY.defaults.optionsPerQuestion;
    const out = [];
    (Array.isArray(arr) ? arr : []).forEach(item => {
      if (!item) return;
      const q = cleanStem(item.q || item.question || item.stem);
      let options = (Array.isArray(item.options) ? item.options : (Array.isArray(item.choices) ? item.choices : [])).map(cleanOption).filter(Boolean);
      if (!q || options.length < need) return;
      options = options.slice(0, need);
      if (new Set(options.map(norm)).size < need) return;
      const key = norm(q).slice(0, 80); if (seen.has(key)) return; seen.add(key);
      let ans = answerIndex(item.answer != null ? item.answer : item.correct, need);
      const q2 = { q, options, answer: ans };
      if (EXAM_LIBRARY.defaults.shuffleOptions && ans >= 0 && !options.some(o => POSITIONAL_REF.test(o))) {
        const idx = options.map((_, i) => i);
        for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        q2.options = idx.map(i => options[i]); q2.answer = idx.indexOf(ans);
      }
      out.push(q2);
    });
    return out;
  }

  async function callExamBatch(spec, n, isFirst, prevStems, fileContextString, modelsUsedSet) {
    const system = getExamRulesForPrompt(spec, n, isFirst);
    let user = `USER REQUEST:\n${spec.promptText}\n\n`;
    if (fileContextString) user += `SOURCE MATERIAL:\n${String(fileContextString).slice(0, 24000)}\n\n`;
    if (prevStems.length) user += `ALREADY WRITTEN — do NOT repeat:\n${prevStems.slice(-60).map(s => '- ' + s.slice(0, 70)).join('\n')}\n\n`;
    user += `Return the JSON for ${n} new questions now.`;
    const res = await callAIAPI([{ role: 'system', content: system }, { role: 'user', content: user }], { forceJson: true, modelsUsedSet });
    const raw = String(res && res.content || '');
    return safeParseAIJson(raw, null) || attemptRepairAndParse(raw) || null;
  }

  // ======================================================================
  // ৬. HTML রেন্ডারিং
  // ======================================================================
  function fmtText(s) {
    let html = esc(s);
    if (/\$|\\\(|\\\[/.test(html) && typeof processMathEquationsToHTML === 'function') {
      try { html = processMathEquationsToHTML(html); } catch (_) {}
    }
    return html;
  }
  function baseStyle(pt) {
    const L = EXAM_LIBRARY.layout;
    return `font-family:${L.fontStack};font-size:${pt}pt;line-height:${L.lineHeight};color:${L.color};text-align:left;`;
  }

  function questionHtml(q, idx, ctx) {
    const L = ctx.labels, LY = EXAM_LIBRARY.layout;
    const wide = q.options.some(o => o.replace(/\s+/g, '').length > LY.optionWideChars);
    const opts = q.options.map((o, i) =>
      `<div style="flex:0 0 ${wide ? 100 : 50}%;box-sizing:border-box;padding-right:4px;display:flex;">` +
      `<span style="flex:0 0 auto;margin-right:3px;">(${esc(L.options[i])})</span>` +
      `<span style="flex:1 1 auto;min-width:0;overflow-wrap:anywhere;">${fmtText(o)}</span></div>`).join('');
    return `<div class="exam-q" style="box-sizing:border-box;padding-bottom:${LY.questionGapPx}px;break-inside:avoid;page-break-inside:avoid;">` +
      `<div style="display:flex;"><span style="flex:0 0 auto;font-weight:700;margin-right:3px;">${fmtNum(idx + 1, ctx.lang)}.</span>` +
      `<span style="flex:1 1 auto;min-width:0;overflow-wrap:anywhere;">${fmtText(q.q)}</span></div>` +
      `<div style="display:flex;flex-wrap:wrap;">${opts}</div></div>`;
  }
  function headerHtml(hd, ctx) {
    const LY = EXAM_LIBRARY.layout, L = ctx.labels;
    const mid = EXAM_LIBRARY.defaults.showPerQuestionMark ? `<span>${esc(L.perQuestion)} ${fmtNum(hd.marksPerQuestion, ctx.lang)}</span>` : '<span></span>';
    return `<div class="exam-header" style="box-sizing:border-box;padding-bottom:6px;">` +
      `<div style="text-align:center;font-weight:800;font-size:${LY.titlePt}pt;line-height:1.25;">${fmtText(hd.title)}</div>` +
      (hd.subtitle ? `<div style="text-align:center;font-size:${LY.subtitlePt}pt;margin-top:1px;">${fmtText(hd.subtitle)}</div>` : '') +
      `<div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:700;font-size:${LY.metaPt}pt;margin-top:5px;padding:3px 0;border-top:1px solid #111;border-bottom:1.5px solid #111;">` +
      `<span>${esc(L.time)}: ${fmtNum(hd.minutes, ctx.lang)} ${esc(L.minutes)}</span>${mid}<span>${esc(L.fullMarks)}: ${fmtNum(hd.fullMarks, ctx.lang)}</span></div></div>`;
  }

  // ---------- OMR কমপ্যাক্ট (১০ কলাম, স্ট্যাক) ----------
  function omrCompactHtml(startNum, count, ctx, fit) {
    const O = EXAM_LIBRARY.layout.omrCompact, L = ctx.labels;
    const opts = L.options.slice(0, EXAM_LIBRARY.defaults.optionsPerQuestion);
    const cols = (fit && fit.cols) || O.questionsPerRow;
    const bubblePx = (fit && fit.bubblePx) || O.bubblePx;
    const rowGap = (fit && fit.rowGapPx) || O.rowGapPx;
    const colGap = (fit && fit.gapPx) || O.gapPx;
    const numFontPx = Math.max(6, Math.min(9, bubblePx * 0.8));
    const totalRows = Math.ceil(count / cols);
    let html = '';
    for (let r = 0; r < totalRows; r++) {
      const rowStart = r * cols, rowEnd = Math.min(count, rowStart + cols);
      const cellHtmls = [];
      for (let i = rowStart; i < rowEnd; i++) {
        const qn = startNum + i;
        const optRows = opts.map((ch, oi) => {
          const bg = (oi % 2 === 0) ? O.rowShade : '#fff';
          return `<div class="opt-row" style="display:flex;justify-content:center;background:${bg};">` +
            `<div class="circle" style="box-sizing:border-box;width:${bubblePx}px;height:${bubblePx}px;border:1px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${(bubblePx * 0.55).toFixed(1)}px;font-weight:bold;background:#fff;line-height:1;">${esc(ch)}</div>` +
            `</div>`;
        }).join('');
        cellHtmls.push(
          `<div class="q-col" style="border:1px solid ${O.optionBorderColor};border-radius:2px;overflow:hidden;display:flex;flex-direction:column;flex:1 1 0;min-width:0;background:#fff;">` +
            `<div class="q-number" style="background:${O.headerBg};text-align:center;font-weight:bold;font-size:${numFontPx}px;padding:1px 0;border-bottom:1px solid #000;line-height:1.05;">${fmtNum(qn, ctx.lang)}</div>` +
            `<div class="options" style="display:flex;flex-direction:column;padding:0 1px;">${optRows}</div>` +
          `</div>`);
      }
      while (cellHtmls.length < cols) cellHtmls.push(`<div style="flex:1 1 0;min-width:0;"></div>`);
      html += `<div class="omr-grid" style="display:flex;gap:${colGap}px;justify-content:space-between;width:100%;${r < totalRows - 1 ? 'margin-bottom:' + rowGap + 'px;' : ''}">${cellHtmls.join('')}</div>`;
    }
    return html;
  }

  // ---------- OMR ক্লাসিক (দুই কলাম, আড়াআড়ি) ----------
  function omrClassicHtml(startNum, count, ctx, fit) {
    const O = EXAM_LIBRARY.layout.omrClassic, L = ctx.labels;
    const opts = L.options.slice(0, EXAM_LIBRARY.defaults.optionsPerQuestion);
    const columns = (fit && fit.cols) || O.columns;
    const bubblePx = (fit && fit.bubblePx) || O.bubblePx;
    const rowGap = (fit && fit.rowGapPx) || O.rowGapPx;
    const optGap = Math.max(4, Math.round(bubblePx * 0.35));
    const numFontPx = Math.max(9, Math.min(14, bubblePx * 0.6));
    const numWidth = Math.max(20, Math.round(bubblePx * 1.2));
    const half = Math.ceil(count / columns);

    const renderCol = (from, to) => {
      let s = '';
      for (let i = from; i < to; i++) {
        const qn = startNum + i;
        const bubbles = opts.map(ch =>
          `<div class="circle" style="box-sizing:border-box;width:${bubblePx}px;height:${bubblePx}px;border:1.3px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${(bubblePx * 0.5).toFixed(1)}px;font-weight:bold;background:#fff;line-height:1;">${esc(ch)}</div>`
        ).join('');
        s += `<div class="q-row" style="display:flex;align-items:center;justify-content:flex-start;margin-bottom:${rowGap}px;padding:0 4px;border-bottom:${O.rowBorder};">` +
          `<span class="q-number" style="font-weight:bold;font-size:${numFontPx}px;width:${numWidth}px;text-align:right;margin-right:8px;">${fmtNum(qn, ctx.lang)}.</span>` +
          `<div class="options" style="display:flex;gap:${optGap}px;">${bubbles}</div>` +
          `</div>`;
      }
      return s;
    };

    const colGap = Math.max(10, Math.round(O.columnGapPx * 0.6));
    const colWidth = `calc(${(100 / columns).toFixed(2)}% - ${colGap / 2}px)`;
    let colsHtml = '';
    for (let c = 0; c < columns; c++) {
      const from = c * half, to = Math.min(count, (c + 1) * half);
      colsHtml += `<div class="column" style="width:${colWidth};min-width:0;">${renderCol(from, to)}</div>`;
    }
    return `<div class="omr-grid" style="display:flex;justify-content:space-between;gap:${colGap}px;">${colsHtml}</div>`;
  }

  // ---------- ★★★ NEW: OMR গ্রিড ২×২ (১০ কলাম) ★★★ ----------
  function omrGridHtml(startNum, count, ctx, fit) {
    const G = EXAM_LIBRARY.layout.omrGrid, L = ctx.labels;
    const opts = L.options.slice(0, EXAM_LIBRARY.defaults.optionsPerQuestion);
    const cols = (fit && fit.cols) || G.questionsPerRow;
    const bubblePx = (fit && fit.bubblePx) || G.bubblePx;
    const rowGapPx = (fit && fit.rowGapPx) || G.rowGapPx;
    const colGapPx = (fit && fit.gapPx) || G.gapPx;
    const numFontPx = Math.max(8, Math.min(G.numFontPx, bubblePx * 0.5));
    const bubbleFontPx = Math.max(8, Math.min(G.bubbleFontPx, bubblePx * 0.62));
    const cellPad = Math.max(2, Math.min(G.cellPaddingPx, Math.floor(bubblePx * 0.2)));
    const optGap = Math.max(2, Math.min(G.optionGapPx, Math.floor(bubblePx * 0.15)));
    const headerPad = Math.max(2, Math.min(G.headerPadPx, Math.floor(bubblePx * 0.2)));

    const topCount = Math.ceil(opts.length / 2);
    const gridCols = topCount;
    const totalRows = Math.ceil(count / cols);
    let html = '';
    for (let r = 0; r < totalRows; r++) {
      const rowStart = r * cols, rowEnd = Math.min(count, rowStart + cols);
      const cellHtmls = [];
      for (let i = rowStart; i < rowEnd; i++) {
        const qn = startNum + i;
        // অপশন বৃত্ত — উপরের সারি শেডেড, নিচের সারি সাদা
        const cellsHtml = opts.map((ch, oi) => {
          const shaded = oi < topCount;
          const bg = shaded ? G.rowShade : '#fff';
          return `<div class="opt-row-${shaded ? 'top' : 'bottom'}" style="display:flex;align-items:center;justify-content:center;padding:${Math.max(1, Math.round(cellPad * 0.6))}px 0;border-radius:3px;background:${bg};">` +
            `<div class="circle" style="box-sizing:border-box;width:${bubblePx}px;height:${bubblePx}px;border:1.3px solid #000;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${bubbleFontPx.toFixed(1)}px;font-weight:bold;background:#fff;line-height:1;">${esc(ch)}</div>` +
          `</div>`;
        }).join('');

        cellHtmls.push(
          `<div class="q-col" style="border:1.4px solid ${G.optionBorderColor};border-radius:4px;overflow:hidden;display:flex;flex-direction:column;flex:1 1 0;min-width:0;background:#fff;">` +
            `<div class="q-number" style="background:${G.headerBg};text-align:center;font-weight:bold;font-size:${numFontPx.toFixed(1)}px;padding:${headerPad}px 0;border-bottom:1.4px solid #000;line-height:1.1;">${fmtNum(qn, ctx.lang)}</div>` +
            `<div class="options" style="display:grid;grid-template-columns:repeat(${gridCols},1fr);padding:${cellPad}px;row-gap:${optGap}px;column-gap:${optGap}px;">${cellsHtml}</div>` +
          `</div>`);
      }
      while (cellHtmls.length < cols) cellHtmls.push(`<div style="flex:1 1 0;min-width:0;"></div>`);
      html += `<div class="omr-grid" style="display:flex;gap:${colGapPx}px;justify-content:space-between;width:100%;${r < totalRows - 1 ? 'margin-bottom:' + rowGapPx + 'px;' : ''}">${cellHtmls.join('')}</div>`;
    }
    return html;
  }

  // ---------- fit ক্যালকুলেশন ----------
  function computeOmrFit(style, perPage, availH) {
    const PAD = 6;
    const H = Math.max(80, availH - PAD);

    if (style === 'compact') {
      const O = EXAM_LIBRARY.layout.omrCompact;
      const colChoices = [O.questionsPerRow, 12, 15, 20, 25];
      let best = null;
      for (const cols of colChoices) {
        const rows = Math.ceil(perPage / cols);
        const cellH = H / rows;
        const headerH = 11;
        const inner = cellH - headerH - 3;
        let bubble = Math.floor(inner / 4);
        if (bubble < 5) continue;
        bubble = Math.min(O.bubblePx, bubble);
        const gapPx = Math.max(1, Math.min(O.gapPx, Math.floor(bubble / 7)));
        const rowGapPx = Math.max(1, Math.min(O.rowGapPx, Math.floor(cellH * 0.08)));
        best = { cols, bubblePx: bubble, gapPx, rowGapPx, rows };
        break;
      }
      if (!best) {
        const cols = 20;
        const rows = Math.ceil(perPage / cols);
        const cellH = H / rows;
        const bubble = Math.max(4, Math.floor((cellH - 11 - 3) / 4));
        best = { cols, bubblePx: bubble, gapPx: 1, rowGapPx: 1, rows };
      }
      return best;
    }

    if (style === 'grid') {
      const G = EXAM_LIBRARY.layout.omrGrid;
      const colChoices = [G.questionsPerRow, 8, 6, 5];
      let best = null;
      for (const cols of colChoices) {
        const rows = Math.ceil(perPage / cols);
        const cellH = H / rows;
        // cell: header + 2 rows of bubbles with padding
        const headerH = Math.max(10, G.headerPadPx * 2 + 12);
        const inner = cellH - headerH - G.rowGapPx - 2;
        // 2 rows of bubbles: bubble + pad, plus 1 gap
        let bubble = Math.floor((inner - G.cellPaddingPx * 2 - G.optionGapPx) / 2);
        if (bubble < 9) continue;
        bubble = Math.min(G.bubblePx, bubble);
        const gapPx = Math.max(2, Math.min(G.gapPx, Math.floor(bubble / 5)));
        const rowGapPx = Math.max(2, Math.min(G.rowGapPx, Math.floor(cellH * 0.06)));
        best = { cols, bubblePx: bubble, gapPx, rowGapPx, rows };
        break;
      }
      if (!best) {
        const cols = 10;
        const rows = Math.ceil(perPage / cols);
        const cellH = H / rows;
        const bubble = Math.max(6, Math.floor((cellH - 20 - 8) / 2));
        best = { cols, bubblePx: bubble, gapPx: 2, rowGapPx: 2, rows };
      }
      return best;
    }

    // classic
    const O = EXAM_LIBRARY.layout.omrClassic;
    const colChoices = [O.columns, 3, 4];
    let best = null;
    for (const cols of colChoices) {
      const rowsPerCol = Math.ceil(perPage / cols);
      const rowH = H / rowsPerCol;
      if (rowH < 14) continue;
      let bubble = Math.floor(rowH - 5);
      bubble = Math.min(O.bubblePx, Math.max(9, bubble));
      const rowGapPx = Math.max(0, Math.min(O.rowGapPx, Math.floor(rowH - bubble - 2)));
      best = { cols, bubblePx: bubble, rowGapPx, rowsPerCol };
      break;
    }
    if (!best) {
      const cols = 4;
      const rowsPerCol = Math.ceil(perPage / cols);
      const rowH = H / rowsPerCol;
      const bubble = Math.max(8, Math.floor(rowH - 3));
      best = { cols, bubblePx: bubble, rowGapPx: 0, rowsPerCol };
    }
    return best;
  }

  // ---------- omrHtml ডিসপ্যাচার (auto রিজলভ করে) ----------
  function omrHtml(startNum, count, ctx, style, fit) {
    const L = ctx.labels;
    const resolved = resolveOmrStyle(style, count);
    const body = (resolved === 'grid')
      ? omrGridHtml(startNum, count, ctx, fit)
      : (resolved === 'compact')
        ? omrCompactHtml(startNum, count, ctx, fit)
        : omrClassicHtml(startNum, count, ctx, fit);

    const field = (label, flex) =>
      `<span style="display:flex;align-items:baseline;flex:${flex};min-width:0;">` +
      `<span>${esc(label)}:</span><span style="flex:1;border-bottom:1px solid #111;margin:0 6px 0 3px;">&nbsp;</span></span>`;

    return `<div class="exam-omr" style="box-sizing:border-box;border:1.2px solid #111;padding:4px 6px 5px;font-size:8pt;line-height:1.2;">` +
      `<div style="display:flex;align-items:baseline;gap:8px;">` +
      `<b style="font-size:10pt;white-space:nowrap;">${esc(L.omrTitle)}</b>` +
      field(L.name, 3) + field(L.roll, 1.2) + field(L.cls, 1.2) + field(L.date, 1.4) +
      `</div>` +
      `<div style="font-size:7pt;margin-top:2px;">${esc(L.omrNote)}</div>` +
      `<div style="margin-top:3px;">${body}</div>` +
      `</div>`;
  }

  // ---------- শুধু OMR — exact count per page ----------
  function renderOmrOnlyPages(count, ctx, style, requestedPages) {
    const PAGE_H = EXAM_LIBRARY.layout.pageContentHeightPx;
    const OMR_HEADER_H = 60;
    const availH = PAGE_H - OMR_HEADER_H - 6;
    const resolved = resolveOmrStyle(style, count);

    let perPage, totalPages;
    if (requestedPages && requestedPages > 0) {
      perPage = Math.ceil(count / requestedPages);
      totalPages = requestedPages;
      const covered = perPage * totalPages;
      if (covered < count) totalPages = Math.ceil(count / perPage);
    } else {
      const D = EXAM_LIBRARY.defaults.omrOnlyPerPage || { compact: 100, full: 50, grid: 100 };
      perPage = (resolved === 'compact') ? D.compact : (resolved === 'grid' ? D.grid : D.full);
      totalPages = Math.max(1, Math.ceil(count / perPage));
    }

    const minFit = computeOmrFit(resolved, perPage, availH);
    const minBubble = 4;
    if (minFit.bubblePx < minBubble) {
      let testPerPage = perPage;
      while (testPerPage > 5) {
        const f = computeOmrFit(resolved, testPerPage, availH);
        if (f.bubblePx >= minBubble) break;
        testPerPage = Math.max(5, Math.floor(testPerPage * 0.8));
      }
      if (testPerPage !== perPage) {
        perPage = testPerPage;
        totalPages = Math.ceil(count / perPage);
      }
    }

    const out = [];
    let startNum = 1;
    for (let p = 0; p < totalPages; p++) {
      const take = Math.min(perPage, count - startNum + 1);
      if (take <= 0) break;
      const fit = computeOmrFit(resolved, take, availH);
      out.push(pageHtml({
        pt: EXAM_LIBRARY.layout.fontSizesPt[0],
        omr: omrHtml(startNum, take, ctx, resolved, fit)
      }));
      startNum += take;
    }
    return out;
  }

  function answerKeyHtml(questions, ctx) {
    const L = ctx.labels;
    const items = questions.map((q, i) => q.answer >= 0
      ? `<span style="flex:0 0 12.5%;box-sizing:border-box;padding:2px 0;">${fmtNum(i + 1, ctx.lang)} – <b>${esc(L.options[q.answer])}</b></span>` : '').join('');
    return `<div class="exam-key"><div style="text-align:center;font-weight:800;font-size:12pt;padding-bottom:4px;border-bottom:1px solid #111;margin-bottom:6px;">${esc(L.answerKey)}</div>` +
      `<div style="display:flex;flex-wrap:wrap;font-size:10pt;">${items}</div></div>`;
  }

  function pageHtml(parts) {
    const LY = EXAM_LIBRARY.layout;
    let cols = '';
    if (parts.left) {
      const gap = LY.columnGapPx / 2;
      cols = `<div class="block-exam-cols" style="display:flex;flex:0 0 auto;height:${Math.floor(parts.colsH)}px;overflow:hidden;">` +
        `<div style="flex:1 1 0;min-width:0;box-sizing:border-box;padding-right:${gap}px;">${parts.left}</div>` +
        `<div style="flex:1 1 0;min-width:0;box-sizing:border-box;padding-left:${gap}px;border-left:${LY.columnRule};">${parts.right || ''}</div></div>`;
    }
    return `<div class="block-exam-page" style="box-sizing:border-box;width:100%;height:${LY.pageContentHeightPx}px;overflow:hidden;${baseStyle(parts.pt)}">` +
      `${parts.header || ''}${cols}` +
      (parts.omr ? `<div style="margin-top:${LY.omr.gapBelowQuestionsPx}px;">${parts.omr}</div>` : '') +
      `${parts.extra || ''}</div>`;
  }

  // ======================================================================
  // ৭. মাপ
  // ======================================================================
  function makeHost() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;z-index:-1;';
    document.body.appendChild(host);
    return host;
  }
  function estimateHeight(html, widthPx, pt) {
    const text = html.replace(/<[^>]*>/g, '');
    const perLine = Math.max(8, Math.floor(widthPx / (pt * 0.62)));
    const lines = Math.max(2, Math.ceil(text.length / perLine) + 1);
    return lines * pt * 1.333 * EXAM_LIBRARY.layout.lineHeight + EXAM_LIBRARY.layout.questionGapPx;
  }
  function measureBlocks(host, htmlList, widthPx, pt) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${widthPx}px;box-sizing:border-box;${baseStyle(pt)}`;
    wrap.innerHTML = htmlList.join('');
    host.appendChild(wrap);
    const hs = Array.from(wrap.children).map((el, i) => {
      const h = el.getBoundingClientRect().height;
      return h > 0 ? h : estimateHeight(htmlList[i], widthPx, pt);
    });
    host.removeChild(wrap);
    return hs;
  }
  function packColumns(heights, firstH, otherH) {
    const pages = []; let cur = { l: [], r: [] }, side = 'l', used = 0, H = firstH;
    heights.forEach((h, i) => {
      if (used + h > H && used > 0) {
        if (side === 'l') { side = 'r'; used = 0; }
        else { pages.push(cur); cur = { l: [], r: [] }; side = 'l'; used = 0; H = otherH; }
      }
      cur[side].push(i); used += h;
    });
    pages.push(cur);
    return pages;
  }
  function sumH(idxs, heights) { return idxs.reduce((a, i) => a + heights[i], 0); }
  function balanceSplit(items, heights) {
    let best = { k: items.length, h: sumH(items, heights) };
    for (let k = 0; k <= items.length; k++) {
      const h = Math.max(sumH(items.slice(0, k), heights), sumH(items.slice(k), heights));
      if (h < best.h) best = { k, h };
    }
    return best;
  }

  function layoutAtSize(questions, spec, hd, ctx, pt) {
    const LY = EXAM_LIBRARY.layout;
    const host = makeHost();
    try {
      const colInner = Math.floor((LY.pageContentWidthPx - LY.columnGapPx - 1) / 2);
      const qHtml = questions.map((q, i) => questionHtml(q, i, ctx));
      const heights = measureBlocks(host, qHtml, colInner, pt);
      const header = headerHtml(hd, ctx);
      const headerH = measureBlocks(host, [header], LY.pageContentWidthPx, pt)[0];

      const omrStyle = hasOmr(spec) ? spec.omr : null;
      const omr = omrStyle ? omrHtml(1, questions.length, ctx, omrStyle) : '';
      const omrH = omrStyle ? measureBlocks(host, [omr], LY.pageContentWidthPx, pt)[0] : 0;

      const H = LY.pageContentHeightPx;
      const firstColH = Math.max(120, H - headerH);
      const pages = packColumns(heights, firstColH, H);
      const last = pages[pages.length - 1];
      const lastColH = pages.length === 1 ? firstColH : H;
      let omrOwnPage = false, omrOnLast = false;

      if (omrStyle) {
        const items = last.l.concat(last.r);
        const bal = balanceSplit(items, heights);
        if (bal.h + LY.omr.gapBelowQuestionsPx + omrH <= lastColH) {
          last.l = items.slice(0, bal.k); last.r = items.slice(bal.k); last.forcedColsH = bal.h + 2; omrOnLast = true;
        } else omrOwnPage = true;
      }

      const out = pages.map((p, pi) => {
        const isLast = pi === pages.length - 1;
        return pageHtml({
          pt,
          header: pi === 0 ? header : '',
          left: p.l.map(i => qHtml[i]).join('') || '&nbsp;',
          right: p.r.map(i => qHtml[i]).join(''),
          colsH: p.forcedColsH || (pi === 0 ? firstColH : H),
          omr: (isLast && omrOnLast) ? omr : ''
        });
      });
      if (omrOwnPage) out.push(pageHtml({ pt, omr }));
      if (EXAM_LIBRARY.defaults.includeAnswerKey) out.push(pageHtml({ pt, extra: answerKeyHtml(questions, ctx) }));
      return { pagesHtml: out, questionPages: pages.length, fontPt: pt };
    } finally { if (host.parentNode) host.parentNode.removeChild(host); }
  }

  async function buildExamPages(questions, spec, hd, ctx) {
    try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(1500)]); } catch (_) {}
    const sizes = EXAM_LIBRARY.layout.fontSizesPt;
    let result = null;
    for (const pt of sizes) {
      result = layoutAtSize(questions, spec, hd, ctx, pt);
      if (!spec.pages || result.questionPages <= spec.pages) break;
    }
    return result;
  }

  // ======================================================================
  // ৮. মূল এন্ট্রি
  // ======================================================================
  async function generateExamPaper(promptText, fileContextString, modelsUsedSet, intentPayload, options) {
    const o = options || {};
    const spec = parseExamRequest(promptText, {
      isEmptyCanvas: o.isEmptyCanvas, isReplace: o.isReplace,
      hasAttachment: !!(fileContextString && String(fileContextString).trim())
    });
    const sessionId = (typeof APP_STATE !== 'undefined') ? APP_STATE.activeSessionId : null;

    const ask = nextClarification(spec);
    if (ask) return { clarify: ask };

    if (spec.omrOnly) return await generateOmrOnlyPaper(spec, options);

    const D = EXAM_LIBRARY.defaults;
    const target = spec.count;
    const labels = EXAM_LIBRARY.labels[spec.lang] || EXAM_LIBRARY.labels.en;
    const ctx = { lang: spec.lang, labels };

    try {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(spec.lang === 'bn' ? 'প্রশ্নপত্র তৈরি হচ্ছে…' : 'Creating exam paper…',
          spec.lang === 'bn' ? `${fmtNum(target, 'bn')}টি প্রশ্ন` : `${target} questions`);
      }
      const all = [], seen = new Set();
      let title = '', subtitle = '', attempts = 0;
      const maxAttempts = Math.ceil(target / D.batchSize) + 3;
      while (all.length < target && attempts < maxAttempts) {
        if (isCancelled()) return { ok: false, aborted: true };
        if (sessionId !== null && APP_STATE.activeSessionId !== sessionId) return { ok: false, aborted: true };
        attempts++;
        const n = Math.min(D.batchSize, target - all.length);
        if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) {
          const a = 6 + Math.round((all.length / target) * 74);
          ProgressUI.setStage(
            spec.lang === 'bn' ? `প্রশ্ন লেখা হচ্ছে (${fmtNum(all.length, 'bn')}/${fmtNum(target, 'bn')})…` : `Writing (${all.length}/${target})…`,
            a, Math.min(88, a + Math.round(74 / Math.ceil(target / D.batchSize)))
          );
        }
        const parsed = await callExamBatch(spec, n, all.length === 0, all.map(q => q.q), fileContextString, modelsUsedSet);
        if (parsed && parsed.action === 'need_topic' && all.length === 0) {
          if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
          return { clarify: { question: EXAM_LIBRARY.clarify.topic[spec.lang] || EXAM_LIBRARY.clarify.topic.en, options: [] } };
        }
        if (!parsed) continue;
        if (!title && parsed.title) title = String(parsed.title).trim();
        if (!subtitle && parsed.subtitle) subtitle = String(parsed.subtitle).trim();
        normalizeQuestions(parsed.questions, seen).forEach(q => { if (all.length < target) all.push(q); });
      }
      if (!all.length) {
        return { ok: false, message: spec.lang === 'bn'
          ? 'AI কোনো প্রশ্ন তৈরি করতে পারেনি। আবার চেষ্টা করুন বা AI Models সেটিং দেখুন।'
          : 'The AI did not return any usable questions. Please try again or check your AI model settings.' };
      }
      if (typeof ProgressUI !== 'undefined' && ProgressUI.setStage) ProgressUI.setStage(spec.lang === 'bn' ? 'পেজ সাজানো হচ্ছে…' : 'Laying out pages…', 88, 96);
      const count = all.length;
      const hd = {
        title: title || (spec.lang === 'bn' ? 'মডেল টেস্ট' : 'Model Test'),
        subtitle,
        minutes: spec.minutes || Math.max(1, Math.round(count * D.minutesPerQuestion)),
        fullMarks: spec.fullMarks || Math.round(count * D.marksPerQuestion),
        marksPerQuestion: D.marksPerQuestion
      };
      const built = await buildExamPages(all, spec, hd, ctx);
      const examHtml = built.pagesHtml.join('<div class="manual-page-break"></div>');
      const existing = (!spec.isEmptyCanvas && !spec.isReplace && typeof getAllCanvasHTML === 'function') ? getAllCanvasHTML() : '';
      const finalHtml = existing ? `${existing}<div class="manual-page-break"></div>${examHtml}` : examHtml;
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(finalHtml, false);
      if (typeof ProgressUI !== 'undefined') {
        if (ProgressUI.finish) ProgressUI.finish();
        setTimeout(() => { if (ProgressUI.hide) ProgressUI.hide(); }, 400);
      }
      const resolvedOmr = hasOmr(spec) ? resolveOmrStyle(spec.omr, count) : false;
      return {
        ok: true, questionCount: count, requestedCount: target,
        questionPages: built.questionPages, requestedPages: spec.pages || null,
        fontPt: built.fontPt, omr: resolvedOmr,
        minutes: hd.minutes, fullMarks: hd.fullMarks, lang: spec.lang
      };
    } catch (e) {
      console.error('[Exam Library] generation failed:', e);
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      return { ok: false, message: (e && e.message) ? String(e.message) : 'Unknown error.' };
    }
  }

  async function generateOmrOnlyPaper(spec, options) {
    const labels = EXAM_LIBRARY.labels[spec.lang] || EXAM_LIBRARY.labels.en;
    const ctx = { lang: spec.lang, labels };
    const count = spec.count;
    const style = spec.omr || 'auto';
    const resolved = resolveOmrStyle(style, count);
    const requestedPages = spec.pages || null;
    try {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show(spec.lang === 'bn' ? 'OMR উত্তরপত্র তৈরি হচ্ছে…' : 'Creating OMR sheet…',
          spec.lang === 'bn' ? `${fmtNum(count, 'bn')}টি ঘর` : `${count} bubbles`);
      }
      try { if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(1200)]); } catch (_) {}
      const pages = renderOmrOnlyPages(count, ctx, style, requestedPages);
      const omrHtmlJoined = pages.join('<div class="manual-page-break"></div>');
      const existing = (!spec.isEmptyCanvas && !spec.isReplace && typeof getAllCanvasHTML === 'function') ? getAllCanvasHTML() : '';
      const finalHtml = existing ? `${existing}<div class="manual-page-break"></div>${omrHtmlJoined}` : omrHtmlJoined;
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') await setDocumentHTMLAndPaginate(finalHtml, false);
      if (typeof ProgressUI !== 'undefined') {
        if (ProgressUI.finish) ProgressUI.finish();
        setTimeout(() => { if (ProgressUI.hide) ProgressUI.hide(); }, 400);
      }
      return { ok: true, omrOnly: true, omr: resolved, questionCount: 0, bubbleCount: count, questionPages: pages.length, requestedPages, lang: spec.lang };
    } catch (e) {
      console.error('[Exam Library] OMR-only failed:', e);
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      return { ok: false, message: (e && e.message) ? String(e.message) : 'Unknown error.' };
    }
  }

  function formatExamSummary(r) {
    if (!r || !r.ok) return '';
    const styleName = (s, lang) => {
      if (lang === 'bn') return s === 'grid' ? 'গ্রিড' : (s === 'compact' ? 'কমপ্যাক্ট' : 'ক্লাসিক');
      return s === 'grid' ? 'grid' : (s === 'compact' ? 'compact' : 'classic');
    };
    if (r.omrOnly) {
      return r.lang === 'bn'
        ? `✅ OMR উত্তরপত্র তৈরি হয়েছে — ${fmtNum(r.bubbleCount, 'bn')}টি ঘর, ${styleName(r.omr, 'bn')} স্টাইল, ${fmtNum(r.questionPages, 'bn')} পেজ।`
        : `✅ OMR sheet created — ${r.bubbleCount} bubbles, ${styleName(r.omr, 'en')} style, ${r.questionPages} page(s).`;
    }
    const omrBn = r.omr ? `, ${styleName(r.omr, 'bn')} OMR সহ` : '';
    const omrEn = r.omr ? `, with ${styleName(r.omr, 'en')} OMR` : '';
    if (r.lang === 'bn') {
      let s = `✅ পরীক্ষার প্রশ্নপত্র তৈরি হয়েছে — ${fmtNum(r.questionCount, 'bn')}টি প্রশ্ন, সময় ${fmtNum(r.minutes, 'bn')} মিনিট, পূর্ণমান ${fmtNum(r.fullMarks, 'bn')}${omrBn}।`;
      if (r.questionCount < r.requestedCount) s += ` (চাওয়া ${fmtNum(r.requestedCount, 'bn')}টি; পাওয়া ${fmtNum(r.questionCount, 'bn')}টি।)`;
      if (r.requestedPages && r.questionPages > r.requestedPages) s += ` প্রশ্নসংখ্যা অনুযায়ী ${fmtNum(r.questionPages, 'bn')} পেজ লেগেছে।`;
      return s;
    }
    let s = `✅ Exam paper created — ${r.questionCount} questions, ${r.minutes} minutes, ${r.fullMarks} marks${omrEn}.`;
    if (r.questionCount < r.requestedCount) s += ` (${r.requestedCount} were requested; ${r.questionCount} valid.)`;
    if (r.requestedPages && r.questionPages > r.requestedPages) s += ` Needed ${r.questionPages} pages.`;
    return s;
  }

  try {
    if (typeof UNSPLITTABLE_BLOCK_CLASSES !== 'undefined' && Array.isArray(UNSPLITTABLE_BLOCK_CLASSES)) {
      ['block-exam-page', 'block-exam-cols'].forEach(c => { if (!UNSPLITTABLE_BLOCK_CLASSES.includes(c)) UNSPLITTABLE_BLOCK_CLASSES.push(c); });
    }
  } catch (_) {}

  // ======================================================================
  // ৯. এক্সপোর্ট
  // ======================================================================
  root.EXAM_LIBRARY = EXAM_LIBRARY;
  root.isExamRequest = isExamRequest;
  root.generateExamPaper = generateExamPaper;
  root.formatExamSummary = formatExamSummary;
  root.getExamCatalogForPrompt = getExamCatalogForPrompt;
  root.parseExamRequest = parseExamRequest;
  root.__examLibraryInternals = {
    nextClarification, splitClarification, normalizeQuestions, packColumns, balanceSplit,
    omrHtml, omrCompactHtml, omrClassicHtml, omrGridHtml, questionHtml, headerHtml, countOptions,
    fmtNum, parseDifficulty, parseOmrChoice, hasOmr, resolveOmrStyle,
    isOmrOnlyRequest, countOmrOptions, renderOmrOnlyPages, generateOmrOnlyPaper,
    isGenericExamCreate, parseCreateWhat, computeOmrFit
  };
})();