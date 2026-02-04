(() => {
	"use strict";

	const DEFAULT_LOW_BATTERY = 15;
	const DEFAULT_POWERBANK_MAH = 10000;
	const DEFAULT_LOAD_W = 5;

	const $ = (id) => document.getElementById(id);
	const toastEl = $("toast");

	function on(elId, eventName, handler) {
		const el = $(elId);
		if (!el) return;
		el.addEventListener(eventName, handler);
	}

	function showToast(message, timeoutMs = 2400) {
		toastEl.textContent = message;
		toastEl.style.display = "block";
		window.clearTimeout(showToast._t);
		showToast._t = window.setTimeout(() => {
			toastEl.style.display = "none";
		}, timeoutMs);
	}

	function formatLatLng(latlng) {
		return `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
	}

	function purgeMockStorage() {
		try {
			localStorage.removeItem("sosbox_boxes_v1");
			localStorage.removeItem("sosbox_markers_v1");
		} catch {
			// ignore
		}
	}

	function normalizeBoxes(boxes) {
		return boxes
			.filter((b) => b && typeof b.lat === "number" && typeof b.lng === "number")
			.map((b, idx) => {
				const batteryPercent = clampInt(b.batteryPercent ?? 100, 0, 150);
				const powerbankMah = clampInt(b.powerbankMah ?? DEFAULT_POWERBANK_MAH, 0, 1000000);
				const loadW = clampNumber(b.loadW ?? DEFAULT_LOAD_W, 0.1, 1000);
				const createdAt = Number(b.createdAt || Date.now());
				return {
					id: String(b.id || crypto.randomUUID()),
					lat: b.lat,
					lng: b.lng,
					name: String(b.name || `SOS BOX #${idx + 1}`),
					note: String(b.note || ""),
					batteryPercent,
					powerbankMah,
					loadW,
					lastSeen: Number(b.lastSeen || createdAt),
					createdAt,
				};
			});
	}

	async function apiGetBoxes() {
		const r = await fetch("/api/boxes", { cache: "no-store" });
		if (!r.ok) throw new Error(`GET /api/boxes failed: ${r.status}`);
		const data = await r.json();
		return normalizeBoxes(Array.isArray(data) ? data : []);
	}

	async function apiUpsertBox(box) {
		const r = await fetch("/api/boxes/upsert", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(box),
		});
		if (!r.ok) throw new Error(`POST /api/boxes/upsert failed: ${r.status}`);
	}

	async function apiDeleteAllBoxes() {
		const r = await fetch("/api/boxes", { method: "DELETE" });
		if (!r.ok) throw new Error(`DELETE /api/boxes failed: ${r.status}`);
	}

	async function apiDeleteBox(id) {
		const r = await fetch(`/api/boxes/${encodeURIComponent(String(id))}`, { method: "DELETE" });
		if (!r.ok) throw new Error(`DELETE /api/boxes/:id failed: ${r.status}`);
	}

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

	function batteryIconSrc(batteryPercent) {
		const p = clampInt(batteryPercent ?? 0, 0, 150);
		if (p <= 0) return "pic/empty_battery.png";
		if (p <= 25) return "pic/red_battery.png";
		if (p <= 50) return "pic/orange_battery.png";
		if (p <= 75) return "pic/Yellow_battery.png";
		return "pic/green_battery.png";
	}

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function estimateRuntimeHours(powerbankMah, loadW) {
		// Rough estimate: Wh = mAh * 3.7V / 1000; assume ~85% conversion efficiency
		const wh = (powerbankMah * 3.7) / 1000;
		const usableWh = wh * 0.85;
		return usableWh / Math.max(0.1, loadW);
	}

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

	function buildEditorUrl(params) {
		const u = new URL("edit.html", window.location.href);
		u.searchParams.set("return", "main.html");
		if (params?.id) u.searchParams.set("id", String(params.id));
		if (params?.ll) u.searchParams.set("ll", String(params.ll));
		if (params?.z) u.searchParams.set("z", String(params.z));
		return u.toString();
	}

	function boxPopupHtml(box, status) {
		const name = escapeHtml(box.name || "SOS BOX");
		const note = escapeHtml(box.note || "");
		const coords = `${box.lat.toFixed(6)}, ${box.lng.toFixed(6)}`;
		const lastSeenText = box.lastSeen ? new Date(box.lastSeen).toLocaleString() : "-";
		const battery = clampInt(box.batteryPercent ?? 0, 0, 150);
		const powerbankMah = clampInt(box.powerbankMah ?? 0, 0, 1000000);
		const loadW = clampNumber(box.loadW ?? DEFAULT_LOAD_W, 0.1, 1000);
		const fullHours = estimateRuntimeHours(powerbankMah, loadW);
		const remainingHours = fullHours * (battery / 100);
		const statusLabel =
			status === "online" ? "ออนไลน์" : status === "low" ? "แบตต่ำ" : "ออฟไลน์";
		const iconSrc = batteryIconSrc(battery);
		return `
			<div style="min-width: 220px">
				<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
					<div style="font-weight: 650;">${name}</div>
					<div style="font-size:11px; opacity:0.9">${statusLabel}</div>
				</div>
				<div style="margin-top:6px; font-size: 12px; opacity: 0.85">พิกัด: <span style="font-family: ui-monospace, monospace">${coords}</span></div>
				<div style="margin-top:6px; font-size: 12px; opacity: 0.85; display:flex; align-items:center; gap:8px;">
					<img src="${iconSrc}" alt="battery" width="16" height="16" />
					<span>แบตเตอรี่: <b>${battery}%</b> • พาวเวอร์แบงก์: ${powerbankMah} mAh • ใช้ไฟ: ${loadW} W</span>
				</div>
				<div style="margin-top:6px; font-size: 12px; opacity: 0.85">คาดว่าเหลือเวลา ~ <b>${remainingHours.toFixed(1)} ชม.</b> (เต็ม ~${fullHours.toFixed(1)} ชม.)</div>
				<div style="margin-top:6px; font-size: 12px; opacity: 0.85">Last seen: ${escapeHtml(lastSeenText)}</div>
				${note ? `<div style="margin-top: 8px; font-size: 12px; opacity: 0.9">${note}</div>` : ""}
			</div>
		`;
	}

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

		document.addEventListener("DOMContentLoaded", () => {
			void (async () => {
				purgeMockStorage();
		const layers = {
			osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 20,
				attribution: "&copy; OpenStreetMap contributors",
			}),
			terrain: L.tileLayer("https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png", {
				maxZoom: 18,
				attribution:
					"Map tiles by Stamen Design (CC BY 3.0) — Data &copy; OpenStreetMap",
			}),
			dark: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
				maxZoom: 20,
				attribution: "&copy; OpenStreetMap — &copy; CARTO",
			}),
		};

		// Start position: from URL ?ll=lat,lng&z=... else Bangkok-ish
		const url = new URL(window.location.href);
		const ll = url.searchParams.get("ll");
		const z = Number(url.searchParams.get("z") || "13");
		let start = { lat: 13.7563, lng: 100.5018 };
		if (ll) {
			const parts = ll.split(",").map((p) => Number(p.trim()));
			if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
				start = { lat: parts[0], lng: parts[1] };
			}
		}

		const map = L.map("map", {
			zoomControl: true,
			attributionControl: true,
		}).setView([start.lat, start.lng], Number.isFinite(z) ? z : 13);

		let activeBase = layers.osm;
		activeBase.addTo(map);

		L.Control.geocoder({
			defaultMarkGeocode: false,
			placeholder: "ค้นหาสถานที่...",
		})
			.on("markgeocode", function (e) {
				const center = e.geocode.center;
				map.setView(center, Math.max(map.getZoom(), 16));
				showToast(`ไปที่: ${e.geocode.name}`);
			})
			.addTo(map);

		let boxesData = [];
		const markerLayer = L.layerGroup().addTo(map);
		const markersById = new Map();
		let refreshInFlight = false;

		async function refreshBoxes({ silent } = {}) {
			if (refreshInFlight) return;
			refreshInFlight = true;
			try {
				boxesData = await apiGetBoxes();
				renderBoxes();
				updateSidebar();
				updateStats();
			} catch (e) {
				if (!silent) showToast(`โหลดข้อมูล SOS BOX ไม่สำเร็จ: ${e?.message || e}`, 3600);
			} finally {
				refreshInFlight = false;
			}
		}

		function getOfflineAfterMin() {
			const v = Number($("offlineAfterMin")?.value ?? 30);
			return Number.isFinite(v) ? Math.max(1, Math.round(v)) : 30;
		}

		function getStatusFilter() {
			return String($("statusFilter")?.value || "all");
		}

		function wifiSvg(status) {
			const stroke =
				status === "online"
					? "#56f2c7"
					: status === "low"
						? "#ffcb5c"
						: "#ff5e7a";
			return `
				<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M2.5 8.8C8.2 3.5 15.8 3.5 21.5 8.8" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
					<path d="M5.8 12.1C10 8.3 14 8.3 18.2 12.1" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
					<path d="M9 15.3c2-1.7 4-1.7 6 0" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
					<circle cx="12" cy="18.5" r="1.6" fill="${stroke}"/>
				</svg>
			`;
		}

		function markerIcon(status) {
			return L.divIcon({
				className: "",
				html: `<div class="sos-marker ${status}">${wifiSvg(status)}</div>`,
				iconSize: [34, 34],
				iconAnchor: [17, 17],
				popupAnchor: [0, -16],
			});
		}

		function selectBox(id, panTo) {
			const box = boxesData.find((b) => b.id === id);
			if (!box) return;
			if (panTo) map.setView([box.lat, box.lng], Math.max(map.getZoom(), 16));
			const marker = markersById.get(id);
			if (!marker) {
				const statusFilter = $("statusFilter");
				if (statusFilter && statusFilter.value !== "all") {
					statusFilter.value = "all";
					renderBoxes();
					updateSidebar();
				}
			}
			const marker2 = markersById.get(id);
			if (marker2) marker2.openPopup();
		}

		function renderBoxes() {
			markerLayer.clearLayers();
			markersById.clear();
			const offlineAfterMin = getOfflineAfterMin();
			const filter = getStatusFilter();

			for (const box of boxesData) {
				const status = computeStatus(box, offlineAfterMin);
				if (filter !== "all" && status !== filter) continue;

				const leafletMarker = L.marker([box.lat, box.lng], {
					draggable: true,
					icon: markerIcon(status),
				});
				leafletMarker.bindPopup(boxPopupHtml(box, status));
				leafletMarker.on("click", () => selectBox(box.id, false));
				leafletMarker.on("dragend", async () => {
					const p = leafletMarker.getLatLng();
					box.lat = p.lat;
					box.lng = p.lng;
					try {
						await apiUpsertBox({
							id: box.id,
							lat: box.lat,
							lng: box.lng,
						});
						await refreshBoxes({ silent: true });
						showToast("ย้ายตำแหน่ง SOS BOX แล้ว");
					} catch (e) {
						showToast(`บันทึกตำแหน่งไม่สำเร็จ: ${e?.message || e}`, 3600);
					}
				});

				leafletMarker.addTo(markerLayer);
				markersById.set(box.id, leafletMarker);
			}
		}

		function updateStats() {
			const c = map.getCenter();
			$("centerLatLng").textContent = formatLatLng(c);
			$("zoom").textContent = String(map.getZoom());
			$("boxCount").textContent = String(boxesData.length);

			const offlineAfterMin = getOfflineAfterMin();
			let online = 0;
			let offline = 0;
			let low = 0;
			for (const b of boxesData) {
				const s = computeStatus(b, offlineAfterMin);
				if (s === "online") online++;
				else if (s === "low") low++;
				else offline++;
			}
			$("statusCounts").textContent = `${online} / ${offline} / ${low}`;
		}

		function updateSidebar() {
			updateStats();
			const list = $("boxList");
			if (!list) return;
			list.innerHTML = "";
			if (boxesData.length === 0) {
				const empty = document.createElement("div");
				empty.className = "sub";
				empty.textContent = "ยังไม่มี SOS BOX — กด “เพิ่ม/แก้ไข SOS BOX” เพื่อเพิ่มรายการใหม่";
				list.appendChild(empty);
				return;
			}

			const offlineAfterMin = getOfflineAfterMin();
			const filter = getStatusFilter();
			const sorted = [...boxesData].sort(
				(a, b) => (b.lastSeen || b.createdAt) - (a.lastSeen || a.createdAt)
			);
			for (const b of sorted) {
				const status = computeStatus(b, offlineAfterMin);
				if (filter !== "all" && status !== filter) continue;

				const item = document.createElement("div");
				item.className = "item";

				const left = document.createElement("div");
				left.style.cursor = "pointer";
				left.onclick = () => selectBox(b.id, true);

				const title = document.createElement("div");
				title.className = "itemTitle";
				title.textContent = b.name || "SOS BOX";

				const metaRow = document.createElement("div");
				metaRow.className = "metaRow";
				const meta = document.createElement("div");
				meta.className = "itemMeta";
				meta.textContent = `${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}`;
				const statusWrap = document.createElement("div");
				statusWrap.className = "statusWrap";
				const batteryPct = clampInt(b.batteryPercent ?? 0, 0, 150);
				const batteryIcon = document.createElement("img");
				batteryIcon.className = "batteryIcon";
				batteryIcon.src = batteryIconSrc(batteryPct);
				batteryIcon.alt = "battery";
				batteryIcon.title = `Battery: ${batteryPct}%`;
				const badge = document.createElement("span");
				badge.className = `badge ${status}`;
				badge.textContent =
					status === "online" ? "ออนไลน์" : status === "low" ? "แบตต่ำ" : "ออฟไลน์";
				statusWrap.appendChild(batteryIcon);
				statusWrap.appendChild(badge);
				metaRow.appendChild(meta);
				metaRow.appendChild(statusWrap);

				const batteryText = document.createElement("div");
				batteryText.className = "itemMeta";
				batteryText.textContent = `แบตเตอรี่: ${batteryPct}%`;

				left.appendChild(title);
				left.appendChild(metaRow);
				left.appendChild(batteryText);

				const right = document.createElement("div");
				right.className = "itemActions";

				const btnGo = document.createElement("button");
				btnGo.className = "tiny";
				btnGo.type = "button";
				btnGo.textContent = "ไป";
				btnGo.onclick = () => map.setView([b.lat, b.lng], Math.max(map.getZoom(), 16));

				const btnEdit = document.createElement("button");
				btnEdit.className = "tiny";
				btnEdit.type = "button";
				btnEdit.textContent = "แก้ไข";
				btnEdit.onclick = () => {
					const c = map.getCenter();
					const z = map.getZoom();
					window.location.href = buildEditorUrl({
						id: b.id,
						ll: `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`,
						z: String(z),
					});
				};

				const btnCopy = document.createElement("button");
				btnCopy.className = "tiny";
				btnCopy.type = "button";
				btnCopy.textContent = "คัดลอก";
				btnCopy.onclick = async () => {
					await copyText(`${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}`);
					showToast("คัดลอกพิกัดแล้ว");
				};

				const btnDel = document.createElement("button");
				btnDel.className = "tiny";
				btnDel.type = "button";
				btnDel.textContent = "ลบ";
				btnDel.onclick = async () => {
					if (!confirm("ลบ SOS BOX รายการนี้?")) return;
					try {
						await apiDeleteBox(b.id);
						await refreshBoxes({ silent: true });
						showToast("ลบแล้ว");
					} catch (e) {
						showToast(`ลบไม่สำเร็จ: ${e?.message || e}`, 3600);
					}
				};

				right.appendChild(btnGo);
				right.appendChild(btnEdit);
				right.appendChild(btnCopy);
				right.appendChild(btnDel);

				item.appendChild(left);
				item.appendChild(right);
				list.appendChild(item);
			}
		}

		map.on("moveend", updateStats);
		map.on("zoomend", updateStats);
		map.on("click", (e) => {
			const lat = e.latlng.lat;
			const lng = e.latlng.lng;
			showToast(
				`พิกัด: ${lat.toFixed(6)}, ${lng.toFixed(6)} (กด “เพิ่ม/แก้ไข SOS BOX” เพื่อเพิ่มรายการ)`,
				3200
			);
		});

		on("btnOpenEditor", "click", () => {
			const c = map.getCenter();
			const z = map.getZoom();
			window.location.href = buildEditorUrl({
				ll: `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`,
				z: String(z),
			});
		});

		on("btnClearAll", "click", () => {
			if (!confirm("ลบ SOS BOX ทั้งหมด?")) return;
			void (async () => {
				try {
					await apiDeleteAllBoxes();
					await refreshBoxes({ silent: true });
					showToast("ลบทั้งหมดแล้ว");
				} catch (e) {
					showToast(`ลบทั้งหมดไม่สำเร็จ: ${e?.message || e}`, 3600);
				}
			})();
		});

		on("btnLocate", "click", () => {
			if (!navigator.geolocation) {
				showToast("เบราว์เซอร์นี้ไม่รองรับ geolocation", 2600);
				return;
			}
			showToast("กำลังหาตำแหน่ง...", 2000);
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					const lat = pos.coords.latitude;
					const lng = pos.coords.longitude;
					map.setView([lat, lng], 17);
					showToast("พบตำแหน่งแล้ว");
				},
				(err) => showToast(`หาตำแหน่งไม่สำเร็จ: ${err.message}`, 3200),
				{ enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
			);
		});

		on("btnCopyCenter", "click", async () => {
			const c = map.getCenter();
			await copyText(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
			showToast("คัดลอกพิกัดกึ่งกลางแล้ว");
		});

		on("btnShare", "click", async () => {
			const c = map.getCenter();
			const shareUrl = new URL(window.location.href);
			shareUrl.searchParams.set("ll", `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
			shareUrl.searchParams.set("z", String(map.getZoom()));
			await copyText(shareUrl.toString());
			showToast("คัดลอกลิงก์แชร์แล้ว");
		});

		on("basemap", "change", (e) => {
			const v = e.target.value;
			if (!layers[v]) return;
			map.removeLayer(activeBase);
			activeBase = layers[v];
			activeBase.addTo(map);
		});

		on("statusFilter", "change", () => {
			renderBoxes();
			updateSidebar();
		});
		on("offlineAfterMin", "change", () => {
			renderBoxes();
			updateSidebar();
		});

		await refreshBoxes({ silent: true });
		window.setInterval(() => {
			void refreshBoxes({ silent: true });
		}, 10_000);

		const focusId = new URL(window.location.href).searchParams.get("focusId");
		if (focusId) window.setTimeout(() => selectBox(focusId, true), 120);

		if (boxesData.length === 0) {
			showToast("พร้อมรับข้อมูลจาก SOS BOX จริง — เมื่ออุปกรณ์ส่งข้อมูลจะขึ้นบนแผนที่อัตโนมัติ", 3600);
		}
		})();
	});
})();
