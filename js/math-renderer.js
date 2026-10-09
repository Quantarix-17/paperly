// ========================================================================
// MATH RENDERER - KaTeX equation processing and rendering
// Fixed: custom macros with correct syntax, improved fallback,
// unknown commands render as plain text
// ========================================================================

// ===== CUSTOM KATEX MACROS (CORRECTED) =====
function getCustomKaTeXMacros() {
    return {
        "\\extker": "\\operatorname{ext\\,ker}",
        "\\extrange": "\\operatorname{ext\\,range}",
        "\\ext": "\\operatorname{ext}",
        "\\R": "\\mathbb{R}",
        "\\C": "\\mathbb{C}",
        "\\Q": "\\mathbb{Q}",
        "\\Z": "\\mathbb{Z}",
        "\\N": "\\mathbb{N}",
        "\\F": "\\mathbb{F}",
        "\\K": "\\mathbb{K}",
        "\\P": "\\mathbb{P}",
        "\\E": "\\mathbb{E}",
        "\\V": "\\mathbb{V}",
        "\\U": "\\mathbb{U}",
        "\\O": "\\mathcal{O}",
        "\\I": "\\mathcal{I}",
        "\\J": "\\mathcal{J}",
        "\\L": "\\mathcal{L}",
        "\\M": "\\mathcal{M}",
        "\\S": "\\mathcal{S}",
        "\\T": "\\mathcal{T}",
        "\\W": "\\mathcal{W}",
        "\\X": "\\mathcal{X}",
        "\\Y": "\\mathcal{Y}"
    };
}

// ===== KNOWN LATEX COMMAND CHECK =====
const KNOWN_LATEX_COMMANDS = new Set([
    'frac','dfrac','tfrac','cfrac','binom','dbinom','tbinom',
    'sqrt',
    'sum','prod','coprod','int','iint','iiint','oint',
    'bigcup','bigcap','bigoplus','bigotimes','bigvee','bigwedge',
    'lim','limsup','liminf','sin','cos','tan','sec','csc','cot',
    'sinh','cosh','tanh','coth','log','ln','exp','max','min',
    'sup','inf','det','dim','ker','deg','gcd','arg','Pr',
    'vec','bar','hat','dot','ddot','tilde','widehat','widetilde',
    'overline','underline','overrightarrow','overleftarrow','overbrace','underbrace',
    'leq','geq','neq','ne','approx','equiv','sim','simeq','cong',
    'propto','parallel','perp','ll','gg',
    'subset','subseteq','supset','supseteq','in','notin','ni',
    'cup','cap','setminus','emptyset','varnothing',
    'to','rightarrow','leftarrow','leftrightarrow','Rightarrow',
    'Leftarrow','Leftrightarrow','mapsto','implies','iff','longrightarrow','longleftarrow',
    'forall','exists','neg','lnot','wedge','vee','land','lor',
    'infty','partial','nabla','angle','triangle','circ','bullet',
    'star','ast','pm','mp','times','cdot','div',
    'oplus','ominus','otimes','oslash','odot',
    'top','bot','aleph','hbar','ell','wp','Re','Im','prime','dagger','ddagger',
    'alpha','beta','gamma','delta','epsilon','varepsilon','zeta',
    'eta','theta','vartheta','iota','kappa','lambda','mu','nu',
    'xi','omicron','pi','varpi','rho','varrho','sigma','varsigma',
    'tau','upsilon','phi','varphi','chi','psi','omega',
    'Gamma','Delta','Theta','Lambda','Xi','Pi','Sigma','Upsilon',
    'Phi','Psi','Omega',
    'text','mathrm','mathbf','mathit','mathsf','mathtt','mathcal',
    'mathbb','mathfrak','mathscr','boldsymbol','operatorname',
    'left','right','big','Big','bigg','Bigg',
    'quad','qquad','displaystyle','textstyle','scriptstyle','scriptscriptstyle',
    'cdots','ldots','vdots','ddots','dots',
    'pmod','bmod','not',
    'langle','rangle','lceil','rceil','lfloor','rfloor','vert','Vert','mid',
    'ext','extker','extrange',
    // Additional commonly-needed commands (arrows, decorations, big operators, misc)
    'boxed','overset','underset','stackrel','substack',
    'xrightarrow','xleftarrow','xLeftarrow','xRightarrow','xleftrightarrow','xLeftrightarrow',
    'hookrightarrow','hookleftarrow','rightharpoonup','leftharpoonup','rightharpoondown','leftharpoondown',
    'rightleftharpoons','leftrightharpoons','rightrightarrows','leftleftarrows',
    'nearrow','searrow','swarrow','nwarrow','leadsto','curvearrowright','curvearrowleft',
    'bigl','bigr','Bigl','Bigr','biggl','biggr','Biggl','Biggr',
    'colon','because','therefore','ldotp','cdotp','backslash','surd',
    'iiiint','oiint','oiiint','idotsint',
    'nonumber','notag','tag','label','ref','eqref',
    'sideset','mathring','check','breve','acute','grave',
    'square','blacksquare','lozenge','blacklozenge','diamond','Diamond',
    'triangleleft','triangleright','blacktriangle','blacktriangleleft','blacktriangleright',
    'trianglelefteq','trianglerighteq','ntriangleleft','ntriangleright',
    'subsetneq','supsetneq','subsetneqq','supsetneqq','sqsubset','sqsupset','sqsubseteq','sqsupseteq',
    'sqcup','sqcap','uplus','biguplus','bigsqcup',
    'nsubseteq','nsupseteq','nless','ngtr','nleq','ngeq',
    'longmapsto','circlearrowleft','circlearrowright','looparrowleft','looparrowright',
    'digamma','varkappa','beth','gimel','daleth','complement',
    'imath','jmath','eth','hslash','backepsilon',
    'mathbbm','mathnormal','textnormal','emph','textbf','textit',
    'array','matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','smallmatrix'
]);

// Commands that the static list above used to miss. Missing entries were the cause of
// (a) "\\rbrack" / "\\rbrace" / "\\nmid" being turned into <CR>/<TAB>/<LF> + text by
// repairVisibleEscapeSequencesInText, and (b) valid commands being shown as plain words.
[
    'lbrack','rbrack','lbrace','rbrace','lvert','rvert','lVert','rVert','lgroup','rgroup',
    'arcsin','arccos','arctan','arctg','lg','mod','pod','hom','varlimsup','varliminf',
    'nmid','nparallel','nsim','ncong','nrightarrow','nleftarrow','nRightarrow','nLeftarrow',
    'nleftrightarrow','nLeftrightarrow','nvdash','nvDash','ntriangleleft','ntriangleright',
    'leqslant','geqslant','lesssim','gtrsim','lessgtr','gtrless','prec','succ','preceq','succeq',
    'asymp','doteq','triangleq','bowtie','models','vdash','dashv','vDash','Vdash','smile','frown',
    'uparrow','downarrow','updownarrow','Uparrow','Downarrow','Updownarrow',
    'Longrightarrow','Longleftarrow','Longleftrightarrow','longleftrightarrow',
    'twoheadrightarrow','twoheadleftarrow','rightsquigarrow','mapsfrom',
    'bigodot','bigcirc','amalg','wr','diagup','diagdown','lhd','rhd','unlhd','unrhd',
    'varDelta','varGamma','varTheta','varLambda','varXi','varPi','varSigma','varUpsilon','varPhi','varPsi','varOmega',
    'phantom','hphantom','vphantom','smash','mathstrut','strut','color','textcolor','colorbox','fbox',
    'cancel','bcancel','xcancel','sout','cdot','over','choose','atop','genfrac',
    'overleftrightarrow','underleftarrow','underrightarrow','xmapsto','xlongequal','xhookrightarrow',
    'mathop','mathbin','mathrel','mathord','mathopen','mathclose','mathpunct','mathinner','limits','nolimits',
    'textrm','textsf','texttt','textup','textsl','textmd','textsc','mathrm','pmb',
    'tiny','scriptsize','footnotesize','small','normalsize','large','Large','LARGE','huge','Huge',
    'space','enspace','thinspace','medspace','thickspace','negthinspace','negmedspace','negthickspace',
    'hspace','vspace','hline','hdashline','cline','cr','newline',
    'angle','measuredangle','sphericalangle','degree','checkmark','flat','natural','sharp',
    'clubsuit','diamondsuit','heartsuit','spadesuit','Box','Game','mho','smallsetminus',
    'Vert','vert','lceil','rceil','lfloor','rfloor','ulcorner','urcorner','llcorner','lrcorner',
    'Zeta','Eta','Alpha','Beta','Epsilon','Iota','Kappa','Mu','Nu','Omicron','Rho','Tau','Chi'
].forEach(c => KNOWN_LATEX_COMMANDS.add(c));

// Ask the loaded KaTeX itself whether a control sequence exists. This makes the
// renderer follow the real KaTeX version instead of a hand-maintained list.
const _katexCommandProbeCache = new Map();
function probeKatexCommand(cmd) {
    if (typeof katex === 'undefined' || typeof katex.renderToString !== 'function') return null;
    if (_katexCommandProbeCache.has(cmd)) return _katexCommandProbeCache.get(cmd);
    let ok = true;
    try {
        katex.renderToString('\\' + cmd, {
            throwOnError: true, strict: 'ignore', output: 'html',
            macros: getCustomKaTeXMacros()
        });
    } catch (e) {
        ok = !/Undefined control sequence/i.test(String((e && e.message) || e));
    }
    _katexCommandProbeCache.set(cmd, ok);
    return ok;
}

function isKnownLatexCommand(cmd) {
    if (!cmd) return false;
    cmd = String(cmd);
    if (KNOWN_LATEX_COMMANDS.has(cmd)) return true;
    // begin/end are environment markers, never standalone commands
    if (cmd === 'begin' || cmd === 'end') return false;
    return probeKatexCommand(cmd) === true;
}

// ===== REBUILD A LATEX COMMAND STRING FROM PARSED ARGS =====
// Optional arguments (e.g. the "[3]" in \sqrt[3]{x}) must be re-emitted with
// square brackets, NOT wrapped in curly braces, or KaTeX sees an extra
// mandatory argument and mis-renders the command (this previously broke
// every \sqrt[n]{...} nth-root).
function buildLatexFromCommand(cmd, args) {
    let latex = '\\' + cmd;
    for (const arg of args) {
        if (arg.length >= 2 && arg[0] === '[' && arg[arg.length - 1] === ']') {
            latex += arg;
        } else {
            latex += '{' + arg + '}';
        }
    }
    return latex;
}


// ========================================================================
// KATEX DELIMITER-FONT GUARD
// Symptom: in SMALL equations the [ ] ( ) of a matrix are drawn as ordinary,
// short brackets (the numbers stick out above/below them) while BIG equations
// look right. Reason: KaTeX draws small/medium stretchy delimiters with the glyphs
// of the fonts KaTeX_Size1..Size3 (a plain "[" character in a special font).
// Tall delimiters are assembled from Unicode corner pieces (U+23A1...) that every
// system font has - so they survive even when the KaTeX_Size* fonts are missing,
// blocked, or overridden by a global font-family rule. This block
//   1. pins the delimiter font-family with !important (beats global overrides),
//   2. forces the Size fonts to load and waits for them,
//   3. if they still cannot be used, stretches the regular bracket glyph to the
//      exact height KaTeX asked for (size1=1.2em ... size4=3em).
// ========================================================================
const KATEX_SIZE_FONTS = ['KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4'];
let _katexDelimFontPromise = null;

function installKatexDelimiterFontGuard() {
    if (typeof document === 'undefined' || !document.head || document.getElementById('katex-delimiter-font-guard')) return;
    const st = document.createElement('style');
    st.id = 'katex-delimiter-font-guard';
    st.textContent =
        '.katex .delimsizing.size1{font-family:KaTeX_Size1,KaTeX_Main,serif!important}' +
        '.katex .delimsizing.size2{font-family:KaTeX_Size2,KaTeX_Main,serif!important}' +
        '.katex .delimsizing.size3{font-family:KaTeX_Size3,KaTeX_Main,serif!important}' +
        '.katex .delimsizing.size4{font-family:KaTeX_Size4,KaTeX_Main,serif!important}' +
        '.katex .delimsizing.mult .delim-size1>span{font-family:KaTeX_Size1,KaTeX_Main,serif!important}' +
        '.katex .delimsizing.mult .delim-size4>span{font-family:KaTeX_Size4,KaTeX_Main,serif!important}' +
        // fallback used only when the Size fonts are really unusable (class set by ensureKatexDelimiterFonts)
        'html.katex-size-fonts-missing .katex .delimsizing.size1,' +
        'html.katex-size-fonts-missing .katex .delimsizing.size2,' +
        'html.katex-size-fonts-missing .katex .delimsizing.size3,' +
        'html.katex-size-fonts-missing .katex .delimsizing.size4{' +
            'font-family:KaTeX_Main,"Times New Roman",serif!important;display:inline-block;transform-origin:50% 50%}' +
        'html.katex-size-fonts-missing .katex .delimsizing.size1{transform:scaleY(1.2)}' +
        'html.katex-size-fonts-missing .katex .delimsizing.size2{transform:scaleY(1.8)}' +
        'html.katex-size-fonts-missing .katex .delimsizing.size3{transform:scaleY(2.4)}' +
        'html.katex-size-fonts-missing .katex .delimsizing.size4{transform:scaleY(3)}';
    document.head.appendChild(st);
}

function ensureKatexDelimiterFonts() {
    installKatexDelimiterFontGuard();
    if (_katexDelimFontPromise) return _katexDelimFontPromise;
    if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
        _katexDelimFontPromise = Promise.resolve(true);
        return _katexDelimFontPromise;
    }
    _katexDelimFontPromise = Promise.all(KATEX_SIZE_FONTS.map(async name => {
        try {
            // fonts are normally requested lazily, only once a glyph that uses them is laid out;
            // asking explicitly makes them available before the first measurement
            const faces = await document.fonts.load('1em ' + name, '[](){}|');
            return faces.length > 0 && document.fonts.check('1em ' + name, '[');
        } catch (_) {
            return false;   // @font-face declared but the file failed to load (404 / blocked / offline)
        }
    })).then(results => {
        const ok = results.every(Boolean);
        const root = document.documentElement;
        if (root) root.classList.toggle('katex-size-fonts-missing', !ok);
        if (!ok) {
            console.warn('[KaTeX] Size1-4 fonts unavailable (' +
                KATEX_SIZE_FONTS.filter((n, i) => !results[i]).join(', ') +
                '). Using stretched fallback brackets. Check that the KaTeX font files load (Network tab) ' +
                'and that no CSS overrides font-family inside .katex.');
        }
        return ok;
    }).catch(() => true);
    return _katexDelimFontPromise;
}
installKatexDelimiterFontGuard();

// ===== KATEX READY HELPER =====
function isKatexReady() {
    return typeof katex !== 'undefined' && typeof katex.render === 'function';
}

function waitForKatex(maxMs) {
    if (isKatexReady()) return Promise.resolve(true);
    const budget = Math.max(200, Number(maxMs) || 4000);
    const start = Date.now();
    return new Promise(resolve => {
        const tick = () => {
            if (isKatexReady()) return resolve(true);
            if (Date.now() - start >= budget) return resolve(false);
            setTimeout(tick, 40);
        };
        tick();
    });
}

// ===== HELPER: EXTRACT LATEX COMMAND WITH BALANCED BRACES =====
function extractLatexCommandWithArgs(text, startPos) {
    // Expects text[startPos] === '\\'
    let i = startPos + 1;
    if (i >= text.length) return null;
    let cmd = '';
    while (i < text.length && /[A-Za-z]/.test(text[i])) {
        cmd += text[i];
        i++;
    }
    if (!cmd) return null;
    // Now parse arguments: each argument is either { ... } or [ ... ] or a single character (like \frac)
    let args = [];
    let braceCount = 0;
    let currentArg = '';
    let inBrace = false;
    let inSquare = false;
    let squareCount = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '{' && !inSquare) {
            if (inBrace) {
                braceCount++;
                currentArg += ch;
            } else {
                inBrace = true;
                braceCount = 1;
                currentArg = '';
            }
            i++;
            continue;
        }
        if (ch === '}' && !inSquare) {
            if (inBrace) {
                braceCount--;
                if (braceCount === 0) {
                    inBrace = false;
                    args.push(currentArg);
                    currentArg = '';
                    i++;
                    continue;
                } else {
                    currentArg += ch;
                    i++;
                    continue;
                }
            } else {
                // unmatched closing brace – stop
                break;
            }
        }
        if (ch === '[' && !inBrace) {
            if (inSquare) {
                squareCount++;
                currentArg += ch;
            } else {
                inSquare = true;
                squareCount = 1;
                currentArg = '';
            }
            i++;
            continue;
        }
        if (ch === ']' && !inBrace) {
            if (inSquare) {
                squareCount--;
                if (squareCount === 0) {
                    inSquare = false;
                    args.push('[' + currentArg + ']');
                    currentArg = '';
                    i++;
                    continue;
                } else {
                    currentArg += ch;
                    i++;
                    continue;
                }
            } else {
                break;
            }
        }
        if (inBrace || inSquare) {
            currentArg += ch;
            i++;
        } else {
            // if not in any brace, a letter/digit means the command has no more arguments
            if (/[A-Za-z0-9]/.test(ch)) break;
            // if whitespace, skip
            if (/\s/.test(ch)) { i++; continue; }
            // if other char, stop
            break;
        }
    }
    // If we never entered a brace, the command has no arguments; return just the command
    if (!args.length) {
        return { cmd, args: [], endPos: startPos + 1 + cmd.length };
    }
    // The end position is where we stopped parsing
    return { cmd, args, endPos: i };
}

// ===== PROCESS MATH EQUATIONS IN CONTAINER =====
function processMathEquationsInContainer(container) {
    if (!container) return;
    normalizeAIHTMLTextArtifacts(container);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || (node.parentElement && node.parentElement.closest('.katex-eq, .katex, script, style, textarea, input')))
                return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    const delimiterRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\})/g;

    textNodes.forEach(textNode => {
        let text = textNode.nodeValue;
        if (!/[$\\√∑∫πθλµσΩαβγδ^=<>≤≥≠≈×÷]/.test(text)) return;

        text = upgradeBracketedMatricesInProse(text);
        let splitParts = text.split(delimiterRegex);
        const hasDelimitedMath = splitParts.length > 1;
        const hasRawLatex = /\\[A-Za-z]/.test(text);
        const hasBareMath = /(?:^|[\s])(?:[A-Za-z]\s*=|\d+\s*[+\-*/=])/.test(text) && /[=^√∑∫πθλµσΩαβγδ]/.test(text);
        if (!hasDelimitedMath && !hasRawLatex && !hasBareMath) return;

        const fragment = document.createDocumentFragment();

        if (hasDelimitedMath) {
            splitParts.forEach(part => {
                if (!part) return;
                if (part.startsWith('$$') || part.startsWith('\\[') || part.startsWith('\\begin{')) {
                    let mathPart = part;
                    if (part.startsWith('$$')) mathPart = part.replace(/^\$\$|\$\$$/g, '');
                    else if (part.startsWith('\\[')) mathPart = part.replace(/^\\\[|\\\]$/g, '');
                    else if (part.startsWith('\\begin{')) {
                        // keep as is, will be handled by createKatexSpanElement as display math
                        mathPart = part;
                    }
                    fragment.appendChild(createKatexSpanElement(mathPart, true));
                } else if (part.startsWith('$') || part.startsWith('\\(')) {
                    fragment.appendChild(createKatexSpanElement(part.replace(/^\$|^\\\(|\$|\\\)$/g, ''), false));
                } else {
                    appendAutoWrappedLatex(fragment, part);
                }
            });
        } else {
            // No delimited math, but we might have bare LaTeX commands
            let last = 0;
            let matched = false;
            const cmdRegex = /\\[A-Za-z]+/g;
            let match;
            while ((match = cmdRegex.exec(text)) !== null) {
                const startPos = match.index;
                const extracted = extractLatexCommandWithArgs(text, startPos);
                if (!extracted) continue;
                const { cmd, args, endPos } = extracted;
                // Check if this is a known LaTeX command (we want to wrap it)
                if (isKnownLatexCommand(cmd)) {
                    // Build the full LaTeX string: \cmd + args
                    const latex = buildLatexFromCommand(cmd, args);
                    // Insert preceding text
                    if (startPos > last) {
                        fragment.appendChild(document.createTextNode(text.slice(last, startPos)));
                    }
                    // Create the span
                    fragment.appendChild(createKatexSpanElement(latex, false));
                    last = endPos;
                    matched = true;
                } else {
                    // UNKNOWN COMMAND: render as plain text (remove backslash)
                    // This prevents broken LaTeX from showing up.
                    if (startPos > last) {
                        fragment.appendChild(document.createTextNode(text.slice(last, startPos)));
                    }
                    // Insert the command name as plain text without backslash
                    fragment.appendChild(document.createTextNode(cmd));
                    last = endPos;
                    matched = true;
                }
            }
            if (!matched) {
                // No recognized command, but maybe there is plain math like x=5
                // We'll use a simpler heuristic: if there is an equation-like pattern, wrap it.
                // For safety, we'll not wrap plain math without command to avoid over-wrapping.
                // Instead, we'll leave as is.
                fragment.appendChild(document.createTextNode(text));
                last = text.length;
            } else if (last < text.length) {
                fragment.appendChild(document.createTextNode(text.slice(last)));
            }
        }
        if (textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
}

// ===== RESTORE BACKSLASHES EATEN BY JSON / AI OUTPUT =====
// BUG THIS FIXES: "\begin{bmatrix}...\end{bmatrix}" arriving as "begin{bmatrix}...end{bmatrix}"
// (JSON drops the backslash of the invalid escape "\e", and turns "\b" into a backspace char).
// KaTeX then prints it as italic text "beginbmatrix x1 x2 ... endbmatrix" instead of a matrix.
const _LATEX_ENV_NAMES = 'matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|array|cases|rcases|dcases|' +
    'aligned|alignedat|gathered|split|subarray|align\\*?|alignat\\*?|gather\\*?|multline\\*?|equation\\*?|eqnarray\\*?';
const _BARE_ENV_REGEX = new RegExp('(^|[^\\\\A-Za-z])(?:\\u0008|\\u000c|\\u000b)?(begin|end)\\s*\\{(' + _LATEX_ENV_NAMES + ')\\}', 'g');

function restoreLostEnvironmentBackslashes(value) {
    let text = String(value || '');
    if (!text || (text.indexOf('begin') === -1 && text.indexOf('end') === -1 &&
                  text.indexOf('\u0008') === -1 && text.indexOf('\u000c') === -1)) return text;
    // control char + "egin" / "nd" etc. left over from JSON (\b -> BS)
    text = text.replace(/\u0008egin\s*\{/g, '\\begin{');
    // bare begin{env} / end{env} (backslash lost)
    text = text.replace(_BARE_ENV_REGEX, (full, pre, word, env) => pre + '\\' + word + '{' + env + '}');
    return text;
}

// ===== MATH ARTIFACT REPAIR =====
function repairVisibleEscapeSequencesInText(text) {
    let value = String(text || '');
    value = restoreLostEnvironmentBackslashes(value);
    // First, handle actual escape sequences that are not part of LaTeX commands.
    // BUG THIS FIXES: a naive /\\([nrt])/ replace also matches the first letter of any
    // LaTeX command starting with n/r/t (\text, \tau, \tan, \top, \tilde, \nabla, \neg,
    // \rangle, \rightarrow, ...), turning "\text{Area}" into "<TAB>ext{Area}" – which is
    // why equations were showing a stray "ext" instead of rendering.
    // Fix: capture any run of letters right after the n/r/t, and only treat it as a
    // plain escape sequence if that whole run is NOT a recognized LaTeX command name.
    // Known commands are left completely untouched so processMathEquationsInContainer
    // can still find and render them; anything else still gets the escape converted
    // (so genuine literal "\n"/"\r"/"\t" in plain prose, even when butted up against the
    // next letter with no space, keeps working as before).
    value = value.replace(/\\([nrt])([A-Za-z]*)/g, (full, letter, rest) => {
        const cmd = letter + rest;
        if (isKnownLatexCommand(cmd)) return full;
        const esc = letter === 'n' ? '\n' : (letter === 'r' ? '\r' : '\t');
        return esc + rest;
    });
    // When AI output reaches us through JSON.parse with SINGLE backslashes, JSON turns
    // "\begin" into <BS>egin, "\frac" into <FF>rac, "\vec" into <VT>ec, "\text" into
    // <TAB>ext, "\right" into <CR>ight, "\neq" into <LF>eq ... Put the backslash back.
    // <BS>/<FF>/<VT> never occur in real text, so they are always restored; <TAB>/<CR>/<LF>
    // are restored only when glued to the previous character and forming a known command.
    value = value.replace(/([\u0008\u000b\u000c])([A-Za-z]+)/g, (full, ch, rest) => {
        const letter = ch === '\u0008' ? 'b' : (ch === '\u000c' ? 'f' : 'v');
        const word = letter + rest;
        if (word === 'begin' || isKnownLatexCommand(word)) return '\\' + word;
        // run of letters may continue into plain text (e.g. "\fracx"); try the longest known prefix
        for (let k = word.length - 1; k >= 2; k--) {
            const head = word.slice(0, k);
            if (isKnownLatexCommand(head)) return '\\' + head + word.slice(k);
        }
        return full;
    });
    value = value.replace(/([^\s\u0000-\u001f])([\t\r\n])([A-Za-z]{2,})/g, (full, prev, ch, rest) => {
        const letter = ch === '\t' ? 't' : (ch === '\r' ? 'r' : 'n');
        const word = letter + rest;
        return (word.length >= 3 && isKnownLatexCommand(word)) ? prev + '\\' + word : full;
    });
    return value;
}

function normalizeAIHTMLTextArtifacts(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName) || parent.closest('.katex, .katex-eq'))
                return NodeFilter.FILTER_REJECT;
            return /\\[nrt]/.test(node.nodeValue) || /\\[A-Za-z]+/.test(node.nodeValue) ||
                   /(?:begin|end)\s*\{/.test(node.nodeValue) ?
                NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => {
        const fixed = repairVisibleEscapeSequencesInText(node.nodeValue);
        if (fixed !== node.nodeValue) node.nodeValue = fixed;
    });

    root.querySelectorAll('.katex-eq').forEach(eq => {
        const latex = eq.getAttribute('data-latex') || '';
        if (/^\\n[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)*$/.test(latex)) {
            eq.replaceWith(document.createTextNode(latex.replace(/^\\n/, '').trim()));
        }
    });
}

function processMathEquationsToHTML(rawHtmlString) {
    if (!rawHtmlString) return '';
    const container = document.createElement('div');
    container.innerHTML = rawHtmlString;
    normalizeAIHTMLTextArtifacts(container);
    processMathEquationsInContainer(container);
    normalizeAIHTMLTextArtifacts(container);
    return container.innerHTML;
}

// ===== PLAIN BRACKETS AROUND A MATRIX  ->  REAL MATRIX DELIMITERS =====
// BUG THIS FIXES: the AI often writes a vector/matrix as  [\begin{matrix}-2\\5\end{matrix}]
// (or  (\begin{matrix}...\end{matrix})  /  \left[\begin{array}{c}...\end{array}\right] ).
// A plain "[" or "(" is a normal-size character: it does NOT stretch to the height of
// the matrix, so the numbers poke out above and below the little brackets.
// The proper LaTeX form is \begin{bmatrix}...\end{bmatrix} (square), pmatrix (round)
// or vmatrix (bars), whose delimiters stretch with the content. This rewrites the
// first form into the second. Only matched pairs ( [..] (..) |..| ) around a whole
// matrix/array/smallmatrix environment are touched; anything else is left alone.
const _MATRIX_WRAP_REGEX = new RegExp(
    // opening delimiter: [  (  |  \{  \|  \lbrack \lbrace \lvert \lVert, optionally sized
    // with \left / \big / \Big / \bigg / \Bigg (+ l)
    String.raw`(?:\\(?:left|[bB]igg?l?)\s*)?(\\lbrack|\\lbrace|\\lvert|\\lVert|\\\{|\\\||\[|\(|\|)(?:\s|\\[,;:! ])*` +
    String.raw`\\begin\{(matrix|array|smallmatrix)\}(\{[^{}]*\})?` +
    String.raw`([\s\S]*?)` +
    String.raw`\\end\{\2\}(?:\s|\\[,;:! ])*(?:\\(?:right|[bB]igg?r?)\s*)?(\\rbrack|\\rbrace|\\rvert|\\rVert|\\\}|\\\||\]|\)|\|)`,
    'g'
);
const _MATRIX_OPEN_MAP  = { '[': '[', '\\lbrack': '[', '(': '(', '|': '|', '\\lvert': '|',
                            '\\{': '{', '\\lbrace': '{', '\\|': '||', '\\lVert': '||' };
const _MATRIX_CLOSE_MAP = { ']': ']', '\\rbrack': ']', ')': ')', '|': '|', '\\rvert': '|',
                            '\\}': '}', '\\rbrace': '}', '\\|': '||', '\\rVert': '||' };
const _MATRIX_PAIR_ENV  = { '[]': 'bmatrix', '()': 'pmatrix', '||': 'vmatrix', '{}': 'Bmatrix', '||||': 'Vmatrix' };

function _upgradeOneMatrixMatch(full, open, env, spec, body, close) {
    const name = _MATRIX_PAIR_ENV[(_MATRIX_OPEN_MAP[open] || '?') + (_MATRIX_CLOSE_MAP[close] || '?')];
    if (!name) return full;                                                   // e.g. an interval [a, b) - not a matrix
    if (env === 'array' && spec && spec.indexOf('|') !== -1) return full;     // augmented matrix keeps its own rules
    return '\\begin{' + name + '}' + body + '\\end{' + name + '}';
}
function upgradeBracketedMatrices(text) {
    if (!text || text.indexOf('\\begin{') === -1) return text;
    const re = new RegExp(_MATRIX_WRAP_REGEX.source, 'g');
    return text.replace(re, (full, open, env, spec, body, close) =>
        _upgradeOneMatrixMatch(full, open, env, spec, body, close));
}
// Same fix for ordinary prose/HTML text nodes (outside any $...$): the repaired matrix
// is wrapped in $...$ so it still renders INLINE next to the surrounding words.
function upgradeBracketedMatricesInProse(text) {
    if (!text || text.indexOf('\\begin{') === -1) return text;
    // Find every already-delimited math range ($$..$$, \[..\], \(..\), $..$). The old code only
    // counted "$" characters, so a matrix inside $$...$$ (an EVEN count before it) was wrapped in
    // an extra $...$, which tore the display equation apart.
    const ranges = [];
    const rangeRe = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?:\\.|[^$\\])+\$/g;
    let r;
    while ((r = rangeRe.exec(text)) !== null) ranges.push([r.index, r.index + r[0].length]);
    const insideMath = pos => ranges.some(x => pos >= x[0] && pos < x[1]);

    let out = '', last = 0, m;
    const re = new RegExp(_MATRIX_WRAP_REGEX.source, 'g');
    while ((m = re.exec(text)) !== null) {
        const fixed = _upgradeOneMatrixMatch(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (fixed === m[0]) continue;
        out += text.slice(last, m.index) + (insideMath(m.index) ? fixed : '$' + fixed + '$');
        last = m.index + m[0].length;
    }
    return out + text.slice(last);
}

// ===== KATEX SPAN CREATION =====
function normalizeEquationLatexSource(latex) {
    let value = String(latex || '').trim();
    if (!value) return '';
    // Collapse accidental double-escaping from JSON / AI output (e.g. "\\\\alpha"
    // arriving as "\\alpha" instead of "\alpha"), but ONLY when the resulting
    // command is a real, known LaTeX command. A blanket "\\\\ -> \\" collapse
    // (the previous behavior) also matches the legitimate "\\\\" row-break used
    // inside \begin{matrix}/\begin{cases}/\begin{aligned} environments and
    // silently corrupts every multi-line equation, so we never touch a double
    // backslash unless it is clearly an over-escaped command name.
    value = value.replace(/\\\\([A-Za-z]+)/g, (full, cmd) => (isKnownLatexCommand(cmd) ? '\\' + cmd : full));
    // Same idea for over-escaped special characters (\\\\% , \\\\$ , \\\\& , ...)
    value = value.replace(/\\\\([%$&_{}#])/g, '\\$1');
    // Remove surrounding delimiters if present
    value = value.replace(/^\$\$([\s\S]*?)\$\$$/, '$1').trim();
    value = value.replace(/^\\\[([\s\S]*?)\\\]$/, '$1').trim();
    value = value.replace(/^\$([\s\S]*?)\$$/, '$1').trim();
    value = value.replace(/^\\\(([\s\S]*?)\\\)$/, '$1').trim();
    value = restoreLostEnvironmentBackslashes(value);
    value = upgradeBracketedMatrices(value);
    // Common AI artifacts
    value = value.replace(/\\operatorname\s*\{/g, '\\operatorname{');
    value = value.replace(/\u00a0/g, ' ');
    return value;
}

function createKatexSpanElement(latex, isDisplayMode) {
    const span = document.createElement('span');
    span.className = 'katex-eq';
    span.setAttribute('data-latex', normalizeEquationLatexSource(latex));
    span.setAttribute('data-display', isDisplayMode ? 'true' : 'false');
    span.setAttribute('contenteditable', 'false');
    span.setAttribute('translate', 'no');
    span.setAttribute('spellcheck', 'false');
    return span;
}

const RAW_LATEX_COMMAND_REGEX = /\\([A-Za-z]+)/;
const MATH_CHARSET_RUN_REGEX = /[A-Za-z0-9+\-*/=<>≤≥.,;:(){}\[\]^_|'"~&×÷·°√∞≠≈∑∫πθλµσΩαβγδ\\ \t]+/g;

function appendAutoWrappedLatex(fragment, textPart) {
    // Scan for LaTeX commands and wrap only known ones; unknown commands become plain text.
    let last = 0;
    const cmdRegex = /\\[A-Za-z]+/g;
    let match;
    while ((match = cmdRegex.exec(textPart)) !== null) {
        const startPos = match.index;
        const extracted = extractLatexCommandWithArgs(textPart, startPos);
        if (!extracted) continue;
        const { cmd, args, endPos } = extracted;
        if (isKnownLatexCommand(cmd)) {
            // Add preceding text
            if (startPos > last) {
                fragment.appendChild(document.createTextNode(textPart.slice(last, startPos)));
            }
            // Build the LaTeX string
            const latex = buildLatexFromCommand(cmd, args);
            // Create the math span
            fragment.appendChild(createKatexSpanElement(latex, false));
            last = endPos;
        } else {
            // UNKNOWN COMMAND: render as plain text (remove backslash)
            if (startPos > last) {
                fragment.appendChild(document.createTextNode(textPart.slice(last, startPos)));
            }
            // Insert the command name without the backslash
            fragment.appendChild(document.createTextNode(cmd));
            last = endPos;
        }
    }
    if (last < textPart.length) {
        fragment.appendChild(document.createTextNode(textPart.slice(last)));
    }
}

// ===== SPAN STATE HELPERS =====
function isKatexSpanBroken(spanElement) {
    if (!spanElement) return true;
    if (spanElement.classList.contains('katex-render-failed')) return true;
    if (spanElement.getAttribute('data-render-pending') === 'true') return true;
    if (spanElement.querySelector('.katex-error')) return true;
    if (!spanElement.querySelector('.katex')) return true;
    // Equation that was rendered earlier (saved/restored document, older renderer) with plain
    // [ ] / ( ) around a matrix: its stored source can be upgraded, so it must be re-rendered.
    const stored = spanElement.getAttribute('data-latex') || '';
    if (restoreLostEnvironmentBackslashes(stored) !== stored) return true;
    if (stored.indexOf('\\begin{') !== -1 && upgradeBracketedMatrices(stored) !== stored) return true;
    return false;
}

function showLatexFallback(spanElement, latexString) {
    if (!spanElement) return;
    const isDisplay = spanElement.getAttribute('data-display') === 'true';
    spanElement.innerHTML = ''; // clear
    const fallback = document.createElement(isDisplay ? 'div' : 'span');
    fallback.className = 'katex-fallback';
    fallback.style.cssText = isDisplay
        ? 'font-family:Cambria Math,STIX Two Math,serif;font-style:italic;text-align:center;padding:4px 0;color:inherit;opacity:0.92;'
        : 'font-family:Cambria Math,STIX Two Math,serif;font-style:italic;color:inherit;opacity:0.92;';
    // Escape HTML to avoid injection
    fallback.textContent = latexString || spanElement.getAttribute('data-latex') || '';
    spanElement.appendChild(fallback);
}

// ===== KATEX RENDERING WITH MACROS =====
// ===== KATEX RENDER CACHE =====
// Only successful renders are stored. Bounded by total characters so a huge document cannot
// grow it without limit (oldest entries are dropped first).
const _katexRenderCache = new Map();
let _katexRenderCacheChars = 0;
const _KATEX_CACHE_MAX_CHARS = 24000000;
function _katexCacheStore(key, html) {
    if (typeof html !== 'string' || !html) return;
    if (_katexRenderCache.has(key)) return;
    _katexRenderCache.set(key, html);
    _katexRenderCacheChars += html.length + key.length;
    if (_katexRenderCacheChars > _KATEX_CACHE_MAX_CHARS) {
        for (const k of _katexRenderCache.keys()) {
            const v = _katexRenderCache.get(k);
            _katexRenderCache.delete(k);
            _katexRenderCacheChars -= (v ? v.length : 0) + k.length;
            if (_katexRenderCacheChars <= _KATEX_CACHE_MAX_CHARS * 0.8) break;
        }
    }
}

// A span that is already rendered correctly AND whose stored source is already in normalized form
// would come out of a forced re-render exactly as it is, so such a re-render can be skipped.
function _katexSpanNeedsRender(spanElement) {
    if (isKatexSpanBroken(spanElement)) return true;
    const stored = spanElement.getAttribute('data-latex') || '';
    return normalizeEquationLatexSource(stored) !== stored;
}

function renderKatexSpanWithRecovery(spanElement, force = false) {
    if (!spanElement) return false;
    if (!isKatexReady()) {
        spanElement.setAttribute('data-render-pending', 'true');
        return false;
    }

    const original = normalizeEquationLatexSource(spanElement.getAttribute('data-latex') || '');
    if (!original) {
        spanElement.classList.add('katex-render-failed');
        return false;
    }

    if (!force && !isKatexSpanBroken(spanElement)) return true;

    const isDisplayMode = spanElement.getAttribute('data-display') === 'true';
    const candidates = [];
    const push = v => {
        const x = String(v || '').trim();
        if (x && !candidates.includes(x)) candidates.push(x);
    };
    push(original);
    push(original.replace(/\\displaystyle\s*/g, ''));
    push(original.replace(/\\left\s*/g, '\\left').replace(/\\right\s*/g, '\\right'));
    push(original.replace(/\\dfrac/g, '\\frac').replace(/\\tfrac/g, '\\frac'));
    push(original.replace(/\\left\b/g, '').replace(/\\right\b/g, ''));
    if (/^\{[\s\S]+\}$/.test(original)) push(original.slice(1, -1));

    const macros = getCustomKaTeXMacros();

    for (const latexString of candidates) {
        try {
            // Same LaTeX + same display mode + same options/macros always gives the same KaTeX markup,
            // so a result that was already produced once (earlier pagination run, earlier forced pass,
            // another copy of the same formula) is simply put back instead of being computed again.
            const cacheKey = (isDisplayMode ? 'D' : 'I') + '\u0001' + latexString;
            const cachedHtml = _katexRenderCache.get(cacheKey);
            if (cachedHtml !== undefined) {
                spanElement.innerHTML = cachedHtml;
                if (spanElement.querySelector('.katex') && !spanElement.querySelector('.katex-error')) {
                    spanElement.setAttribute('data-latex', latexString);
                    spanElement.classList.remove('katex-render-failed');
                    spanElement.removeAttribute('data-render-pending');
                    return true;
                }
                _katexRenderCache.delete(cacheKey); // should never happen; fall through to a real render
            }
            spanElement.innerHTML = '';
            katex.render(latexString, spanElement, {
                throwOnError: false,
                displayMode: isDisplayMode,
                // Restrict "trust" instead of allowing it blanket: math content
                // in this app comes from AI output, and \href/\includegraphics
                // with an arbitrary (e.g. "javascript:") URL is an XSS vector.
                // Only allow http(s) links; everything else (raw HTML embeds,
                // \includegraphics, etc.) stays untrusted.
                trust: (context) => {
                    if (context.command === '\\href' || context.command === '\\url') {
                        return /^https?:\/\//i.test(String(context.url || ''));
                    }
                    return false;
                },
                strict: 'ignore',
                output: 'htmlAndMathml',
                macros: macros,
                maxSize: 25,
                maxExpand: 1000
            });
            if (spanElement.querySelector('.katex') && !spanElement.querySelector('.katex-error')) {
                spanElement.setAttribute('data-latex', latexString);
                spanElement.classList.remove('katex-render-failed');
                spanElement.removeAttribute('data-render-pending');
                _katexCacheStore(cacheKey, spanElement.innerHTML);
                return true;
            }
        } catch (e) {
            console.warn('[KaTeX] render attempt failed:', latexString, e);
        }
    }

    spanElement.classList.add('katex-render-failed');
    spanElement.setAttribute('data-render-pending', 'true');
    showLatexFallback(spanElement, original);
    return false;
}

function renderAllKatexVisuals(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return;
    if (!isKatexReady()) {
        containerElement.querySelectorAll('.katex-eq').forEach(span => {
            if (isKatexSpanBroken(span)) span.setAttribute('data-render-pending', 'true');
        });
        return;
    }
    containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
        if (isKatexSpanBroken(spanElement)) {
            renderKatexSpanWithRecovery(spanElement, true);
        }
    });
}

function forceRenderAllKatexVisuals(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return;
    if (!isKatexReady()) {
        containerElement.querySelectorAll('.katex-eq').forEach(span => {
            span.setAttribute('data-render-pending', 'true');
        });
        return;
    }
    containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
        if (_katexSpanNeedsRender(spanElement)) renderKatexSpanWithRecovery(spanElement, true);
    });
}

// ===== FIND BROKEN DIAGRAMS =====
function findBrokenDiagrams(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return [];
    const broken = [];
    containerElement.querySelectorAll('.fc-wrapper').forEach((wrapper, i) => {
        const svg = wrapper.querySelector('svg.fc-svg, svg');
        const hasDrawable = !!(svg && svg.querySelector('rect, circle, ellipse, line, path, polyline, polygon, text, image, foreignObject'));
        if (!svg || !hasDrawable) broken.push(wrapper.getAttribute('data-diagram-id') || ('diagram_' + i));
    });
    return broken;
}

function ensureAllPagesMathRendered() {
    forceRenderAllEquations();
}

function findBrokenEquations(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return [];
    return Array.from(containerElement.querySelectorAll('.katex-eq')).filter(eq =>
        isKatexSpanBroken(eq)
    ).map(eq => eq.getAttribute('data-latex') || '').filter(Boolean);
}

function shrinkOverflowingKatexEquations(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
    const displays = Array.from(rootEl.querySelectorAll('.katex-display'));
    if (!displays.length) return;
    // Same result as handling one equation at a time, but all writes first, then all reads, then the
    // final writes: the old write/read/write per equation forced a full layout for EVERY equation.
    const wrappers = displays.map(function(disp) {
        disp.style.fontSize = '';
        disp.style.overflow = 'visible';
        disp.style.overflowX = 'visible';
        disp.style.overflowY = 'visible';
        disp.style.scrollbarWidth = 'none';
        const wrapper = disp.closest('.katex-eq') || disp.parentElement;
        if (wrapper) {
            wrapper.style.overflow = 'visible';
            wrapper.style.background = 'transparent';
            wrapper.style.boxShadow = 'none';
            wrapper.style.border = 'none';
        }
        return wrapper;
    });
    const sizes = displays.map(function(disp, idx) {
        const wrapper = wrappers[idx];
        const available = (wrapper && wrapper.clientWidth) || disp.clientWidth;
        const content = disp.scrollWidth;
        if (available > 0 && content > available + 1) {
            let ratio = available / content;
            ratio = Math.max(0.4, Math.min(ratio, 1));
            const baseSize = parseFloat(window.getComputedStyle(disp).fontSize) || 16;
            return baseSize * ratio;
        }
        return 0;
    });
    displays.forEach(function(disp, idx) {
        if (sizes[idx]) disp.style.fontSize = sizes[idx] + 'px';
    });
}

function prepareEquationsForPDF(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('.katex-eq').forEach(function(eq) {
        eq.style.background = 'transparent';
        eq.style.border = 'none';
        eq.style.boxShadow = 'none';
        eq.style.overflow = 'visible';
    });
    rootEl.querySelectorAll('.katex-display').forEach(function(disp) {
        disp.style.overflow = 'visible';
        disp.style.overflowX = 'visible';
        disp.style.overflowY = 'visible';
        disp.style.scrollbarWidth = 'none';
        disp.style.maxWidth = '100%';
    });
    shrinkOverflowingKatexEquations(rootEl);
}

function forceRenderAllEquations() {
    const docContainer = document.getElementById('document-view-container');
    if (!docContainer) return;
    ensureKatexDelimiterFonts();   // async; the fallback class is applied as soon as the result is known

    const run = () => {
        const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
        pages.forEach(page => {
            processMathEquationsInContainer(page);
        });

        // Up to 4 recovery passes as before, but a pass only touches equations that still need work
        // (everything already rendered correctly is left exactly as it is), and the loop stops as soon
        // as nothing is left to fix. Shrinking runs once, in one batch, after the final render.
        for (let pass = 0; pass < 4; pass++) {
            pages.forEach(page => forceRenderAllKatexVisuals(page));
            if (!findBrokenEquations(docContainer).length) break;
        }
        shrinkOverflowingKatexEquations(docContainer);

        const broken = findBrokenEquations(docContainer);
        if (broken.length) {
            console.warn(`[KaTeX] ${broken.length} equation(s) still need recovery.`);
            docContainer.querySelectorAll('.katex-eq').forEach(eq => {
                if (isKatexSpanBroken(eq)) {
                    const latex = normalizeEquationLatexSource(eq.getAttribute('data-latex') || '');
                    if (latex) {
                        eq.setAttribute('aria-label', latex);
                        if (!eq.querySelector('.katex') && !eq.querySelector('.katex-fallback')) {
                            showLatexFallback(eq, latex);
                        }
                    }
                }
            });
        }

        // Pages are paginated BEFORE this function runs, using whatever height
        // each equation had at that moment (often an unrendered/placeholder
        // size). KaTeX can render a source — especially matrices, stacked
        // fractions, or tall bracketed expressions — noticeably taller than
        // its placeholder, so a block that fit on a page during pagination can
        // grow past the page's fixed A4 height right here, after the fact.
        // The page clips overflow (overflow:hidden), so that extra height used
        // to just get silently cut off, with the fixed page-number footer left
        // sitting on top of the clipped tail of content. Re-check every page
        // now that real KaTeX sizes are in and reflow anything that overflows
        // so the excess content moves to the next page instead of being cut
        // off. Guarded against re-entrancy since reflowDocument() itself calls
        // back into this function once it is done moving content.
        if (typeof reflowDocument === 'function' && !window.__mathRenderReflowGuard) {
            const a4Height = typeof EDITOR_A4_HEIGHT !== 'undefined' ? EDITOR_A4_HEIGHT : 1123;
            const overflowedCount = pages.filter(page => page.scrollHeight > a4Height + 1).length;
            if (overflowedCount) {
                // Re-running the same reflow on the very same situation cannot change anything (that is
                // what kept the render -> reflow -> render recovery cycle going); only repeat it when the
                // overflow picture (pages overflowing / page count) differs from the last attempt.
                const overflowSig = overflowedCount + '|' + pages.length;
                if (window.__mathLastOverflowSig !== overflowSig) {
                    window.__mathLastOverflowSig = overflowSig;
                    window.__mathRenderReflowGuard = true;
                    try { reflowDocument(); } finally { window.__mathRenderReflowGuard = false; }
                }
            } else {
                window.__mathLastOverflowSig = null;
            }
        }
    };

    if (isKatexReady()) {
        run();
    } else {
        waitForKatex(5000).then(ok => {
            if (ok) run();
            else console.warn('[KaTeX] library not available after wait; equations left pending.');
        });
    }
}

let _equationRecoveryTimer = null;
function scheduleEquationRecovery(delayMs) {
    clearTimeout(_equationRecoveryTimer);
    _equationRecoveryTimer = setTimeout(() => {
        try {
            forceRenderAllEquations();
        } catch (e) {
            console.warn('[KaTeX] scheduled recovery failed:', e);
        }
    }, Math.max(0, Number(delayMs) || 120));
}

function convertKatexSpansToLatexSource(htmlString) {
    const temp = document.createElement('div');
    temp.innerHTML = htmlString;
    temp.querySelectorAll('.katex-eq').forEach(eq => {
        const latex = eq.getAttribute('data-latex') || eq.textContent || '';
        const isDisplay = eq.getAttribute('data-display') === 'true';
        const delimiter = isDisplay ? '$$' : '$';
        eq.parentNode.replaceChild(document.createTextNode(delimiter + latex + delimiter), eq);
    });
    return temp.innerHTML;
}

function getCanvasContentWithLatexSource() {
    const docContainer = document.getElementById('document-view-container');
    if (!docContainer) return '';
    let combinedHTML = '';
    Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
        const clone = page.cloneNode(true);
        clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
        combinedHTML += clone.innerHTML;
    });
    return convertKatexSpansToLatexSource(combinedHTML);
}

// ============================================================
// WINDOW EXPOSURE – Math Renderer
// ============================================================
window.processMathEquationsInContainer = processMathEquationsInContainer;
window.renderAllKatexVisuals = renderAllKatexVisuals;
window.forceRenderAllEquations = forceRenderAllEquations;
window.forceRenderAllKatexVisuals = forceRenderAllKatexVisuals;
window.processMathEquationsToHTML = processMathEquationsToHTML;
window.convertKatexSpansToLatexSource = convertKatexSpansToLatexSource;
window.shrinkOverflowingKatexEquations = shrinkOverflowingKatexEquations;
window.prepareEquationsForPDF = prepareEquationsForPDF;
window.normalizeAIHTMLTextArtifacts = normalizeAIHTMLTextArtifacts;
window.findBrokenEquations = findBrokenEquations;
window.findBrokenDiagrams = findBrokenDiagrams;
window.ensureAllPagesMathRendered = ensureAllPagesMathRendered;
window.repairVisibleEscapeSequencesInText = repairVisibleEscapeSequencesInText;
window.scheduleEquationRecovery = scheduleEquationRecovery;
window.isKatexReady = isKatexReady;
window.waitForKatex = waitForKatex;
window.isKatexSpanBroken = isKatexSpanBroken;
window.getCustomKaTeXMacros = getCustomKaTeXMacros;
window.isKnownLatexCommand = isKnownLatexCommand;
window.upgradeBracketedMatrices = upgradeBracketedMatrices;
window.ensureKatexDelimiterFonts = ensureKatexDelimiterFonts;
window.installKatexDelimiterFontGuard = installKatexDelimiterFontGuard;
window.buildLatexFromCommand = buildLatexFromCommand;
window.restoreLostEnvironmentBackslashes = restoreLostEnvironmentBackslashes;