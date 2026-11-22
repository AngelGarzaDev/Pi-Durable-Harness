// Markdown for assistant messages: marked turns the text into HTML, DOMPurify removes anything unsafe.
// Raw HTML in the answer is not trusted and is stripped; links open in a new tab without window.opener.
import { marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";

marked.use({ gfm: true, breaks: true });
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer");
	}
});

export function renderMarkdown(text) {
	// Images are dropped: an answer must not make the browser fetch arbitrary URLs (tracking, mixed content).
	return DOMPurify.sanitize(marked.parse(String(text ?? ""), { async: false }), { FORBID_TAGS: ["img"] });
}

// Adds a copy button to every code block inside the given element.
export function enhanceCode(root) {
	for (const pre of root.querySelectorAll("pre")) {
		if (pre.parentElement?.classList.contains("codewrap")) continue;
		const wrap = document.createElement("div");
		wrap.className = "codewrap";
		pre.replaceWith(wrap);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "copy";
		button.textContent = "Copy";
		button.onclick = async () => {
			try {
				await navigator.clipboard.writeText(pre.innerText);
				button.textContent = "Copied";
			} catch {
				button.textContent = "Copy failed";
			}
			setTimeout(() => (button.textContent = "Copy"), 1500);
		};
		wrap.append(button, pre);
	}
}
