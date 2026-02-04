(() => {
	"use strict";

	const STORAGE_KEY = "sosbox_markers_v1";

	const $ = (id) => document.getElementById(id);
	const toastEl = $("toast");

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

	function haversineMeters(a, b) {
		const R = 6371000;
		const toRad = (d) => (d * Math.PI) / 180;
		const dLat = toRad(b.lat - a.lat);
		const dLng = toRad(b.lng - a.lng);
		const lat1 = toRad(a.lat);
		const lat2 = toRad(b.lat);
		const s1 = Math.sin(dLat / 2);
		const s2 = Math.sin(dLng / 2);
		const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
		return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
	}

	function safeParseJSON(text, fallback) {
		try {
			const v = JSON.parse(text);
			return v ?? fallback;
		} catch {
			return fallback;
		}
	}

	function loadMarkers() {
		const raw = localStorage.getItem(STORAGE_KEY);
		const data = safeParseJSON(raw || "[]", []);
		if (!Array.isArray(data)) return [];
		return data
			.filter((m) => m && typeof m.lat === "number" && typeof m.lng === "number")
			.map((m) => ({
				id: String(m.id || crypto.randomUUID()),
				lat: m.lat,
				lng: m.lng,
				title: String(m.title || "หมุด"),
				note: String(m.note || ""),
				createdAt: Number(m.createdAt || Date.now()),
				chain: Boolean(m.chain),
			}));
	}

	function saveMarkers(markers) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
	}

	function escapeHtml(str) {
		return String(str)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");
	}

	function markerPopupHtml(m) {
		const title = escapeHtml(m.title || "หมุด");
		const note = escapeHtml(m.note || "");
		const coords = `${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}`;
		const created = new Date(m.createdAt).toLocaleString();
		return `
			<div style="min-width: 220px">
				<div style="font-weight: 650; margin-bottom: 6px">${title}</div>
				<div style="font-size: 12px; opacity: 0.85">พิกัด: <span style="font-family: ui-monospace, monospace">${coords}</span></div>
				${note ? `<div style="margin-top: 6px; font-size: 12px; opacity: 0.9">${note}</div>` : ""}
				<div style="margin-top: 8px; font-size: 11px; opacity: 0.7">สร้างเมื่อ: ${created}</div>
			</div>
		`;
	}

	function fmtMeters(m) {
		if (m < 1000) return `${Math.round(m)} m`;
		return `${(m / 1000).toFixed(2)} km`;
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
		// Basemaps
		const layers = {
			osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
				maxZoom: 20,
				attribution: "&copy; OpenStreetMap contributors",
			}),
			terrain: L.tileLayer("https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.png", {
				maxZoom: 18,
				attribution: "Map tiles by Stamen Design (CC BY 3.0) — Data &copy; OpenStreetMap",
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

		// Geocoder control
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

		// Marker handling
		let markersData = loadMarkers();
		const markerLayer = L.layerGroup().addTo(map);
		const lineLayer = L.polyline([], {
			color: "#56f2c7",
			weight: 3,
			opacity: 0.9,
		}).addTo(map);

		function renderMarkers() {
			markerLayer.clearLayers();
			lineLayer.setLatLngs([]);

			const chainPoints = [];
			for (const m of markersData) {
				const icon = m.chain
					? L.divIcon({
							className: "",
							html:
								'<div style="width:14px;height:14px;border-radius:999px;background:#56f2c7;box-shadow:0 0 0 6px rgba(86,242,199,0.18);border:2px solid rgba(255,255,255,0.8)"></div>',
							iconSize: [14, 14],
							iconAnchor: [7, 7],
						})
					: undefined;

				const leafletMarker = L.marker([m.lat, m.lng], {
					draggable: true,
					icon,
				});

				leafletMarker.bindPopup(markerPopupHtml(m));
				leafletMarker.on("dragend", () => {
					const p = leafletMarker.getLatLng();
					m.lat = p.lat;
					m.lng = p.lng;
					saveMarkers(markersData);
					updateSidebar();
					renderMarkers();
					showToast("ย้ายหมุดแล้ว");
				});

				leafletMarker.addTo(markerLayer);

				if (m.chain) chainPoints.push({ lat: m.lat, lng: m.lng });
			}

			if (chainPoints.length >= 2) {
				lineLayer.setLatLngs(chainPoints.map((p) => [p.lat, p.lng]));
			}
		}

		function totalChainDistanceMeters() {
			const pts = markersData.filter((m) => m.chain);
			let sum = 0;
			for (let i = 1; i < pts.length; i++) {
				sum += haversineMeters(pts[i - 1], pts[i]);
			}
			return sum;
		}

		function updateStats() {
			const c = map.getCenter();
			$("centerLatLng").textContent = formatLatLng(c);
			$("zoom").textContent = String(map.getZoom());
			$("markerCount").textContent = String(markersData.length);
			$("totalDistance").textContent = fmtMeters(totalChainDistanceMeters());
		}

		function updateSidebar() {
			updateStats();

			const list = $("markerList");
			list.innerHTML = "";
			if (markersData.length === 0) {
				const empty = document.createElement("div");
				empty.className = "sub";
				empty.textContent = "ยังไม่มีหมุด — คลิกบนแผนที่เพื่อเพิ่มหมุด";
				list.appendChild(empty);
				return;
			}

			const sorted = [...markersData].sort((a, b) => b.createdAt - a.createdAt);
			for (const m of sorted) {
				const item = document.createElement("div");
				item.className = "item";

				const left = document.createElement("div");
				const title = document.createElement("div");
				title.className = "itemTitle";
				title.textContent = m.title || "หมุด";
				const meta = document.createElement("div");
				meta.className = "itemMeta";
				meta.textContent = `${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}${m.chain ? " • chain" : ""}`;
				left.appendChild(title);
				left.appendChild(meta);

				const right = document.createElement("div");
				right.className = "itemActions";

				const btnGo = document.createElement("button");
				btnGo.className = "tiny";
				btnGo.type = "button";
				btnGo.textContent = "ไป";
				btnGo.onclick = () => {
					map.setView([m.lat, m.lng], Math.max(map.getZoom(), 16));
				};

				const btnCopy = document.createElement("button");
				btnCopy.className = "tiny";
				btnCopy.type = "button";
				btnCopy.textContent = "คัดลอก";
				btnCopy.onclick = async () => {
					await copyText(`${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}`);
					showToast("คัดลอกพิกัดแล้ว");
				};

				const btnDel = document.createElement("button");
				btnDel.className = "tiny";
				btnDel.type = "button";
				btnDel.textContent = "ลบ";
				btnDel.onclick = () => {
					markersData = markersData.filter((x) => x.id !== m.id);
					saveMarkers(markersData);
					renderMarkers();
					updateSidebar();
				};

				right.appendChild(btnGo);
				right.appendChild(btnCopy);
				right.appendChild(btnDel);

				item.appendChild(left);
				item.appendChild(right);
				list.appendChild(item);
			}
		}

		function addMarker(lat, lng, title, note, chain = false) {
			const m = {
				id: crypto.randomUUID(),
				lat,
				lng,
				title: (title || "หมุด").trim() || "หมุด",
				note: (note || "").trim(),
				createdAt: Date.now(),
				chain,
			};
			markersData.push(m);
			saveMarkers(markersData);
			renderMarkers();
			updateSidebar();
			return m;
		}

		// UI events
		map.on("moveend", updateStats);
		map.on("zoomend", updateStats);

		map.on("click", (e) => {
			const chain = e.originalEvent && e.originalEvent.shiftKey;
			const lat = e.latlng.lat;
			const lng = e.latlng.lng;
			const title = chain ? "จุดถัดไป" : "หมุด";
			const m = addMarker(lat, lng, title, "", chain);
			$("lat").value = lat.toFixed(6);
			$("lng").value = lng.toFixed(6);
			showToast(chain ? "เพิ่มจุดสำหรับคำนวณระยะแล้ว" : "เพิ่มหมุดแล้ว");

			setTimeout(() => {
				markerLayer.eachLayer((layer) => {
					if (layer.getLatLng) {
						const p = layer.getLatLng();
						if (
							Math.abs(p.lat - m.lat) < 1e-10 &&
							Math.abs(p.lng - m.lng) < 1e-10
						) {
							layer.openPopup();
						}
					}
				});
			}, 0);
		});

		$("btnAdd").addEventListener("click", () => {
			const lat = Number($("lat").value);
			const lng = Number($("lng").value);
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
				showToast("กรุณากรอก lat/lng ให้ถูกต้อง", 2600);
				return;
			}
			const title = $("title").value;
			const note = $("note").value;
			const m = addMarker(lat, lng, title, note, false);
			map.setView([m.lat, m.lng], Math.max(map.getZoom(), 16));
			$("title").value = "";
			$("note").value = "";
		});

		$("btnClearAll").addEventListener("click", () => {
			if (!confirm("ลบหมุดทั้งหมด?")) return;
			markersData = [];
			saveMarkers(markersData);
			renderMarkers();
			updateSidebar();
			showToast("ลบหมุดทั้งหมดแล้ว");
		});

		$("btnClearLine").addEventListener("click", () => {
			let changed = false;
			markersData = markersData.map((m) => {
				if (!m.chain) return m;
				changed = true;
				return { ...m, chain: false };
			});
			if (changed) {
				saveMarkers(markersData);
				renderMarkers();
				updateSidebar();
				showToast("ล้างเส้นระยะแล้ว");
			} else {
				showToast("ยังไม่มีเส้นระยะให้ล้าง");
			}
		});

		$("btnLocate").addEventListener("click", () => {
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
					addMarker(lat, lng, "ตำแหน่งฉัน", "", false);
					showToast("พบตำแหน่งแล้ว");
				},
				(err) => {
					showToast(`หาตำแหน่งไม่สำเร็จ: ${err.message}`, 3200);
				},
				{ enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
			);
		});

		$("btnCopyCenter").addEventListener("click", async () => {
			const c = map.getCenter();
			await copyText(`${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
			showToast("คัดลอกพิกัดกึ่งกลางแล้ว");
		});

		$("btnShare").addEventListener("click", async () => {
			const c = map.getCenter();
			const shareUrl = new URL(window.location.href);
			shareUrl.searchParams.set("ll", `${c.lat.toFixed(6)},${c.lng.toFixed(6)}`);
			shareUrl.searchParams.set("z", String(map.getZoom()));
			await copyText(shareUrl.toString());
			showToast("คัดลอกลิงก์แชร์แล้ว");
		});

		$("basemap").addEventListener("change", (e) => {
			const v = e.target.value;
			if (!layers[v]) return;
			map.removeLayer(activeBase);
			activeBase = layers[v];
			activeBase.addTo(map);
		});

		// Initial render
		renderMarkers();
		updateSidebar();
		updateStats();

		if (markersData.length === 0) {
			showToast("ลองค้นหาสถานที่ด้านบน หรือคลิกบนแผนที่เพื่อเพิ่มหมุด", 3400);
		}
	});
})();
