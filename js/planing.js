(() => {
	"use strict";

	const {
		$,
		apiGetBoxes,
		showToast,
		escapeHtml,
		batteryIconSrc,
		computeStatus,
		clampInt,
	} = window.SOSBoxUtils;

	const STORAGE_KEY = "sos-planing-pins-v1";
	const MOCK_KEY = "sos-planing-mockboxes-v1";
	const RADIUS_METERS = 20;
	const OFFLINE_MIN = 30;

	// ── persistence ────────────────────────────────────────────────────────────
	function loadJSON(key, fallback = []) {
		try {
			const raw = localStorage.getItem(key);
			if (!raw) return fallback;
			const v = JSON.parse(raw);
			return Array.isArray(v) ? v : fallback;
		} catch {
			return fallback;
		}
	}

	function savePlans(plans) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
	}

	function saveMockBoxes(boxes) {
		localStorage.setItem(MOCK_KEY, JSON.stringify(boxes));
	}

	function loadPlans() {
		return loadJSON(STORAGE_KEY)
			.map((p) => ({
				id: String(p.id || crypto.randomUUID()),
				name: String(p.name || "Point"),
				lat: Number(p.lat),
				lng: Number(p.lng),
			}))
			.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
	}

	function loadMockBoxes() {
		return loadJSON(MOCK_KEY)
			.map((b) => ({
				id: String(b.id || crypto.randomUUID()),
				name: String(b.name || "MOCK BOX"),
				lat: Number(b.lat),
				lng: Number(b.lng),
				source: "mock",
			}))
			.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
	}

	// ── helpers ────────────────────────────────────────────────────────────────
	function formatLatLng(lat, lng) {
		return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
	}

	function wifiSvg(status) {
		const stroke =
			status === "online" ? "#56f2c7" : status === "low" ? "#ffcb5c" : "#ff5e7a";
		return `
			<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M2.5 8.8C8.2 3.5 15.8 3.5 21.5 8.8" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
				<path d="M5.8 12.1C10 8.3 14 8.3 18.2 12.1" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
				<path d="M9 15.3c2-1.7 4-1.7 6 0" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
				<circle cx="12" cy="18.5" r="1.6" fill="${stroke}"/>
			</svg>`;
	}

	function sosMarkerIcon(status) {
		return L.divIcon({
			className: "",
			html: `<div class="sos-marker ${status}">${wifiSvg(status)}</div>`,
			iconSize: [34, 34],
			iconAnchor: [17, 17],
			popupAnchor: [0, -16],
		});
	}

	function mockMarkerIcon() {
		return L.divIcon({
			className: "",
			html: `<div class="mock-box-marker"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffcb5c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/><line x1="12" y1="12" x2="12" y2="16"/></svg></div>`,
			iconSize: [30, 30],
			iconAnchor: [15, 15],
			popupAnchor: [0, -14],
		});
	}

	function planPinIcon(success) {
		const color = success ? "#56f2c7" : "#ffcb5c";
		return L.divIcon({
			className: "",
			html: `<div class="plan-pin-marker ${success ? "success" : "waiting"}"><svg width="16" height="22" viewBox="0 0 24 32" fill="${color}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/><circle cx="12" cy="12" r="4" fill="rgba(0,0,0,0.45)"/></svg></div>`,
			iconSize: [24, 32],
			iconAnchor: [12, 32],
			popupAnchor: [0, -32],
		});
	}

	// ── popup html ─────────────────────────────────────────────────────────────
	function planPopupHtml(plan, success) {
		return `
			<div style="min-width:200px;">
				<div style="font-weight:650;">${escapeHtml(plan.name)}</div>
				<div style="margin-top:5px;font-size:12px;opacity:.85;">${formatLatLng(plan.lat, plan.lng)}</div>
				<div style="margin-top:8px;font-size:12px;">Status: <b style="color:${success ? "#56f2c7" : "#ffcb5c"}">${success ? "success" : "waiting"}</b></div>
			</div>`;
	}

	function sosBoxPopupHtml(box, status) {
		const battery = clampInt(box.batteryPercent ?? 0, 0, 150);
		const statusLabel = status === "online" ? "ออนไลน์" : status === "low" ? "แบตต่ำ" : "ออฟไลน์";
		return `
			<div style="min-width:200px;">
				<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
					<div style="font-weight:650;">${escapeHtml(box.name || "SOS BOX")}</div>
					<div style="font-size:11px;opacity:.9;">${statusLabel}</div>
				</div>
				<div style="margin-top:5px;font-size:12px;opacity:.85;">${formatLatLng(box.lat, box.lng)}</div>
				<div style="margin-top:5px;font-size:12px;display:flex;align-items:center;gap:6px;">
					<img src="${batteryIconSrc(battery)}" width="14" height="14" alt="battery"/>
					<span>แบตเตอรี่: <b>${battery}%</b></span>
				</div>
			</div>`;
	}

	function mockBoxPopupHtml(box) {
		return `
			<div style="min-width:180px;">
				<div style="font-weight:650;">${escapeHtml(box.name)}</div>
				<div style="margin-top:5px;font-size:12px;opacity:.85;">${formatLatLng(box.lat, box.lng)}</div>
				<div style="margin-top:5px;font-size:12px;color:#ffcb5c;">Mockup Box</div>
			</div>`;
	}

	// ── main ───────────────────────────────────────────────────────────────────
	document.addEventListener("DOMContentLoaded", () => {
		void (async () => {
			const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
				[13.7563, 100.5018],
				13
			);

			L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 20,
				attribution: "&copy; OpenStreetMap contributors",
			}).addTo(map);

			L.Control.geocoder({ defaultMarkGeocode: false, placeholder: "ค้นหาสถานที่..." })
				.on("markgeocode", (e) => map.setView(e.geocode.center, Math.max(map.getZoom(), 16)))
				.addTo(map);

			const planLayer = L.layerGroup().addTo(map);
			const sosLayer = L.layerGroup().addTo(map);
			const mockLayer = L.layerGroup().addTo(map);

			let mode = "plan"; // "plan" | "mockbox"
			let plans = loadPlans();
			let boxes = []; // from API
			let mockBoxes = loadMockBoxes();

			// ── mode toggle ─────────────────────────────────────────────────────
			function setMode(m) {
				mode = m;
				$("btnModePlan")?.classList.toggle("active", m === "plan");
				$("btnModeMock")?.classList.toggle("active", m === "mockbox");
				const planWrap = $("planNameWrap");
				const mockWrap = $("mockNameWrap");
				const hint = $("mapClickHint");
				if (planWrap) planWrap.style.display = m === "plan" ? "" : "none";
				if (mockWrap) mockWrap.style.display = m === "mockbox" ? "" : "none";
				if (hint)
					hint.textContent =
						m === "plan"
							? "คลิกบนแผนที่เพื่อวางหมุดแผน พร้อมวงกลมรัศมี 20 เมตร"
							: "คลิกบนแผนที่เพื่อวางกล่อง Mockup";
			}

			$("btnModePlan")?.addEventListener("click", () => setMode("plan"));
			$("btnModeMock")?.addEventListener("click", () => setMode("mockbox"));

			// ── success check ───────────────────────────────────────────────────
			function getAllBoxes() {
				return [...boxes, ...mockBoxes];
			}

			function isPlanSuccess(plan) {
				const all = getAllBoxes();
				if (!all.length) return false;
				const center = L.latLng(plan.lat, plan.lng);
				return all.some((b) => center.distanceTo(L.latLng(Number(b.lat), Number(b.lng))) <= RADIUS_METERS);
			}

			// ── map rendering ───────────────────────────────────────────────────
			function renderSosMarkers() {
				sosLayer.clearLayers();
				for (const box of boxes) {
					const lat = Number(box.lat);
					const lng = Number(box.lng);
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
					const status = computeStatus(box, OFFLINE_MIN);
					L.marker([lat, lng], { icon: sosMarkerIcon(status) })
						.bindPopup(sosBoxPopupHtml(box, status))
						.addTo(sosLayer);
				}
			}

			function renderMockMarkers() {
				mockLayer.clearLayers();
				for (const box of mockBoxes) {
					const lat = Number(box.lat);
					const lng = Number(box.lng);
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
					const marker = L.marker([lat, lng], { icon: mockMarkerIcon(), draggable: true })
						.bindPopup(mockBoxPopupHtml(box))
						.addTo(mockLayer);
					marker.on("dragend", (e) => {
						const pos = e.target.getLatLng();
						box.lat = pos.lat;
						box.lng = pos.lng;
						saveMockBoxes(mockBoxes);
						renderAll();
					});
				}
			}

			function renderPlans() {
				planLayer.clearLayers();
				for (const plan of plans) {
					const success = isPlanSuccess(plan);
					const marker = L.marker([plan.lat, plan.lng], { icon: planPinIcon(success), title: plan.name, draggable: true })
						.bindPopup(planPopupHtml(plan, success))
						.addTo(planLayer);
					marker.on("dragend", (e) => {
						const pos = e.target.getLatLng();
						plan.lat = pos.lat;
						plan.lng = pos.lng;
						savePlans(plans);
						renderAll();
					});
					L.circle([plan.lat, plan.lng], {
						radius: RADIUS_METERS,
						color: success ? "#56f2c7" : "#ffcb5c",
						fillColor: success ? "#56f2c7" : "#ffcb5c",
						fillOpacity: 0.15,
						weight: 2,
					}).addTo(planLayer);
				}
			}

			// ── sidebar lists ───────────────────────────────────────────────────
			function renderBoxList() {
				const list = $("planningBoxList");
				if (!list) return;
				list.innerHTML = "";

				if (!boxes.length) {
					const empty = document.createElement("div");
					empty.className = "sub";
					empty.textContent = "ยังไม่มี SOS BOX";
					list.appendChild(empty);
					return;
				}

				for (const box of boxes) {
					const lat = Number(box.lat);
					const lng = Number(box.lng);
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

					const status = computeStatus(box, OFFLINE_MIN);
					const battery = clampInt(box.batteryPercent ?? 0, 0, 150);

					const item = document.createElement("div");
					item.className = "item";

					const left = document.createElement("div");
					left.style.cursor = "pointer";
					left.onclick = () => map.setView([lat, lng], Math.max(map.getZoom(), 17));

					const title = document.createElement("div");
					title.className = "itemTitle";
					title.textContent = box.name || "SOS BOX";

					const coords = document.createElement("div");
					coords.className = "itemMeta";
					coords.textContent = formatLatLng(lat, lng);

					const statusRow = document.createElement("div");
					statusRow.className = "metaRow";
					statusRow.style.marginTop = "4px";

					const batteryIcon = document.createElement("img");
					batteryIcon.className = "batteryIcon";
					batteryIcon.src = batteryIconSrc(battery);
					batteryIcon.alt = "battery";
					batteryIcon.title = `Battery: ${battery}%`;

					const badge = document.createElement("span");
					badge.className = `badge ${status}`;
					badge.textContent =
						status === "online" ? "ออนไลน์" : status === "low" ? "แบตต่ำ" : "ออฟไลน์";

					const statusWrap = document.createElement("div");
					statusWrap.className = "statusWrap";
					statusWrap.appendChild(batteryIcon);
					statusWrap.appendChild(badge);
					statusRow.appendChild(statusWrap);

					left.appendChild(title);
					left.appendChild(coords);
					left.appendChild(statusRow);

					const right = document.createElement("div");
					right.className = "itemActions";
					const btnGo = document.createElement("button");
					btnGo.className = "tiny";
					btnGo.type = "button";
					btnGo.textContent = "ไป";
					btnGo.onclick = () => map.setView([lat, lng], Math.max(map.getZoom(), 17));
					right.appendChild(btnGo);

					item.appendChild(left);
					item.appendChild(right);
					list.appendChild(item);
				}
			}

			function renderMockBoxList() {
				const list = $("mockBoxList");
				if (!list) return;
				list.innerHTML = "";

				if (!mockBoxes.length) {
					const empty = document.createElement("div");
					empty.className = "sub";
					empty.textContent = "ยังไม่มีกล่อง mockup — เลือกโหมด \"วาง Mockup กล่อง\" แล้วคลิกแผนที่";
					list.appendChild(empty);
					return;
				}

				for (const box of mockBoxes) {
					const lat = Number(box.lat);
					const lng = Number(box.lng);
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

					const item = document.createElement("div");
					item.className = "item";

					const left = document.createElement("div");
					left.style.cursor = "pointer";
					left.onclick = () => map.setView([lat, lng], Math.max(map.getZoom(), 17));

					const title = document.createElement("div");
					title.className = "itemTitle";
					title.textContent = box.name;

					const coords = document.createElement("div");
					coords.className = "itemMeta";
					coords.textContent = formatLatLng(lat, lng);

					left.appendChild(title);
					left.appendChild(coords);

					const right = document.createElement("div");
					right.className = "itemActions";
					const delBtn = document.createElement("button");
					delBtn.className = "tiny";
					delBtn.type = "button";
					delBtn.textContent = "ลบ";
					delBtn.onclick = () => {
						mockBoxes = mockBoxes.filter((b) => b.id !== box.id);
						saveMockBoxes(mockBoxes);
						renderAll();
					};
					right.appendChild(delBtn);

					item.appendChild(left);
					item.appendChild(right);
					list.appendChild(item);
				}
			}

			function renderPlanList() {
				const list = $("planList");
				if (!list) return;
				list.innerHTML = "";

				if (!plans.length) {
					const empty = document.createElement("div");
					empty.className = "sub";
					empty.textContent = "ยังไม่มีหมุดแผน — เลือกโหมด \"วางหมุดแผน\" แล้วคลิกแผนที่";
					list.appendChild(empty);
					return;
				}

				for (const plan of plans) {
					const success = isPlanSuccess(plan);

					const item = document.createElement("div");
					item.className = "item";

					const left = document.createElement("div");
					left.style.cursor = "pointer";
					left.onclick = () => map.setView([plan.lat, plan.lng], Math.max(map.getZoom(), 18));

					const title = document.createElement("div");
					title.className = "itemTitle";
					title.textContent = plan.name;

					const coords = document.createElement("div");
					coords.className = "itemMeta";
					coords.textContent = formatLatLng(plan.lat, plan.lng);

					const meta = document.createElement("div");
					meta.className = "plan-meta";
					const status = document.createElement("span");
					status.className = `plan-status ${success ? "success" : "waiting"}`;
					status.textContent = success ? "success" : "waiting";
					meta.appendChild(status);

					left.appendChild(title);
					left.appendChild(coords);
					left.appendChild(meta);

					const right = document.createElement("div");
					right.className = "itemActions";
					const delBtn = document.createElement("button");
					delBtn.className = "tiny";
					delBtn.type = "button";
					delBtn.textContent = "ลบ";
					delBtn.onclick = () => {
						plans = plans.filter((p) => p.id !== plan.id);
						savePlans(plans);
						renderAll();
					};
					right.appendChild(delBtn);

					item.appendChild(left);
					item.appendChild(right);
					list.appendChild(item);
				}
			}

			function renderAll() {
				renderSosMarkers();
				renderMockMarkers();
				renderPlans();
				renderBoxList();
				renderMockBoxList();
				renderPlanList();
			}

			// ── map click ────────────────────────────────────────────────────────
			map.on("click", (e) => {
				if (mode === "plan") {
					const planName = String($("planName")?.value || "").trim();
					if (!planName) {
						showToast("กรอกชื่อหมุดก่อนวาง", 2800);
						return;
					}
					plans.push({
						id: crypto.randomUUID(),
						name: planName,
						lat: e.latlng.lat,
						lng: e.latlng.lng,
					});
					savePlans(plans);
					renderAll();
					showToast(`วางหมุด "${planName}" แล้ว`);
				} else {
					const rawName = String($("mockBoxName")?.value || "").trim();
					const mockName = rawName || `MOCK BOX ${mockBoxes.length + 1}`;
					mockBoxes.push({
						id: crypto.randomUUID(),
						name: mockName,
						lat: e.latlng.lat,
						lng: e.latlng.lng,
						source: "mock",
					});
					saveMockBoxes(mockBoxes);
					renderAll();
					showToast(`วางกล่อง mockup "${mockName}" แล้ว`);
				}
			});

			// ── API refresh ──────────────────────────────────────────────────────
			async function refreshBoxes() {
				try {
					boxes = await apiGetBoxes();
					renderAll();
				} catch (e) {
					showToast(`โหลด SOS BOX ไม่สำเร็จ: ${e?.message || e}`, 3200);
				}
			}

			renderAll();
			await refreshBoxes();
			window.setInterval(refreshBoxes, 10000);
		})();
	});
})();
