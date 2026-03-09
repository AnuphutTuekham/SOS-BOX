/**
 * Shared utilities for SOS Box project
 * Common functions used across multiple pages
 */
(() => {
	"use strict";

	// Constants
	const DEFAULT_LOW_BATTERY = 15;
	const DEFAULT_POWERBANK_MAH = 10000;
	const DEFAULT_LOAD_W = 5;

	// DOM utility
	const $ = (id) => document.getElementById(id);

	// API Configuration
	const API_BASE = String(window.API_BASE || "").trim();
	const apiUrl = (path) => (API_BASE ? new URL(path, API_BASE).toString() : path);

	// Number utilities
	function clampInt(v, min, max) {
		const n = Math.round(Number(v));
		if (!Number.isFinite(n)) return min;
		return Math.min(max, Math.max(min, n));
	}

	function clampNumber(v, min, max) {
		const n = Number(v);
		if (!Number.isFinite(n)) return min;
		return Math.min(max, Math.max(min, n));
	}

	// Box data normalization
	function normalizeBoxes(boxes) {
		return boxes
			.filter((b) => b && typeof b.lat === "number" && typeof b.lng === "number")
			.map((b, idx) => {
				const batteryPercent = clampInt(b.batteryPercent ?? 100, 0, 150);
				const powerbankMah = clampInt(b.powerbankMah ?? DEFAULT_POWERBANK_MAH, 0, 1000000);
				const loadW = clampNumber(b.loadW ?? DEFAULT_LOAD_W, 0.1, 1000);
				const createdAt = Number(b.createdAt || Date.now());
				const wifiCount = clampInt(b.wifiCount ?? b.wifi_count ?? 0, 0, 100000);
				return {
					id: String(b.id || crypto.randomUUID()),
					lat: b.lat,
					lng: b.lng,
					name: String(b.name || `SOS BOX #${idx + 1}`),
					note: String(b.note || ""),
					batteryPercent,
					wifiCount,
					powerbankMah,
					loadW,
					lastSeen: Number(b.lastSeen || createdAt),
					createdAt,
				};
			});
	}

	// API functions
	async function apiGetBoxes() {
		const r = await fetch(apiUrl("/api/boxes"), { cache: "no-store" });
		if (!r.ok) throw new Error(`GET /api/boxes failed: ${r.status}`);
		const data = await r.json();
		return normalizeBoxes(Array.isArray(data) ? data : []);
	}

	async function apiUpsertBox(box) {
		const r = await fetch(apiUrl("/api/boxes/upsert"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(box),
		});
		if (!r.ok) throw new Error(`POST /api/boxes/upsert failed: ${r.status}`);
	}

	async function apiDeleteAllBoxes() {
		const r = await fetch(apiUrl("/api/boxes"), { method: "DELETE" });
		if (!r.ok) throw new Error(`DELETE /api/boxes failed: ${r.status}`);
	}

	async function apiDeleteBox(id) {
		const r = await fetch(apiUrl(`/api/boxes/${encodeURIComponent(String(id))}`), {
			method: "DELETE",
		});
		if (!r.ok) throw new Error(`DELETE /api/boxes/:id failed: ${r.status}`);
	}

	// Battery utilities
	function batteryIconSrc(batteryPercent) {
		const p = clampInt(batteryPercent ?? 0, 0, 150);
		if (p <= 0) return "pic/empty_battery.png";
		if (p <= 25) return "pic/red_battery.png";
		if (p <= 50) return "pic/orange_battery.png";
		if (p <= 75) return "pic/Yellow_battery.png";
		return "pic/green_battery.png";
	}

	function estimateRuntimeHours(powerbankMah, loadW) {
		// Rough estimate: Wh = mAh * 3.7V / 1000; assume ~85% conversion efficiency
		const wh = (powerbankMah * 3.7) / 1000;
		const usableWh = wh * 0.85;
		return usableWh / Math.max(0.1, loadW);
	}

	// Status computation
	function computeStatus(box, offlineAfterMin) {
		const now = Date.now();
		const offlineAfterMs = Math.max(1, offlineAfterMin) * 60 * 1000;
		const lastSeen = Number(box.lastSeen || 0);
		const battery = clampInt(box.batteryPercent ?? 0, 0, 150);
		if (battery <= DEFAULT_LOW_BATTERY) return "low";
		if (!lastSeen) return "offline";
		if (now - lastSeen > offlineAfterMs) return "offline";
		return "online";
	}

	// HTML utilities
	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	// Coordinate formatting
	function formatLatLng(latlng) {
		return `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
	}

	// Clipboard utility
	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.style.position = "fixed";
			ta.style.left = "-9999px";
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			document.body.removeChild(ta);
		}
	}

	// Toast notification
	function showToast(message, timeoutMs = 2400) {
		const toastEl = $("toast");
		if (!toastEl) return;
		toastEl.textContent = message;
		toastEl.style.display = "block";
		window.clearTimeout(showToast._t);
		showToast._t = window.setTimeout(() => {
			toastEl.style.display = "none";
		}, timeoutMs);
	}

	// Export to window for global access
	window.SOSBoxUtils = {
		// Constants
		DEFAULT_LOW_BATTERY,
		DEFAULT_POWERBANK_MAH,
		DEFAULT_LOAD_W,
		// DOM
		$,
		// API
		apiUrl,
		apiGetBoxes,
		apiUpsertBox,
		apiDeleteAllBoxes,
		apiDeleteBox,
		// Utilities
		clampInt,
		clampNumber,
		normalizeBoxes,
		batteryIconSrc,
		estimateRuntimeHours,
		computeStatus,
		escapeHtml,
		formatLatLng,
		copyText,
		showToast,
	};
})();
