(() => {
	"use strict";

	const $ = (id) => document.getElementById(id);
	const toastEl = $("toast");
	const API_BASE = String(window.API_BASE || "").trim();
	const apiUrl = (path) => (API_BASE ? new URL(path, API_BASE).toString() : path);

	function showToast(message, timeoutMs = 2400) {
		if (!toastEl) return;
		toastEl.textContent = message;
		toastEl.style.display = "block";
		window.clearTimeout(showToast._t);
		showToast._t = window.setTimeout(() => {
			toastEl.style.display = "none";
		}, timeoutMs);
	}

	function clampInt(v, min, max) {
		const n = Math.round(Number(v));
		if (!Number.isFinite(n)) return min;
		return Math.min(max, Math.max(min, n));
	}

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function prettyPayload(value) {
		const raw = String(value ?? "");
		if (!raw.trim()) return "";
		try {
			const parsed = JSON.parse(raw);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return raw;
		}
	}

	async function fetchRaw(limit) {
		const r = await fetch(apiUrl(`/api/raw-input?limit=${encodeURIComponent(String(limit))}`), {
			cache: "no-store",
		});
		if (!r.ok) throw new Error(`GET /api/raw-input failed: ${r.status}`);
		const data = await r.json();
		return Array.isArray(data) ? data : [];
	}

	async function deleteRaw() {
		const r = await fetch(apiUrl("/api/raw-input"), { method: "DELETE" });
		if (!r.ok) throw new Error(`DELETE /api/raw-input failed: ${r.status}`);
	}

	function renderRows(rows) {
		const body = $("rawTableBody");
		if (!body) return;
		if (!rows.length) {
			body.innerHTML =
				'<tr><td colspan="7" class="raw-empty">ยังไม่มีข้อมูล raw input</td></tr>';
			return;
		}
		body.innerHTML = rows
			.map((row) => {
				const payload = escapeHtml(prettyPayload(row.payload));
				const deviceId = escapeHtml(row.device_id || "-");
				const ip = escapeHtml(row.ip || "-");
				const method = escapeHtml(row.method || "-");
				const path = escapeHtml(row.path || "-");
				const receivedAt = escapeHtml(row.received_at || "-");
				const id = escapeHtml(row.id || "-");
				return `
					<tr>
						<td>${id}</td>
						<td>${receivedAt}</td>
						<td><span class="kbd">${path}</span></td>
						<td>${method}</td>
						<td>${deviceId}</td>
						<td>${ip}</td>
						<td><pre class="raw-payload">${payload}</pre></td>
					</tr>
				`;
			})
			.join("");
	}

	document.addEventListener("DOMContentLoaded", () => {
		let refreshInFlight = false;
		let timer = 0;

		async function refresh() {
			if (refreshInFlight) return;
			refreshInFlight = true;
			const limit = clampInt($("limit")?.value ?? 100, 1, 500);
			try {
				const rows = await fetchRaw(limit);
				renderRows(rows);
				if ($("totalRows")) $("totalRows").textContent = String(rows.length);
				if ($("lastUpdated")) $("lastUpdated").textContent = new Date().toLocaleTimeString();
			} catch (e) {
				showToast(`โหลด raw input ไม่สำเร็จ: ${e?.message || e}`, 3600);
			} finally {
				refreshInFlight = false;
			}
		}

		$("btnRefresh")?.addEventListener("click", () => {
			void refresh();
		});

		$("limit")?.addEventListener("change", () => {
			void refresh();
		});

		$("btnBackMain")?.addEventListener("click", () => {
			window.location.href = "main.html";
		});

		$("btnClearRaw")?.addEventListener("click", () => {
			if (!window.confirm("ลบ raw input ทั้งหมดใช่หรือไม่?")) return;
			void (async () => {
				try {
					await deleteRaw();
					await refresh();
					showToast("ลบ raw input แล้ว");
				} catch (e) {
					showToast(`ลบไม่สำเร็จ: ${e?.message || e}`, 3600);
				}
			})();
		});

		void refresh();
		timer = window.setInterval(() => {
			void refresh();
		}, 8000);

		window.addEventListener("beforeunload", () => {
			if (timer) window.clearInterval(timer);
		});
	});
})();
