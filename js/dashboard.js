/**
 * Dashboard logic for dashboard.html
 * Displays device status and sensor data
 */
(() => {
	"use strict";

	const { $, apiUrl, apiGetBoxes, showToast } = window.SOSBoxUtils;

	function isOnline(box) {
		const lastSeen = box.lastSeen || box.createdAt;
		return Date.now() - lastSeen < 30 * 60 * 1000;
	}

	async function refreshData() {
		const totalEl = $("totalDevices");
		const onlineEl = $("onlineDevices");
		const warnEl = $("warningCount");
		const dangerEl = $("dangerCount");
		const readingsBody = $("latestReadings");

		try {
			const boxes = await apiGetBoxes();
			const total = boxes.length;
			const online = boxes.filter(isOnline).length;
			const warnings = boxes.filter((b) => !isOnline(b)).length;
			const danger = boxes.filter((b) => b.batteryPercent < 20).length;

			if (totalEl) totalEl.textContent = total;
			if (onlineEl) onlineEl.textContent = online;
			if (warnEl) warnEl.textContent = warnings;
			if (dangerEl) dangerEl.textContent = danger;

			// Latest readings from raw-input table
			try {
				const resp = await fetch(apiUrl("/api/raw-input?limit=10"));
				const raw = await resp.json();
				if (readingsBody) {
					readingsBody.innerHTML = raw
						.map((r) => {
							let payload;
							try {
								payload = JSON.parse(r.payload);
							} catch {
								payload = r.payload;
							}
							let sensorLabel = "data";
							let value;
							if (payload && typeof payload === "object") {
								// Pick first key that's not lat/lon/battery/device_id
								const skip = ["lat", "lon", "battery", "device_id"];
								for (const k of Object.keys(payload)) {
									if (!skip.includes(k)) {
										sensorLabel = k;
										value = payload[k];
										break;
									}
								}
							}
							if (value === undefined) {
								value = JSON.stringify(payload);
							}
							return `<tr>
								<td>${r.device_id || "-"}</td>
								<td>${sensorLabel}</td>
								<td class="value-text">${value}</td>
								<td>${new Date(r.received_at).toLocaleString()}</td>
							</tr>`;
						})
						.join("");
				}
			} catch (e) {
				console.error("Failed to load raw readings:", e);
			}
		} catch (err) {
			console.error("Dashboard refresh failed:", err);
			showToast(`เกิดข้อผิดพลาด: ${err?.message || err}`, 3600);
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		$("btnOpenRawInput")?.addEventListener("click", () => {
			window.location.href = "raw-input.html";
		});

		void (async () => {
			await refreshData();
			setInterval(refreshData, 30000);
		})();
	});
})();
