(() => {
	"use strict";

	const DEFAULT_LOW_BATTERY = 15;
	const DEFAULT_POWERBANK_MAH = 10000;
	const DEFAULT_LOAD_W = 5;

	const $ = (id) => document.getElementById(id);
	const toastEl = $("toast");
	const API_BASE = String(window.API_BASE || "").trim();
	const apiUrl = (path) => (API_BASE ? new URL(path, API_BASE).toString() : path);

	function showToast(message, timeoutMs = 2400) {
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

	function clampNumber(v, min, max) {
		const n = Number(v);
		if (!Number.isFinite(n)) return min;
		return Math.min(max, Math.max(min, n));
	}

	async function apiGetBoxes() {
		const r = await fetch(apiUrl("/api/boxes"), { cache: "no-store" });
		if (!r.ok) throw new Error(`GET /api/boxes failed: ${r.status}`);
		const data = await r.json();
		return normalizeBoxes(Array.isArray(data) ? data : []);
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

	async function apiUpsertBox(box) {
		const r = await fetch(apiUrl("/api/boxes/upsert"), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(box),
		});
		if (!r.ok) throw new Error(`POST /api/boxes/upsert failed: ${r.status}`);
	}

	async function apiDeleteBox(id) {
		const r = await fetch(apiUrl(`/api/boxes/${encodeURIComponent(String(id))}`), {
			method: "DELETE",
		});
		if (!r.ok) throw new Error(`DELETE /api/boxes/:id failed: ${r.status}`);
	}

	function batteryIconSrc(batteryPercent) {
		const p = clampInt(batteryPercent ?? 0, 0, 150);
		if (p <= 0) return "pic/empty_battery.png";
		if (p <= 25) return "pic/red_battery.png";
		if (p <= 50) return "pic/orange_battery.png";
		if (p <= 75) return "pic/Yellow_battery.png";
		return "pic/green_battery.png";
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

	function wifiSvg(status) {
		const stroke = status === "online" ? "#56f2c7" : status === "low" ? "#ffcb5c" : "#ff5e7a";
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
		});
	}

	function getReturnUrl() {
		const u = new URL(window.location.href);
		const returnParam = u.searchParams.get("return") || "main.html";
		return new URL(returnParam, window.location.href).toString();
	}

	function goBack({ focusId, ll, z } = {}) {
		const back = new URL(getReturnUrl(), window.location.href);
		if (focusId) back.searchParams.set("focusId", String(focusId));
		if (ll) back.searchParams.set("ll", String(ll));
		if (z) back.searchParams.set("z", String(z));
		window.location.href = back.toString();
	}

	function updateBatteryPreview() {
		const p = clampInt($("battery").value, 0, 150);
		$("batteryPreview").src = batteryIconSrc(p);
		$("batteryPreviewText").textContent = `แสดงไอคอนตามแบต: ${p}%`;
	}

	document.addEventListener("DOMContentLoaded", () => {
		void (async () => {
		const url = new URL(window.location.href);
		const id = url.searchParams.get("id") || "";
		const ll = url.searchParams.get("ll");
		const z = Number(url.searchParams.get("z") || "16");

		// Start position: from ll else Bangkok-ish
		let start = { lat: 13.7563, lng: 100.5018 };
		if (ll) {
			const parts = ll.split(",").map((p) => Number(p.trim()));
			if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
				start = { lat: parts[0], lng: parts[1] };
			}
		}

		const map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
			[start.lat, start.lng],
			Number.isFinite(z) ? z : 16
		);

		L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
			maxZoom: 20,
			attribution: "&copy; OpenStreetMap contributors",
		}).addTo(map);

		L.Control.geocoder({ defaultMarkGeocode: false, placeholder: "ค้นหาสถานที่..." })
			.on("markgeocode", function (e) {
				const center = e.geocode.center;
				map.setView(center, Math.max(map.getZoom(), 16));
				setLatLng(center.lat, center.lng);
				showToast(`ไปที่: ${e.geocode.name}`);
			})
			.addTo(map);

		let boxesData = [];
		let selectedId = "";
		let pin = null;

		try {
			boxesData = await apiGetBoxes();
		} catch (e) {
			showToast(`โหลดข้อมูล SOS BOX ไม่สำเร็จ: ${e?.message || e}`, 3600);
		}

		function setLatLng(lat, lng) {
			$("lat").value = Number(lat).toFixed(6);
			$("lng").value = Number(lng).toFixed(6);
			if (!pin) {
				pin = L.marker([lat, lng], { draggable: true, icon: markerIcon("online") }).addTo(map);
				pin.on("dragend", () => {
					const p = pin.getLatLng();
					setLatLng(p.lat, p.lng);
				});
			} else {
				pin.setLatLng([lat, lng]);
			}
		}

		function clearForm() {
			selectedId = "";
			$("selectedId").value = "";
			$("name").value = "";
			$("note").value = "";
			$("battery").value = String(100);
			$("powerbankMah").value = String(DEFAULT_POWERBANK_MAH);
			$("loadW").value = String(DEFAULT_LOAD_W);
			$("lastSeen").value = "-";
			$("modeText").textContent = "โหมด: เพิ่มรายการใหม่";
			updateBatteryPreview();
		}

		function setFormFromBox(box) {
			selectedId = box.id;
			$("selectedId").value = box.id;
			setLatLng(box.lat, box.lng);
			$("name").value = box.name || "";
			$("note").value = box.note || "";
			$("battery").value = String(clampInt(box.batteryPercent ?? 100, 0, 150));
			$("powerbankMah").value = String(clampInt(box.powerbankMah ?? DEFAULT_POWERBANK_MAH, 0, 1000000));
			$("loadW").value = String(clampNumber(box.loadW ?? DEFAULT_LOAD_W, 0.1, 1000));
			$("lastSeen").value = box.lastSeen ? new Date(box.lastSeen).toLocaleString() : "-";
			$("modeText").textContent = `โหมด: แก้ไข (${box.name || "SOS BOX"})`;
			updateBatteryPreview();
		}

		function getFormLatLng() {
			const lat = Number($("lat").value);
			const lng = Number($("lng").value);
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
			return { lat, lng };
		}

		async function saveCurrent() {
			const latlng = getFormLatLng();
			if (!latlng) {
				showToast("กรุณาเลือกตำแหน่ง (lat/lng) ให้ถูกต้อง", 2600);
				return;
			}

			const name = String($("name").value || "").trim() || "SOS BOX";
			const note = String($("note").value || "").trim();
			const batteryPercent = clampInt($("battery").value, 0, 150);
			const powerbankMah = clampInt($("powerbankMah").value, 0, 1000000);
			const loadW = clampNumber($("loadW").value, 0.1, 1000);

			const now = Date.now();
			if (selectedId) {
				const existing = boxesData.find((b) => b.id === selectedId);
				if (existing) {
					existing.lat = latlng.lat;
					existing.lng = latlng.lng;
					existing.name = name;
					existing.note = note;
					existing.batteryPercent = batteryPercent;
					existing.powerbankMah = powerbankMah;
					existing.loadW = loadW;
					// do not auto-bump lastSeen on edit
					try {
						await apiUpsertBox(existing);
						showToast("อัปเดต SOS BOX แล้ว");
						goBack({
							focusId: existing.id,
							ll: `${existing.lat.toFixed(6)},${existing.lng.toFixed(6)}`,
							z: String(Math.max(map.getZoom(), 16)),
						});
						return;
					} catch (e) {
						showToast(`บันทึกไม่สำเร็จ: ${e?.message || e}`, 3600);
						return;
					}
				}
			}

			const newBox = {
				id: crypto.randomUUID(),
				lat: latlng.lat,
				lng: latlng.lng,
				name,
				note,
				batteryPercent,
				powerbankMah,
				loadW,
				lastSeen: now,
				createdAt: now,
			};
			try {
				await apiUpsertBox(newBox);
				showToast("เพิ่ม SOS BOX แล้ว");
				goBack({
					focusId: newBox.id,
					ll: `${newBox.lat.toFixed(6)},${newBox.lng.toFixed(6)}`,
					z: String(Math.max(map.getZoom(), 16)),
				});
			} catch (e) {
				showToast(`เพิ่มไม่สำเร็จ: ${e?.message || e}`, 3600);
			}
		}

		async function markSeenNow() {
			if (!selectedId) {
				showToast("ต้องอยู่ในโหมดแก้ไขก่อน", 2200);
				return;
			}
			const box = boxesData.find((b) => b.id === selectedId);
			if (!box) return;
			box.lastSeen = Date.now();
			try {
				await apiUpsertBox(box);
				setFormFromBox(box);
				showToast("อัปเดต last seen แล้ว");
				const status = computeStatus(box, 30);
				if (pin) pin.setIcon(markerIcon(status));
			} catch (e) {
				showToast(`อัปเดตไม่สำเร็จ: ${e?.message || e}`, 3600);
			}
		}

		async function deleteCurrent() {
			if (!selectedId) {
				showToast("ยังไม่ได้เลือกรายการ", 2200);
				return;
			}
			if (!confirm("ลบ SOS BOX รายการนี้?") ) return;
			try {
				await apiDeleteBox(selectedId);
				showToast("ลบแล้ว");
				goBack();
			} catch (e) {
				showToast(`ลบไม่สำเร็จ: ${e?.message || e}`, 3600);
			}
		}

		// Wire UI
		$("btnBack").addEventListener("click", () => goBack());
		$("btnSave").addEventListener("click", () => void saveCurrent());
		$("btnSeenNow").addEventListener("click", () => void markSeenNow());
		$("btnNew").addEventListener("click", () => {
			clearForm();
			const c = map.getCenter();
			setLatLng(c.lat, c.lng);
			showToast("พร้อมเพิ่มรายการใหม่");
		});
		$("btnDelete").addEventListener("click", () => void deleteCurrent());
		$("battery").addEventListener("input", updateBatteryPreview);

		$("btnCopyLatLng").addEventListener("click", async () => {
			const latlng = getFormLatLng();
			if (!latlng) {
				showToast("ยังไม่มีพิกัด", 2000);
				return;
			}
			const text = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
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
			showToast("คัดลอกพิกัดแล้ว");
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
					setLatLng(lat, lng);
					showToast("พบตำแหน่งแล้ว");
				},
				(err) => showToast(`หาตำแหน่งไม่สำเร็จ: ${err.message}`, 3200),
				{ enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
			);
		});

		map.on("click", (e) => {
			setLatLng(e.latlng.lat, e.latlng.lng);
			showToast("ตั้งพิกัดแล้ว");
		});

		// Init
		clearForm();
		const initial = id ? boxesData.find((b) => b.id === id) : null;
		if (initial) {
			setFormFromBox(initial);
			const status = computeStatus(initial, 30);
			if (pin) pin.setIcon(markerIcon(status));
		} else {
			// If ll was provided, place pin there
			setLatLng(start.lat, start.lng);
		}
		})();
	});
})();
