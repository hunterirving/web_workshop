let updateTimer;
let editorView;
const preview = document.getElementById('preview');

// Stock images loaded from manifest - can be referenced by bare filename
let stockImages = new Map(); // lowercase -> original filename

// Load stock image list from manifest
const stockImagesReady = fetch('resource-manifest.json')
	.then(r => r.json())
	.then(manifest => {
		manifest.images.forEach(path => {
			const filename = path.split('/').pop();
			stockImages.set(filename.toLowerCase(), filename);
		});
	})
	.catch(() => console.log('Could not load resource manifest'));

// Rewrite bare image filenames to use images/ prefix (case-insensitive, uses correct case)
function rewriteBareImageSrcs(html) {
	// Rewrite <img src="filename.ext">
	html = html.replace(/(<img\s[^>]*\bsrc\s*=\s*["'])([^"'/:]+\.(gif|png|jpg|jpeg|svg|webp))(["'])/gi,
		(match, before, filename, ext, after) => {
			const original = stockImages.get(filename.toLowerCase());
			if (original) {
				return before + 'images/' + original + after;
			}
			return match;
		});
	// Rewrite url(filename.ext) in CSS
	html = html.replace(/(url\(\s*["']?)([^"')/:]+\.(gif|png|jpg|jpeg|svg|webp))(["']?\s*\))/gi,
		(match, before, filename, ext, after) => {
			const original = stockImages.get(filename.toLowerCase());
			if (original) {
				return before + 'images/' + original + after;
			}
			return match;
		});
	return html;
}

// Expand <img src="?"> tags into gallery table
function expandImagesTag(html) {
	return html.replace(/<img\s+src\s*=\s*["']?\?["']?\s*\/?>/gi, () => {
		const images = Array.from(stockImages.values()).sort();
		if (images.length === 0) return '<p>No images available</p>';
		const rows = images.map(filename =>
			`<tr class="stock-image-row" data-filename="${filename}" style="cursor:pointer;"><td>${filename}</td><td style="text-align:center;"><img src="images/${filename}" style="max-width:100%;height:auto;"></td></tr>`
		).join('');
		return `<table class="stock-image-table" border="1" cellpadding="8" cellspacing="0" style="max-width:100%;box-sizing:border-box;table-layout:fixed;"><colgroup><col style="width:50%"><col style="width:50%"></colgroup>${rows}</table>`;
	});
}
const editorPane = document.querySelector('.editor-pane');
const previewPane = document.querySelector('.preview-pane');
const storageKey = 'html-lab-content';
let isFullscreen = false;
let showLineNumbers = false;
let enableLineWrapping = false;
let lineNumbersCompartment;
let lineWrappingCompartment;

function toggleFullscreen() {
	isFullscreen = !isFullscreen;

	if (isFullscreen) {
		previewPane.classList.add('fullscreen');
		editorPane.classList.add('hidden');
		// Set iframe height to actual visible height (fixes iOS Safari toolbar issue)
		preview.style.height = window.innerHeight + 'px';
	} else {
		previewPane.classList.remove('fullscreen');
		editorPane.classList.remove('hidden');
		preview.style.height = '';
	}

	// Update button title in iframe
	try {
		const toggleButton = preview.contentDocument.getElementById('fullscreenToggle');
		if (toggleButton) {
			toggleButton.title = isFullscreen ? 'Exit fullscreen' : 'Toggle fullscreen';
		}
	} catch (e) {
		// Ignore cross-origin errors
	}
}


// Listen for messages from iframe
window.addEventListener('message', function(event) {
	if (event.data === 'toggleFullscreen') {
		toggleFullscreen();
	}
});

function extractTitleAndFavicon(htmlCode) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(htmlCode, 'text/html');

	// Extract title
	const titleElement = doc.querySelector('title');
	const title = titleElement ? titleElement.textContent.trim() : null;

	// Extract favicon
	const faviconSelectors = [
		'link[rel="icon"]',
		'link[rel="shortcut icon"]',
		'link[rel="apple-touch-icon"]',
		'link[rel="mask-icon"]'
	];

	let favicon = null;
	for (const selector of faviconSelectors) {
		const faviconElement = doc.querySelector(selector);
		if (faviconElement && faviconElement.href) {
			favicon = faviconElement.href;
			break;
		}
	}

	return { title, favicon };
}

function updateMainPageTitleAndFavicon(title, favicon) {
	// Update title
	if (title) {
		document.title = title;
	} else {
		document.title = 'Web Workshop';
	}

	// Update favicon
	let faviconLink = document.querySelector('link[rel="icon"]');
	if (!faviconLink) {
		faviconLink = document.createElement('link');
		faviconLink.rel = 'icon';
		document.head.appendChild(faviconLink);
	}

	if (favicon) {
		faviconLink.href = favicon;
	} else {
		faviconLink.href = 'resources/construction.png';
	}
}

function updatePreview() {
	// Skip preview updates while mobile keyboard is open and editor is focused
	// This prevents keyboard layer resets on Android
	if (isMobileDevice() && isEditorFocused && document.body.classList.contains('mobile-keyboard-open')) {
		return;
	}

	const code = editorView.state.doc.toString();

	// Extract and update title and favicon from user's HTML
	const { title, favicon } = extractTitleAndFavicon(code);
	updateMainPageTitleAndFavicon(title, favicon);

	// Store scroll position before updating
	let scrollX = 0, scrollY = 0;
	try {
		if (preview.contentWindow?.scrollX !== undefined) {
			scrollX = preview.contentWindow.scrollX;
			scrollY = preview.contentWindow.scrollY;
		}
	} catch (e) {
		// Ignore cross-origin errors
	}

	// Use srcdoc to create a completely fresh document context
	// Expand <images> tag and rewrite bare stock image filenames
	const processedCode = expandImagesTag(rewriteBareImageSrcs(code.trim())) || '<!DOCTYPE html><html><head></head><body></body></html>';
	preview.srcdoc = processedCode;

	// Add our functionality after the iframe loads
	const onLoad = () => {
		try {
			const doc = preview.contentDocument;
			if (!doc) return;

			// Add CSS for overscroll and button
			const style = doc.createElement('style');
			style.textContent = '* { overscroll-behavior: none !important; } .iframe-fullscreen-toggle { position: fixed; top: 5px; right: 5px; z-index: 10000; background: rgba(0, 0, 0, 0.2); color: white; border: none; border-radius: 4px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 0.2s; box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2); -webkit-tap-highlight-color: transparent; outline: none; user-select: none; } .iframe-fullscreen-toggle svg { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3)); opacity: 0.8; transition: opacity 0.2s; } @media (hover: hover) and (pointer: fine) { .iframe-fullscreen-toggle:hover { background: rgba(0, 0, 0, 0.35); } .iframe-fullscreen-toggle:hover svg { opacity: 1; } }';
			doc.head.appendChild(style);

			// Create fullscreen button
			const existingButton = doc.getElementById('fullscreenToggle');
			if (existingButton) existingButton.remove();

			const button = doc.createElement('button');
			button.id = 'fullscreenToggle';
			button.className = 'iframe-fullscreen-toggle';
			button.title = 'Toggle fullscreen';

			// Use inline SVG to avoid being affected by user's img styles
			button.innerHTML = '<svg width="20" height="20" viewBox="0 0 14 14" fill="white"><path d="M 7,14 H 5 v 5 h 5 V 17 H 7 Z M 5,10 H 7 V 7 h 3 V 5 H 5 Z m 12,7 h -3 v 2 h 5 V 14 H 17 Z M 14,5 v 2 h 3 v 3 h 2 V 5 Z" transform="translate(-5,-5)"/></svg>';

			button.addEventListener('click', function() {
				parent.postMessage('toggleFullscreen', '*');
			});

			if (doc.body) {
				doc.body.appendChild(button);
			}

			// Add click handlers for stock image table rows
			const stockImageRows = doc.querySelectorAll('.stock-image-row');
			stockImageRows.forEach(row => {
				row.addEventListener('click', () => {
					const filename = row.getAttribute('data-filename');
					if (!filename) return;

					// Find and replace <img src="?"> in the editor
					const editorContent = editorView.state.doc.toString();
					const imgPattern = /<img\s+src\s*=\s*["']?\?["']?\s*\/?>/i;
					const match = editorContent.match(imgPattern);

					if (match) {
						const start = editorContent.indexOf(match[0]);
						const end = start + match[0].length;
						const replacement = `<img src="${filename}">`;

						editorView.dispatch({
							changes: { from: start, to: end, insert: replacement }
						});
						saveToStorage();
						updatePreview();
					}
				});
			});

			// Restore scroll position
			setTimeout(() => {
				try {
					preview.contentWindow?.scrollTo(scrollX, scrollY);
				} catch (e) {
					// Ignore cross-origin errors
				}
			}, 10);
		} catch (e) {
			// Ignore cross-origin errors
		}

		preview.removeEventListener('load', onLoad);
	};
	preview.addEventListener('load', onLoad);
}

function saveToStorage() {
	try {
		localStorage.setItem(storageKey, editorView.state.doc.toString());
	} catch (e) {
		console.warn('Could not save to localStorage:', e);
	}
}

function loadFromStorage() {
	try {
		return localStorage.getItem(storageKey) || '';
	} catch (e) {
		console.warn('Could not load from localStorage:', e);
		return '';
	}
}

function loadEditorSettings() {
	try {
		showLineNumbers = localStorage.getItem('editor-line-numbers') === 'true';
		enableLineWrapping = localStorage.getItem('editor-line-wrapping') !== 'false';
	} catch (e) {
		console.warn('Could not load editor settings from localStorage:', e);
		showLineNumbers = false;
		enableLineWrapping = true;
	}
}

function saveEditorSetting(key, value) {
	try {
		localStorage.setItem(key, value.toString());
	} catch (e) {
		console.warn('Could not save editor setting to localStorage:', e);
	}
}

function toggleLineNumbers() {
	const {lineNumbers} = window.CodeMirror;
	showLineNumbers = !showLineNumbers;
	saveEditorSetting('editor-line-numbers', showLineNumbers);

	editorView.dispatch({
		effects: lineNumbersCompartment.reconfigure(showLineNumbers ? lineNumbers() : [])
	});
}

function createLineWrappingExtension() {
	const {EditorView, Decoration} = window.CodeMirror;

	return [
		EditorView.lineWrapping,
		EditorView.decorations.of((view) => {
			const decorations = [];

			for (let {from, to} of view.visibleRanges) {
				for (let pos = from; pos <= to;) {
					const line = view.state.doc.lineAt(pos);
					const lineText = line.text;

					// Calculate indentation level (count leading whitespace)
					let indentChars = 0;
					for (let i = 0; i < lineText.length; i++) {
						if (lineText[i] === '\t') {
							indentChars += 2; // Convert tab to 2 spaces for calculation
						} else if (lineText[i] === ' ') {
							indentChars += 1;
						} else {
							break;
						}
					}

					// Apply hanging indent if line has indentation
					if (indentChars > 0) {
						const indentDecoration = Decoration.line({
							attributes: {
								style: `text-indent: -${indentChars}ch; padding-left: calc(${indentChars}ch + 6px);`
							}
						});
						decorations.push(indentDecoration.range(line.from));
					}

					pos = line.to + 1;
				}
			}

			return decorations.length > 0 ? Decoration.set(decorations) : Decoration.none;
		}),
	];
}

function toggleLineWrapping() {
	enableLineWrapping = !enableLineWrapping;
	saveEditorSetting('editor-line-wrapping', enableLineWrapping);

	const lineWrappingExtension = enableLineWrapping ? createLineWrappingExtension() : [];

	editorView.dispatch({
		effects: lineWrappingCompartment.reconfigure(lineWrappingExtension)
	});
}

// File operations
window.saveFile = function() {
	const blob = new Blob([editorView.state.doc.toString()], { type: 'text/html' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'index.html';
	a.click();
	URL.revokeObjectURL(url);
};

window.loadFile = function() {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = '.html,.htm';
	input.onchange = function(event) {
		const file = event.target.files[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = function(e) {
			editorView.dispatch({
				changes: { from: 0, to: editorView.state.doc.length, insert: e.target.result }
			});
			saveToStorage();
			updatePreview();
		};
		reader.readAsText(file);
	};
	input.click();
};

// Wait for CodeMirror to be available
function initializeCodeMirror() {
	if (!window.CodeMirror) {
		setTimeout(initializeCodeMirror, 100);
		return;
	}

	const {EditorView, EditorState, Compartment, keymap, defaultKeymap, indentWithTab, html, githubDark, indentUnit, placeholder, undo, redo, history, closeBrackets, search, searchKeymap, closeSearchPanel, openSearchPanel, lineNumbers} = window.CodeMirror;

	// Load saved content and editor settings
	const savedContent = loadFromStorage();
	loadEditorSettings();

	// Create compartments for dynamic extensions
	lineNumbersCompartment = new Compartment();
	lineWrappingCompartment = new Compartment();

	const initialLineWrappingExtension = enableLineWrapping ? createLineWrappingExtension() : [];

	// Create CodeMirror editor
	editorView = new EditorView({
		state: EditorState.create({
			doc: savedContent,
			extensions: [
				history(),
				search(),
				closeBrackets(),
				keymap.of([
					{key: "Mod-z", run: undo},
					{key: "Mod-y", run: redo},
					{key: "Mod-Shift-z", run: redo},
					{key: "Mod-o", run: () => { window.loadFile(); return true; }},
					{key: "Mod-s", run: () => { window.saveFile(); return true; }},
					{key: "F1", run: () => { toggleLineNumbers(); return true; }},
					{key: "F2", run: () => { toggleLineWrapping(); return true; }},
					indentWithTab,
					...searchKeymap.filter(binding => binding.key !== "Mod-f"),
					...defaultKeymap
				]),
				html(),
				// Auto-close <style> and <script> tags (not handled by default html() extension)
				// Also expand <!> into HTML boilerplate
				EditorView.inputHandler.of((view, from, to, text) => {
					if (text !== '>') return false;
					const before = view.state.doc.sliceString(Math.max(0, from - 20), from);
					// Check for <!> boilerplate trigger
					if (before.endsWith('<!')) {
						const boilerplate = `<html>
\t<head>
\t\t<style>
\t\t\t
\t\t</style>
\t</head>
\t<body>
\t\t
\t</body>
</html>`;
						const startPos = from - 2;
						const cursorPos = startPos + boilerplate.indexOf('<body>') + 9;
						view.dispatch({
							changes: { from: startPos, to: from, insert: boilerplate },
							selection: { anchor: cursorPos }
						});
						return true;
					}
					// Check for <style> or <script>
					const match = before.match(/<(style|script)(\s[^>]*)?$/i);
					if (!match) return false;
					const tagName = match[1].toLowerCase();
					const closingTag = `</${tagName}>`;
					view.dispatch({
						changes: { from, to, insert: '>' + closingTag },
						selection: { anchor: from + 1 }
					});
					return true;
				}),
				githubDark,
				indentUnit.of("\t"),
				placeholder("Build something with HTML..."),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						clearTimeout(updateTimer);
						updateTimer = setTimeout(updatePreview, 600);
						saveToStorage();
					}
				}),
				// Disable text correction and autocomplete
				EditorView.contentAttributes.of({
					'autocomplete': 'off',
					'autocorrect': 'off',
					'autocapitalize': 'off',
					'spellcheck': 'false'
				}),
				lineNumbersCompartment.of(showLineNumbers ? lineNumbers() : []),
				lineWrappingCompartment.of(initialLineWrappingExtension)
			]
		}),
		parent: document.getElementById('editor')
	});

	// Initial render (wait for stock images manifest to load first)
	stockImagesReady.then(() => updatePreview());

	// Track editor focus and handle keyboard dismissal
	editorView.contentDOM.addEventListener('focus', () => { isEditorFocused = true; });

	editorView.contentDOM.addEventListener('blur', () => {
		isEditorFocused = false;

		// If we are on mobile and the keyboard mode is active,
		// exit immediately. Do not wait for visualViewport resize.
		if (isMobileDevice()) {
			exitMobileKeyboardMode();
		}
	});

	// Focus the editor
	editorView.focus();

	// Global keydown handler for Cmd+F toggle
	document.addEventListener('keydown', function(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
			e.preventDefault();
			closeSearchPanel(editorView) || openSearchPanel(editorView);
		}
	});
}

// Mobile keyboard detection
function isMobileDevice() {
	return window.matchMedia("(pointer: coarse), (pointer: none)").matches;
}

let initialViewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
let isEditorFocused = false;

// Handle transition from fullscreen keyboard mode back to split view
function exitMobileKeyboardMode() {
	if (!document.body.classList.contains('mobile-keyboard-open')) return;

	// Hide editor immediately to prevent visual stutter/jump
	editorPane.style.opacity = '0';
	document.body.classList.remove('mobile-keyboard-open');

	// Wait for layout to settle, then restore scroll and opacity
	requestAnimationFrame(() => requestAnimationFrame(() => {
		if (editorView) {
			// Scroll cursor into view in the new 50% layout
			const pos = editorView.state.selection.main.head;
			const lineBlock = editorView.lineBlockAt(pos);
			const targetScroll = lineBlock.top - (editorView.dom.clientHeight / 2);
			editorView.scrollDOM.scrollTop = Math.max(0, targetScroll);
		}
		editorPane.style.opacity = '';

		// Update preview with any changes made while keyboard was open
		updatePreview();
	}));
}

function updateViewportVariables() {
	const vv = window.visualViewport;
	if (vv) {
		document.documentElement.style.setProperty('--visual-viewport-height', `${vv.height}px`);
		document.documentElement.style.setProperty('--visual-viewport-offset-top', `${vv.offsetTop}px`);
	}
}

function handleViewportChange() {
	if (!isMobileDevice()) return;

	const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
	const heightDifference = initialViewportHeight - currentHeight;
	const isKeyboardOpen = heightDifference > 150;

	updateViewportVariables();

	if (isKeyboardOpen && isEditorFocused) {
		document.body.classList.add('mobile-keyboard-open');
	} else if (!isKeyboardOpen) {
		// Fallback for keyboard dismissal that doesn't trigger blur (e.g. Android)
		exitMobileKeyboardMode();
	}
}

if (window.visualViewport) {
	window.visualViewport.addEventListener('resize', handleViewportChange);
	window.visualViewport.addEventListener('scroll', updateViewportVariables);
} else {
	window.addEventListener('resize', handleViewportChange);
}

// Initialize when page loads
initializeCodeMirror();

// Register service worker
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./sw.js')
			.then(registration => {
				console.log('SW registered: ', registration);
			})
			.catch(registrationError => {
				console.log('SW registration failed: ', registrationError);
			});
	});
}
