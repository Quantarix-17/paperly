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

function isKnownLatexCommand(cmd) {
    if (!cmd) return false;
    return KNOWN_LATEX_COMMANDS.has(String(cmd));
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

// ===== MATH ARTIFACT REPAIR =====
function repairVisibleEscapeSequencesInText(text) {
    let value = String(text || '');
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
    return value;
}

function normalizeAIHTMLTextArtifacts(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName) || parent.closest('.katex, .katex-eq'))
                return NodeFilter.FILTER_REJECT;
            return /\\[nrt]/.test(node.nodeValue) || /\\[A-Za-z]+/.test(node.nodeValue) ?
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
    '(\\\\left\\s*|\\\\bigl\\s*|\\\\Bigl\\s*)?(\\\\lbrack|\\\\lvert|\\[|\\(|\\|)\\s*' +
    '\\\\begin\\{(matrix|array|smallmatrix)\\}(\\{[^{}]*\\})?' +
    '([\\s\\S]*?)' +
    '\\\\end\\{\\3\\}\\s*' +
    '(\\\\right\\s*|\\\\bigr\\s*|\\\\Bigr\\s*)?(\\\\rbrack|\\\\rvert|\\]|\\)|\\|)',
    'g'
);
function upgradeBracketedMatrices(text) {
    if (!text || text.indexOf('\\begin{') === -1) return text;
    return text.replace(_MATRIX_WRAP_REGEX, (full, l1, open, env, spec, body, r1, close) => {
        const o = open === '\\lbrack' ? '[' : (open === '\\lvert' ? '|' : open);
        const c = close === '\\rbrack' ? ']' : (close === '\\rvert' ? '|' : close);
        let name = null;
        if (o === '[' && c === ']') name = 'bmatrix';
        else if (o === '(' && c === ')') name = 'pmatrix';
        else if (o === '|' && c === '|') name = 'vmatrix';
        if (!name) return full;                                   // e.g. an interval [a, b) - not a matrix
        if (env === 'array' && spec && spec.indexOf('|') !== -1) return full; // augmented matrix keeps its own rules
        return '\\begin{' + name + '}' + body + '\\end{' + name + '}';
    });
}
// Same fix for ordinary prose/HTML text nodes (outside any $...$): the repaired matrix
// is wrapped in $...$ so it still renders INLINE next to the surrounding words.
function upgradeBracketedMatricesInProse(text) {
    if (!text || text.indexOf('\\begin{') === -1) return text;
    let out = '', last = 0, m;
    // own regex instance: upgradeBracketedMatrices() uses the shared one and would reset lastIndex
    const re = new RegExp(_MATRIX_WRAP_REGEX.source, 'g');
    while ((m = re.exec(text)) !== null) {
        const fixed = upgradeBracketedMatrices(m[0]);
        if (fixed === m[0]) continue;
        const before = text.slice(0, m.index);
        const dollars = (before.replace(/\\\$/g, '').match(/\$/g) || []).length;
        const insideMath = dollars % 2 === 1;                      // odd number of $ before it = already inside math
        out += text.slice(last, m.index) + (insideMath ? fixed : '$' + fixed + '$');
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
        renderKatexSpanWithRecovery(spanElement, true);
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
    const displays = rootEl.querySelectorAll('.katex-display');
    displays.forEach(function(disp) {
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
        const available = (wrapper && wrapper.clientWidth) || disp.clientWidth;
        const content = disp.scrollWidth;
        if (available > 0 && content > available + 1) {
            let ratio = available / content;
            ratio = Math.max(0.4, Math.min(ratio, 1));
            const baseSize = parseFloat(window.getComputedStyle(disp).fontSize) || 16;
            disp.style.fontSize = (baseSize * ratio) + 'px';
        }
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

    const run = () => {
        const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
        pages.forEach(page => {
            processMathEquationsInContainer(page);
        });

        for (let pass = 0; pass < 4; pass++) {
            pages.forEach(page => {
                forceRenderAllKatexVisuals(page);
                shrinkOverflowingKatexEquations(page);
            });
        }

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
            const overflowed = pages.some(page => page.scrollHeight > a4Height + 1);
            if (overflowed) {
                window.__mathRenderReflowGuard = true;
                try { reflowDocument(); } finally { window.__mathRenderReflowGuard = false; }
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
window.buildLatexFromCommand = buildLatexFromCommand;