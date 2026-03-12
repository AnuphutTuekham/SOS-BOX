(() => {
    "use strict";

    const { $, apiUrl, clampInt, showToast } = window.SOSBoxUtils;

    function extractPrimaryPayload(payload) {
        if (Array.isArray(payload)) return payload[0] ?? {};
        if (payload && Array.isArray(payload.positions)) return payload.positions[0] ?? {};
        return payload && typeof payload === "object" ? payload : {};
    }

    function parsePayload(payloadRaw) {
        if (!payloadRaw) return {};
        if (typeof payloadRaw === "object") return payloadRaw;
        try {
            return JSON.parse(String(payloadRaw));
        } catch {
            return {};
        }
    }

    function pickNumber(obj, keys) {
        for (const k of keys) {
            const v = obj?.[k];
            if (v !== undefined && v !== null && v !== "") {
                const n = Number(v);
                if (Number.isFinite(n)) return n;
            }
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

    function normalizePayload(payload) {
        const primary = extractPrimaryPayload(payload);
        const location = primary?.location && typeof primary.location === "object" ? primary.location : null;
        let merged = { ...primary };

        if (location) {
            merged = { ...merged, ...location };

            // Some clients submit position as querystring inside location._
            if (typeof location._ === "string") {
                const qs = new URLSearchParams(location._);
                const qLat = qs.get("lat");
                const qLon = qs.get("lon") ?? qs.get("lng");
                const qBatt = qs.get("batt") ?? qs.get("battery") ?? qs.get("batteryLevel");
                if (qLat !== null) merged.lat = qLat;
                if (qLon !== null) merged.lon = qLon;
                if (qBatt !== null) merged.battery = qBatt;
            }

            const coords = location.coords && typeof location.coords === "object" ? location.coords : null;
            if (coords) {
                if (coords.latitude !== undefined) merged.latitude = coords.latitude;
                if (coords.longitude !== undefined) merged.longitude = coords.longitude;
                if (coords.speed !== undefined) merged.speed = coords.speed;
                if (coords.altitude !== undefined) merged.altitude = coords.altitude;
                if (coords.accuracy !== undefined) merged.accuracy = coords.accuracy;
                if (coords.heading !== undefined) merged.heading = coords.heading;
            }

            const batteryObj = location.battery && typeof location.battery === "object" ? location.battery : null;
            if (batteryObj && batteryObj.level !== undefined) {
                merged.battery = batteryObj.level;
            }

            const activityObj = location.activity && typeof location.activity === "object" ? location.activity : null;
            if (activityObj && activityObj.type !== undefined) {
                merged.activity = activityObj.type;
            }
        }

        return merged;
    }

    function batteryClass(percent) {
        if (percent <= 20) return "battery-low";
        if (percent <= 60) return "battery-mid";
        return "battery-high";
    }

    function normalizeBatteryPercent(value) {
        const battery = Number(value);
        if (!Number.isFinite(battery)) return null;
        return battery <= 1 ? battery * 100 : battery;
    }

    function pickDeviceId(row, payload) {
        const primary = normalizePayload(payload);
        return String(
            row?.device_id ||
                row?.deviceId ||
                primary?.device_id ||
                primary?.deviceId ||
                primary?.device?.id ||
                primary?.deviceName ||
                primary?.id ||
                `unknown-${row?.id ?? Date.now()}`
        );
    }

    async function fetchRaw(limit) {
        const resp = await fetch(apiUrl(`/api/raw-input?limit=${encodeURIComponent(String(limit))}`), {
            cache: "no-store",
        });
        if (!resp.ok) throw new Error(`GET /api/raw-input failed: ${resp.status}`);
        const data = await resp.json();
        return Array.isArray(data) ? data : [];
    }

    async function refresh() {
        const tbody = $("sensorTableBody");
        const pager = $("sensorPagination");
        if (!tbody) return;

        try {
            const rows = await fetchRaw(100);

            const latestByDevice = new Map();
            for (const row of rows) {
                const payload = parsePayload(row.payload);
                const deviceId = pickDeviceId(row, payload);
                if (!latestByDevice.has(deviceId)) {
                    latestByDevice.set(deviceId, { row, payload });
                }
            }

            const rendered = Array.from(latestByDevice.entries()).slice(0, 30);
            if (!rendered.length) {
                tbody.innerHTML = `<tr><td colspan="6" style="color:#8b949e; text-align:center;">No sensor data from Cloudflare API</td></tr>`;
                if (pager) pager.innerHTML = "<span>0 records</span><span>[ 1 ]</span>";
                return;
            }

            tbody.innerHTML = rendered
                .map(([deviceId, entry]) => {
                    const payload = normalizePayload(entry.payload);
                    const speed = pickNumber(payload, ["speed", "spd", "velocity"]);
                    const altitude = pickNumber(payload, ["altitude", "alt"]);
                    const gpsAccuracy = pickNumber(payload, ["accuracy", "gpsAccuracy", "hdop"]);
                    const activity = pickText(payload, ["activity", "motion", "state"]);

                    const batteryRaw = pickNumber(payload, [
                        "battery",
                        "batteryPercent",
                        "batteryLevel",
                        "batt",
                    ]);
                    const batteryFromPayload = normalizeBatteryPercent(batteryRaw);
                    const battery = clampInt(batteryFromPayload ?? 0, 0, 150);

                    return `
                        <tr>
                            <td>${deviceId}</td>
                            <td><span class="battery-pill ${batteryClass(battery)}">${battery}%</span></td>
                            <td>${speed !== null ? speed.toFixed(2) : "-"}</td>
                            <td>${altitude !== null ? altitude.toFixed(2) : "-"}</td>
                            <td>${gpsAccuracy !== null ? gpsAccuracy.toFixed(2) : "-"}</td>
                            <td>${activity}</td>
                        </tr>
                    `;
                })
                .join("");

            if (pager) pager.innerHTML = `<span>1 - ${rendered.length} of ${rendered.length}</span><span>[ 1 ]</span>`;
        } catch (e) {
            showToast(`Failed to load sensor data: ${e?.message || e}`, 3600);
            tbody.innerHTML = `<tr><td colspan="6" style="color:#8b949e; text-align:center;">Failed to load Cloudflare data</td></tr>`;
            if (pager) pager.innerHTML = "<span>0 records</span><span>[ 1 ]</span>";
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        void refresh();
        window.setInterval(refresh, 10000);
    });
})();
