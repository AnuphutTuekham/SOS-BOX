/**
 * Dashboard logic for dashboard.html
 * Displays device status and sensor data
 */
(() => {
	"use strict";

	const { $, apiUrl, apiGetBoxes, showToast } = window.SOSBoxUtils;

	function formatTimeAgo(value) {
		const ts = Date.parse(String(value || ""));
		if (!Number.isFinite(ts)) return "-";
		const diffMs = Date.now() - ts;
		if (diffMs < 0) return "just now";
		const sec = Math.floor(diffMs / 1000);
		if (sec < 45) return "just now";
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
		const hour = Math.floor(min / 60);
		if (hour < 24) return `${hour} hour${hour === 1 ? "" : "s"} ago`;
		const day = Math.floor(hour / 24);
		if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
		const month = Math.floor(day / 30);
		if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;
		const year = Math.floor(month / 12);
		return `${year} year${year === 1 ? "" : "s"} ago`;
	}

	function isOnline(box) {
		const lastSeen = box.lastSeen || box.createdAt;
		return Date.now() - lastSeen < 30 * 60 * 1000;
	}

	function extractPrimaryPayload(payload) {
		if (Array.isArray(payload)) return payload[0] ?? {};
		if (payload && Array.isArray(payload.positions)) return payload.positions[0] ?? {};
		return payload && typeof payload === "object" ? payload : {};
	}

	function normalizePayload(payload) {
		const primary = extractPrimaryPayload(payload);
		const location = primary?.location && typeof primary.location === "object" ? primary.location : null;
		let merged = { ...primary };

		if (location) {
			merged = { ...merged, ...location };

			const coords = location.coords && typeof location.coords === "object" ? location.coords : null;
			if (coords) {
				if (coords.latitude !== undefined) merged.latitude = coords.latitude;
				if (coords.longitude !== undefined) merged.longitude = coords.longitude;
			}

			const batteryObj = location.battery && typeof location.battery === "object" ? location.battery : null;
			if (batteryObj) {
				if (batteryObj.level !== undefined) merged.battery = batteryObj.level;
				const charging = batteryObj.isCharging ?? batteryObj.is_charging;
				if (charging !== undefined) merged.isCharging = charging;
			}

			const activityObj = location.activity && typeof location.activity === "object" ? location.activity : null;
			if (activityObj && activityObj.type !== undefined) {
				merged.activity = activityObj.type;
			}
		}

		return merged;
	}

	function pickNumber(obj, keys) {
		for (const k of keys) {
			const n = Number(obj?.[k]);
			if (Number.isFinite(n)) return n;
		}
		return null;
	}

	function pickText(obj, keys) {
		for (const k of keys) {
			const v = obj?.[k];
			if (v !== undefined && v !== null && String(v).trim()) return String(v);
		}
		return "-";
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
			const warnings = boxes.filter((b) => {
				const battery = Number(b.batteryPercent ?? 0);
				return Number.isFinite(battery) && battery < 50 && battery >= 20;
			}).length;
			const danger = boxes.filter((b) => {
				const battery = Number(b.batteryPercent ?? 0);
				return Number.isFinite(battery) && battery < 20;
			}).length;

			if (totalEl) totalEl.textContent = total;
			if (onlineEl) onlineEl.textContent = online;
			if (warnEl) warnEl.textContent = warnings;
			if (dangerEl) dangerEl.textContent = danger;

			const criticalEl = $("criticalList");
			if (criticalEl) {
				const criticalBoxes = boxes
					.filter((b) => {
						const bat = Number(b.batteryPercent ?? 0);
						return Number.isFinite(bat) && bat < 50;
					})
					.sort((a, b) => Number(a.batteryPercent ?? 0) - Number(b.batteryPercent ?? 0));
				if (criticalBoxes.length === 0) {
					criticalEl.innerHTML = `<p class="critical-card-empty">All systems clear ✨</p>`;
				} else {
					criticalEl.innerHTML = criticalBoxes
						.map((b) => {
							const bat = Math.round(Number(b.batteryPercent ?? 0));
							const cls = bat < 20 ? "battery-low" : "battery-mid";
							return `<div class="critical-device-row">
								<span class="critical-device-name">${b.name || b.id || "-"}</span>
								<span class="battery-pill ${cls}">${bat}%</span>
							</div>`;
						})
						.join("");
				}
			}

			// Latest readings from raw-input table
			try {
				const resp = await fetch(apiUrl("/api/raw-input?limit=100"));
				const rawAll = await resp.json();
				// Keep only the latest entry per device_id
				const seen = new Set();
				const raw = rawAll.filter((r) => {
					const key = r.device_id || r.id;
					if (seen.has(key)) return false;
					seen.add(key);
					return true;
				});
				if (readingsBody) {
					readingsBody.innerHTML = raw
						.map((r) => {
							let payload;
							try {
								payload = JSON.parse(r.payload);
							} catch {
								payload = r.payload;
							}
							const normalized = normalizePayload(payload);
							const people = pickNumber(normalized, [
								"wifi_count",
								"wifiCount",
								"people_count",
								"peopleCount",
								"connected_people",
								"connectedUsers",
								"connections",
							]);
							const movingRaw = normalized?.is_moving ?? normalized?.isMoving;
							const activityType = pickText(normalized, ["activity", "motion", "state"]);
							let movement = activityType;
							if (typeof movingRaw === "boolean") {
								movement = movingRaw ? "moving" : "still";
							}

							const peopleText = people === null ? "-" : String(Math.max(0, Math.round(people)));
						const chargingRaw = normalized?.isCharging;
						const chargingText = chargingRaw === true ? "กำลังชาร์จ" : chargingRaw === false ? "ไม่ชาร์จ" : "-";
						const value = `คนเชื่อมต่อ: ${peopleText} | การเคลื่อนที่: ${movement} | สถานะชาร์จ: ${chargingText}`;
							return `<tr>
								<td>${r.device_id || "-"}</td>
								<td>connection/movement</td>
								<td class="value-text">${value}</td>
								<td>${formatTimeAgo(r.received_at)}</td>
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
