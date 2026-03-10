// Default to same-origin so both local dev server and Vercel rewrites work out of the box.
// Optional overrides (priority):
// 1) ?apiBase=https://example.com
// 2) localStorage.SOSBOX_API_BASE
// 3) window.SOSBOX_API_BASE set before this script
(() => {
	"use strict";

	let override = "";
	try {
		const url = new URL(window.location.href);
		override = String(url.searchParams.get("apiBase") || "").trim();
		if (!override) {
			override = String(window.localStorage.getItem("SOSBOX_API_BASE") || "").trim();
		}
	} catch {
		// Ignore parsing/storage errors and continue with defaults.
	}

	if (!override) {
		override = String(window.SOSBOX_API_BASE || "").trim();
	}

	window.API_BASE = override;
})();
