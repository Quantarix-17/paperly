// ========================================================================
// CONFIGURATION
// ========================================================================

const APP_CONFIG = {
  TEMPERATURE: 0.3,
  // Two-temperature policy for Create Slides: a creative DESIGN pass (look, art
  // direction, outline structure, background redesign) and a precise CONTENT pass
  // (facts, slide text, edits). Needs callAIAPI to honour options.temperature.
  DESIGN_TEMPERATURE: 0.85,
  CONTENT_TEMPERATURE: 0.3,
  
  // Token budgets are removed for PDF generation – AI can use as many tokens as needed
  // (model's own maximum will be used automatically)
  // Kept only for reference but not used as limits
  PDF_TOKEN_BUDGETS: Object.freeze({
    SHORT: undefined,
    DEFAULT_SINGLE: undefined,
    STANDARD_BATCH: undefined,
    LONG_BATCH: undefined,
    LONG_DIRECT: undefined,
    EXPANSION: undefined,
    BEAUTIFY: undefined
  }),

  DEFAULT_SINGLE_MAX_PAGES: 8,
  DEFAULT_SECTIONED_MIN_PAGES: 9,
  STEP_MODE_STANDARD_MIN_SECTIONS: 2,
  STEP_MODE_STANDARD_MAX_SECTIONS: 24,
  STEP_MODE_SHORT_MIN_SECTIONS: 2,
  STEP_MODE_SHORT_MAX_SECTIONS: 8,
  STEP_MODE_SECTIONS_PER_BATCH: 1,
  STEP_MODE_BATCH_DELAY_MS: 0,
  LONG_PDF_MIN_SECTIONS: 10,
  LONG_PDF_MAX_SECTIONS: 48,
  LONG_PDF_SECTIONS_PER_BATCH: 1,
  // NOTE: This is NOT a page-count floor the app enforces anymore. It is only used
  // (a) as a rough starting anchor when the AI planner fails to return a usable
  // estimate, and (b) as one input the planner sees. Real length is decided by how
  // much genuine depth (derivations, worked examples, applications) the AI itself
  // finds for the specific topic — see expandLongDocumentUntilMinimumPages().
  LONG_PDF_MIN_PAGES: 20,
  LONG_PDF_MAX_PAGES_SOFT: 90,
  LONG_PDF_MAX_PAGES_HARD: 100,

  OCR_LANGS: 'ben+eng',
  OCR_RENDER_SCALE: 2.0,
  OCR_MIN_TEXT_LEN_PER_PAGE: 25,
  OCR_MIN_TEXT_ITEMS_PER_PAGE: 5,
  OCR_MAX_PARALLEL_WORKERS: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
  OCR_HIGH_ACCURACY_PASSES: 4,
  OCR_MAX_IMAGE_PIXELS: 18000000,
  OCR_TARGET_LONG_EDGE: 4200,
  OCR_SMALL_TEXT_SCALE: 3.2,
  OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS: 82,
  OCR_MAX_ATTEMPTS_PER_PASS: 1,
  OCR_PASS_TIMEOUT_MS: 5000,
  OCR_PDF_PAGE_TIMEOUT_MS: 4500,
  OCR_FAST_TRIAGE_TIMEOUT_MS: 2200,
  OCR_FAST_TRIAGE_PASSES: 2,
  OCR_MAX_TOTAL_PASSES: 4,
  ATTACHMENT_MAX_TEXT_CHARS: 100000,

  SINGLE_SHOT_ESTIMATED_SECONDS: 16,
  // Minimum time (ms) the ordinary chat "typing" bubble must stay visible and
  // animating before the app is allowed to switch to either (a) a clarifying
  // question or (b) the full "Generating PDF..." overlay, for "Create PDF" /
  // "Create Slides" requests. Without this, a fast API response can make the
  // very first AI call feel instantaneous — the person never sees the AI
  // "think" before either a tick-option question or the generation modal
  // appears. If the API call itself already took longer than this, no extra
  // wait is added (this is a floor, not an added delay on top of real work).
  MIN_AI_THINKING_DELAY_MS: 1100,
  PLAN_MAX_OUTPUT_TOKENS: 1800,   // only for planning, not for document generation
  ROUTER_MAX_OUTPUT_TOKENS: 1200,
  CONTINUATION_MAX_LOOPS: 8,      // still used for truncation recovery
  // Max number of "does this topic still have genuine depth left?" passes for Long PDF.
  // Expansion now stops on its own (the AI reports the doc is complete, or two
  // consecutive rounds add negligible content) rather than at a fixed page count,
  // so this is just an upper safety bound on how many extra passes can run.
  LONG_EXPANSION_MAX_ROUNDS: 12,
  // How many times in a row an expansion round is allowed to return little/no new
  // content before we conclude the topic is genuinely exhausted and stop.
  LONG_EXPANSION_MAX_LOW_GROWTH_ROUNDS: 2
};

// ========================================================================
// PDF LAYOUT CONSTANTS
// ========================================================================

const PDF_LAYOUT = Object.freeze({
  width: 794,
  height: 1123,
  padTop: 62,
  padRight: 58,
  padBottom: 58,
  padLeft: 58,
  footerBottom: 22,
  gap: 30,
  contentWidth: 794 - 58 - 58,
  contentHeight: 1123 - 62 - 58
});

const EDITOR_A4_WIDTH = 794;
const EDITOR_A4_HEIGHT = 1123;
const EDITOR_A4_CONTENT_HEIGHT = 1000;
// Normal body text is only ever allowed to be 12pt (default, "Word-style") or 11pt
// (compact fallback) — NOT a continuous scale. The old array here
// ([1, 0.97, 0.94, ... 0.74] applied against a 12pt base) produced odd in-between sizes
// like 11.64pt, 10.92pt, down to 8.88pt, which is why normal paragraph text sometimes
// looked randomly tiny in the middle of a document. Figures/images/tables are handled
// separately in tightenPageContentToA4() and are still allowed to resize freely.
const EDITOR_A4_TEXT_SIZES_PT = [12, 11];

// ========================================================================
// AI THINKING POLICY
// ========================================================================

const THINKING_POLICY = Object.freeze({
  MAX_CYCLES: 3,
  MAX_ATTEMPTS_PER_MODEL: 1,
  MAX_LOCAL_RETRIES: 0,
  LOCAL_RETRY_DELAY_MS: 700
});

const THINKING_COOLDOWN_MS = 60000;

// ========================================================================
// STORAGE KEYS
// ========================================================================

const TAB_STORAGE_KEY = 'aiDocTabs_v1';
const AI_MODELS_STORAGE_KEY = 'aiModelsConfig_v1';
const AI_MODEL_AUTOSWITCH_KEY = 'aiModelAutoSwitchEnabled_v1';
const OCR_PREFERRED_MODEL_ID_KEY = 'OCR_PREFERRED_MODEL_ID';
const PDF_VISUAL_FORMAT_KEY = 'aiPdfStudio.visualFormat';
const PDF_TEXT_FORMAT_KEY = 'aiPdfStudio.textFormat';
const PDF_LANGUAGE_FORMAT_KEY = 'aiPdfStudio.languageFormat';
const STORAGE_KEY = 'aiDocProState_v22';

// Deck design fingerprints (last N decks' theme / main colour / layout mix / bg type)
const DECK_FINGERPRINT_KEY = 'aiPdfStudio.deckFingerprints_v1';
const DECK_FINGERPRINT_MAX = 10;

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function getPDFTokenBudget(lengthMode) {
  // Returns undefined – no token limit
  return undefined;
}

function getGenerationMaxTokens(lengthMode, singleShot = false) {
  // Returns undefined – no token limit
  return undefined;
}

function getDynamicSectionBatchSize(lengthMode, totalSections, estimatedPages = 0) {
  if (totalSections <= 0) return 1;
  return 1;
}

function isMobileDeviceLayout() {
  try {
    if (window.innerWidth <= 850 || (document.documentElement.clientWidth || 0) <= 850) return true;
    return window.matchMedia('(max-width: 850px)').matches;
  } catch (_) {
    return window.innerWidth <= 850;
  }
}

function isMobilePreviewMode() {
  return isMobileDeviceLayout();
}

// ===== TOUCH-ONLY DEVICE DETECTION (phone/tablet virtual keyboard vs. a real keyboard) =====
// Used to decide whether the chat input's Enter key should send the message
// (desktop, physical keyboard) or insert a newline/new paragraph (phone or
// tablet virtual keyboard). `isMobileDeviceLayout()` only looks at CSS
// viewport WIDTH, so it also fires on a narrow desktop browser window where
// the person still has a real keyboard and does want Enter to send — that
// function is not a safe stand-in for "does this device have a real
// keyboard". This instead checks the device's actual input capability:
// "(hover: none) and (pointer: coarse)" is true for touch-primary devices
// (phones, tablets) with no mouse, and false for desktops/laptops — even
// ones with a touchscreen, as long as they also have a mouse/trackpad —
// so a touchscreen laptop with a keyboard still sends on Enter as expected.
function isTouchOnlyDevice() {
  try {
    if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
    return false;
  } catch (_) {
    try {
      return ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) &&
        !(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    } catch (__) {
      return false;
    }
  }
}