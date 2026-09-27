/**
 * Super Debug — Lightweight Code Editor
 *
 * A minimal, self-contained code editor with:
 * - Syntax highlighting (JS and CSS)
 * - Line numbers
 * - Dark theme with green accent
 * - Tab key handling (inserts spaces)
 * - Bracket matching
 * - Synchronized scrolling (textarea + highlight overlay)
 *
 * Architecture: textarea (input) + pre (highlight overlay) + gutter (line numbers)
 *
 * Exports: createEditor(container, options) → EditorInstance
 */

// =============================================================================
// Tokenizers
// =============================================================================

const JS_KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this',
    'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'
]);

const JS_BUILTINS = new Set([
    'console', 'window', 'document', 'navigator', 'Array', 'Object', 'String',
    'Number', 'Boolean', 'Promise', 'Map', 'Set', 'RegExp', 'Error', 'JSON',
    'Math', 'Date', 'Symbol', 'Proxy', 'Reflect', 'globalThis', 'undefined',
    'null', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'setTimeout',
    'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'Request',
    'Response', 'URL', 'URLSearchParams', 'Headers', 'FormData'
]);

const CSS_KEYWORDS = new Set([
    '@media', '@keyframes', '@import', '@font-face', '@supports', '@charset',
    '@namespace', '@page', '@layer', '@container', '!important'
]);

const CSS_PROPERTIES = new Set([
    'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
    'margin', 'padding', 'border', 'background', 'color', 'font', 'font-size',
    'font-weight', 'font-family', 'line-height', 'text-align', 'text-decoration',
    'opacity', 'z-index', 'overflow', 'flex', 'grid', 'gap', 'align-items',
    'justify-content', 'transition', 'transform', 'animation', 'box-shadow',
    'border-radius', 'cursor', 'visibility', 'content', 'max-width', 'min-width',
    'max-height', 'min-height', 'outline', 'white-space', 'word-wrap',
    'text-overflow', 'box-sizing', 'float', 'clear', 'vertical-align',
    'letter-spacing', 'text-transform', 'list-style', 'pointer-events',
    'user-select', 'resize', 'appearance', 'filter', 'backdrop-filter',
    'object-fit', 'scroll-behavior', 'accent-color', 'aspect-ratio'
]);

/**
 * Tokenize JavaScript code into highlighted spans.
 */
function tokenizeJS(code) {
    let result = '';
    let i = 0;
    const len = code.length;

    while (i < len) {
        // Single-line comment
        if (code[i] === '/' && code[i + 1] === '/') {
            let end = code.indexOf('\n', i);
            if (end === -1) end = len;
            result += span('comment', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Multi-line comment
        if (code[i] === '/' && code[i + 1] === '*') {
            let end = code.indexOf('*/', i + 2);
            if (end === -1) end = len;
            else end += 2;
            result += span('comment', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Regex literal (basic detection)
        if (code[i] === '/' && i > 0 && isRegexContext(code, i)) {
            let end = i + 1;
            let escaped = false;
            let inCharClass = false;
            while (end < len) {
                if (escaped) { escaped = false; end++; continue; }
                if (code[end] === '\\') { escaped = true; end++; continue; }
                if (code[end] === '[') { inCharClass = true; end++; continue; }
                if (code[end] === ']') { inCharClass = false; end++; continue; }
                if (code[end] === '/' && !inCharClass) { end++; break; }
                end++;
            }
            // Consume flags
            while (end < len && /[gimsuy]/.test(code[end])) end++;
            result += span('regex', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // String (single quote)
        if (code[i] === "'") {
            let end = i + 1;
            while (end < len && code[end] !== "'" && code[end] !== '\n') {
                if (code[end] === '\\') end++;
                end++;
            }
            if (end < len && code[end] === "'") end++;
            result += span('string', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // String (double quote)
        if (code[i] === '"') {
            let end = i + 1;
            while (end < len && code[end] !== '"' && code[end] !== '\n') {
                if (code[end] === '\\') end++;
                end++;
            }
            if (end < len && code[end] === '"') end++;
            result += span('string', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Template literal
        if (code[i] === '`') {
            let end = i + 1;
            while (end < len && code[end] !== '`') {
                if (code[end] === '\\') end++;
                end++;
            }
            if (end < len) end++;
            result += span('string', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Number
        if (/\d/.test(code[i]) && (i === 0 || !/\w/.test(code[i - 1]))) {
            let end = i;
            if (code[end] === '0' && (code[end + 1] === 'x' || code[end + 1] === 'X')) {
                end += 2;
                while (end < len && /[0-9a-fA-F]/.test(code[end])) end++;
            } else {
                while (end < len && /[\d.]/.test(code[end])) end++;
                if (end < len && (code[end] === 'e' || code[end] === 'E')) {
                    end++;
                    if (end < len && (code[end] === '+' || code[end] === '-')) end++;
                    while (end < len && /\d/.test(code[end])) end++;
                }
            }
            result += span('number', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Word (identifier / keyword)
        if (/[a-zA-Z_$]/.test(code[i])) {
            let end = i;
            while (end < len && /[\w$]/.test(code[end])) end++;
            const word = code.slice(i, end);

            if (JS_KEYWORDS.has(word)) {
                result += span('keyword', escapeHtml(word));
            } else if (word === 'true' || word === 'false') {
                result += span('boolean', escapeHtml(word));
            } else if (word === 'null' || word === 'undefined' || word === 'NaN') {
                result += span('null', escapeHtml(word));
            } else if (end < len && code[end] === '(') {
                result += span('function', escapeHtml(word));
            } else if (JS_BUILTINS.has(word)) {
                result += span('function', escapeHtml(word));
            } else {
                result += escapeHtml(word);
            }
            i = end;
            continue;
        }

        // Operators
        if ('=+-*/<>!&|^~%?:'.includes(code[i])) {
            let end = i + 1;
            // Multi-char operators
            while (end < len && '=+-*/<>!&|^~%?'.includes(code[end]) && (end - i) < 4) end++;
            result += span('operator', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Punctuation
        if ('{}[]();,.'.includes(code[i])) {
            result += span('punctuation', escapeHtml(code[i]));
            i++;
            continue;
        }

        // Newline — preserve as-is
        if (code[i] === '\n') {
            result += '\n';
            i++;
            continue;
        }

        // Anything else
        result += escapeHtml(code[i]);
        i++;
    }

    return result;
}

/**
 * Tokenize CSS code into highlighted spans.
 */
function tokenizeCSS(code) {
    let result = '';
    let i = 0;
    const len = code.length;

    while (i < len) {
        // Comment
        if (code[i] === '/' && code[i + 1] === '*') {
            let end = code.indexOf('*/', i + 2);
            if (end === -1) end = len;
            else end += 2;
            result += span('comment', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // String (single or double)
        if (code[i] === '"' || code[i] === "'") {
            const quote = code[i];
            let end = i + 1;
            while (end < len && code[end] !== quote && code[end] !== '\n') {
                if (code[end] === '\\') end++;
                end++;
            }
            if (end < len && code[end] === quote) end++;
            result += span('string', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // At-rules (@media, @keyframes, etc.)
        if (code[i] === '@') {
            let end = i + 1;
            while (end < len && /[\w-]/.test(code[end])) end++;
            const word = code.slice(i, end);
            result += span('keyword', escapeHtml(word));
            i = end;
            continue;
        }

        // !important
        if (code[i] === '!' && code.slice(i, i + 10) === '!important') {
            result += span('keyword', '!important');
            i += 10;
            continue;
        }

        // Numbers (with optional units)
        if (/\d/.test(code[i]) || (code[i] === '.' && i + 1 < len && /\d/.test(code[i + 1]))) {
            let end = i;
            while (end < len && /[\d.]/.test(code[end])) end++;
            // CSS units
            while (end < len && /[a-zA-Z%]/.test(code[end])) end++;
            result += span('number', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Hex colors
        if (code[i] === '#' && i + 1 < len && /[0-9a-fA-F]/.test(code[i + 1])) {
            let end = i + 1;
            while (end < len && /[0-9a-fA-F]/.test(code[end])) end++;
            result += span('number', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Word (property names, selectors, values)
        if (/[a-zA-Z_-]/.test(code[i])) {
            let end = i;
            while (end < len && /[\w-]/.test(code[end])) end++;
            const word = code.slice(i, end);

            // Check if it's a property (followed by colon)
            let afterEnd = end;
            while (afterEnd < len && code[afterEnd] === ' ') afterEnd++;

            if (afterEnd < len && code[afterEnd] === ':') {
                result += span('property', escapeHtml(word));
            } else if (end < len && code[end] === '(') {
                result += span('function', escapeHtml(word));
            } else if (CSS_KEYWORDS.has(word)) {
                result += span('keyword', escapeHtml(word));
            } else {
                result += escapeHtml(word);
            }
            i = end;
            continue;
        }

        // Selectors: . # : *
        if (code[i] === '.' && i + 1 < len && /[a-zA-Z_-]/.test(code[i + 1])) {
            let end = i + 1;
            while (end < len && /[\w-]/.test(code[end])) end++;
            result += span('tag', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        if (code[i] === '#' && i + 1 < len && /[a-zA-Z_-]/.test(code[i + 1])) {
            let end = i + 1;
            while (end < len && /[\w-]/.test(code[end])) end++;
            result += span('tag', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Pseudo-classes/elements
        if (code[i] === ':' && i + 1 < len && /[a-zA-Z]/.test(code[i + 1])) {
            let end = i + 1;
            while (end < len && /[\w-]/.test(code[end])) end++;
            result += span('keyword', escapeHtml(code.slice(i, end)));
            i = end;
            continue;
        }

        // Punctuation
        if ('{}();,'.includes(code[i])) {
            result += span('punctuation', escapeHtml(code[i]));
            i++;
            continue;
        }

        // Colon and semicolon in CSS
        if (code[i] === ':' || code[i] === ';') {
            result += span('punctuation', escapeHtml(code[i]));
            i++;
            continue;
        }

        // Newline
        if (code[i] === '\n') {
            result += '\n';
            i++;
            continue;
        }

        // Anything else
        result += escapeHtml(code[i]);
        i++;
    }

    return result;
}

// =============================================================================
// Helpers
// =============================================================================

function span(tokenType, content) {
    return `<span class="sd-tok-${tokenType}">${content}</span>`;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isRegexContext(code, i) {
    // Look backwards for characters that indicate a regex follows
    let j = i - 1;
    while (j >= 0 && code[j] === ' ') j--;
    if (j < 0) return true;
    const ch = code[j];
    return '=([{,;!&|?:~^%*/+-'.includes(ch) || ch === '\n';
}

// =============================================================================
// Editor Class
// =============================================================================

class SDEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.language = options.language || 'js';
        this.initialCode = options.code || '';
        this.placeholder = options.placeholder || '// Write your code here...';
        this.onChange = options.onChange || null;

        this._buildDOM();
        this._bindEvents();
        this.setContent(this.initialCode);
    }

    _buildDOM() {
        // Clear container
        this.container.innerHTML = '';

        // Root
        this.root = document.createElement('div');
        this.root.className = 'sd-editor';

        // Wrapper (gutter + code)
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'sd-editor-wrapper';

        // Gutter
        this.gutter = document.createElement('div');
        this.gutter.className = 'sd-editor-gutter';
        this.gutterInner = document.createElement('div');
        this.gutterInner.className = 'sd-editor-gutter-inner';
        this.gutter.appendChild(this.gutterInner);

        // Code container
        this.codeContainer = document.createElement('div');
        this.codeContainer.className = 'sd-editor-code';

        // Highlight layer (pre)
        this.highlight = document.createElement('pre');
        this.highlight.className = 'sd-editor-highlight';
        this.highlight.setAttribute('aria-hidden', 'true');

        // Textarea layer
        this.textarea = document.createElement('textarea');
        this.textarea.className = 'sd-editor-textarea';
        this.textarea.spellcheck = false;
        this.textarea.autocomplete = 'off';
        this.textarea.autocapitalize = 'off';
        this.textarea.setAttribute('autocorrect', 'off');
        this.textarea.setAttribute('data-gramm', 'false');
        this.textarea.placeholder = this.placeholder;

        // Assemble
        this.codeContainer.appendChild(this.highlight);
        this.codeContainer.appendChild(this.textarea);
        this.wrapper.appendChild(this.gutter);
        this.wrapper.appendChild(this.codeContainer);
        this.root.appendChild(this.wrapper);
        this.container.appendChild(this.root);
    }

    _bindEvents() {
        // Input handling — re-highlight on change
        this.textarea.addEventListener('input', () => {
            this._update();
            if (this.onChange) this.onChange(this.textarea.value);
        });

        // Synchronized scrolling
        this.textarea.addEventListener('scroll', () => {
            this.highlight.scrollTop = this.textarea.scrollTop;
            this.highlight.scrollLeft = this.textarea.scrollLeft;
            this.gutter.scrollTop = this.textarea.scrollTop;
        });

        // Tab key — insert 2 spaces
        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;

                if (e.shiftKey) {
                    // Shift+Tab: dedent (remove leading spaces from current line)
                    this._dedentSelection(start, end);
                } else if (start !== end) {
                    // Tab with selection: indent all selected lines
                    this._indentSelection(start, end);
                } else {
                    // Single cursor: insert 2 spaces
                    const value = this.textarea.value;
                    this.textarea.value = value.slice(0, start) + '  ' + value.slice(end);
                    this.textarea.selectionStart = this.textarea.selectionEnd = start + 2;
                }
                this._update();
            }

            // Enter — auto-indent
            if (e.key === 'Enter') {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const value = this.textarea.value;

                // Find current line's indentation
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const line = value.slice(lineStart, start);
                const indent = line.match(/^(\s*)/)[1];

                // Check if line ends with { or (
                const trimmed = value.slice(lineStart, start).trimEnd();
                const lastChar = trimmed[trimmed.length - 1];
                const extraIndent = (lastChar === '{' || lastChar === '(' || lastChar === '[') ? '  ' : '';

                const insertion = '\n' + indent + extraIndent;
                this.textarea.value = value.slice(0, start) + insertion + value.slice(start);
                this.textarea.selectionStart = this.textarea.selectionEnd = start + insertion.length;
                this._update();
            }

            // Auto-close brackets
            if (e.key === '{' || e.key === '(' || e.key === '[') {
                const pairs = { '{': '}', '(': ')', '[': ']' };
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                const value = this.textarea.value;

                if (start === end) {
                    e.preventDefault();
                    const closing = pairs[e.key];
                    this.textarea.value = value.slice(0, start) + e.key + closing + value.slice(start);
                    this.textarea.selectionStart = this.textarea.selectionEnd = start + 1;
                    this._update();
                }
            }

            // Auto-close quotes
            if (e.key === "'" || e.key === '"' || e.key === '`') {
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                const value = this.textarea.value;

                // Don't auto-close if the next char is the same quote (just move cursor)
                if (value[start] === e.key && start === end) {
                    e.preventDefault();
                    this.textarea.selectionStart = this.textarea.selectionEnd = start + 1;
                    return;
                }

                if (start === end) {
                    // Don't auto-close if preceded by a word character (likely typing in a word)
                    if (start > 0 && /\w/.test(value[start - 1])) return;

                    e.preventDefault();
                    this.textarea.value = value.slice(0, start) + e.key + e.key + value.slice(start);
                    this.textarea.selectionStart = this.textarea.selectionEnd = start + 1;
                    this._update();
                }
            }
        });

        // Focus / blur styling
        this.textarea.addEventListener('focus', () => {
            this.root.classList.add('focused');
            this._updateActiveLine();
        });

        this.textarea.addEventListener('blur', () => {
            this.root.classList.remove('focused');
            // Remove active line highlight
            const activeLines = this.gutterInner.querySelectorAll('.active');
            activeLines.forEach(el => el.classList.remove('active'));
        });

        // Track cursor position for active line
        this.textarea.addEventListener('click', () => this._updateActiveLine());
        this.textarea.addEventListener('keyup', () => this._updateActiveLine());
    }

    _indentSelection(start, end) {
        const value = this.textarea.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;

        const block = value.slice(lineStart, actualEnd);
        const indented = block.split('\n').map(l => '  ' + l).join('\n');

        this.textarea.value = value.slice(0, lineStart) + indented + value.slice(actualEnd);
        this.textarea.selectionStart = start + 2;
        this.textarea.selectionEnd = end + (indented.length - block.length);
    }

    _dedentSelection(start, end) {
        const value = this.textarea.value;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const actualEnd = lineEnd === -1 ? value.length : lineEnd;

        const block = value.slice(lineStart, actualEnd);
        const dedented = block.split('\n').map(l => {
            if (l.startsWith('  ')) return l.slice(2);
            if (l.startsWith(' ')) return l.slice(1);
            if (l.startsWith('\t')) return l.slice(1);
            return l;
        }).join('\n');

        this.textarea.value = value.slice(0, lineStart) + dedented + value.slice(actualEnd);
        const diff = block.length - dedented.length;
        this.textarea.selectionStart = Math.max(lineStart, start - 2);
        this.textarea.selectionEnd = Math.max(this.textarea.selectionStart, end - diff);
    }

    _update() {
        const code = this.textarea.value;
        const tokenize = this.language === 'css' ? tokenizeCSS : tokenizeJS;
        this.highlight.innerHTML = tokenize(code) + '\n';
        this._updateLineNumbers();
    }

    _updateLineNumbers() {
        const lineCount = this.textarea.value.split('\n').length;
        let html = '';
        for (let i = 1; i <= lineCount; i++) {
            html += `<span class="sd-line-number" data-line="${i}">${i}</span>`;
        }
        this.gutterInner.innerHTML = html;
        this._updateActiveLine();
    }

    _updateActiveLine() {
        const value = this.textarea.value;
        const pos = this.textarea.selectionStart;
        const lineNum = value.slice(0, pos).split('\n').length;

        const lineEls = this.gutterInner.querySelectorAll('.sd-line-number');
        lineEls.forEach(el => {
            if (parseInt(el.dataset.line) === lineNum) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    }

    // ==========================================================================
    // Public API
    // ==========================================================================

    /**
     * Get the current editor content.
     * @returns {string}
     */
    getContent() {
        return this.textarea.value;
    }

    /**
     * Set the editor content.
     * @param {string} code
     */
    setContent(code) {
        this.textarea.value = code || '';
        this._update();
    }

    /**
     * Set the language mode (triggers re-highlight).
     * @param {'js'|'css'} lang
     */
    setLanguage(lang) {
        this.language = lang;
        this._update();
    }

    /**
     * Focus the editor textarea.
     */
    focus() {
        this.textarea.focus();
    }

    /**
     * Destroy the editor and clean up.
     */
    destroy() {
        this.container.innerHTML = '';
    }
}

// =============================================================================
// Factory Function (Public Export)
// =============================================================================

/**
 * Create a new code editor instance.
 *
 * @param {HTMLElement} container - The DOM element to render the editor into.
 * @param {Object} [options]
 * @param {string} [options.language='js'] - Language mode: 'js' or 'css'
 * @param {string} [options.code=''] - Initial code content
 * @param {string} [options.placeholder] - Placeholder text
 * @param {Function} [options.onChange] - Callback on content change
 * @returns {{ getContent: Function, setContent: Function, setLanguage: Function, focus: Function, destroy: Function }}
 */
export function createEditor(container, options = {}) {
    const editor = new SDEditor(container, options);
    return {
        getContent: () => editor.getContent(),
        setContent: (code) => editor.setContent(code),
        setLanguage: (lang) => editor.setLanguage(lang),
        focus: () => editor.focus(),
        destroy: () => editor.destroy()
    };
}

export default { createEditor };
