(() => {
    "use strict";

    const { $, apiGetBoxes, apiUrl, clampInt, showToast } = window.SOSBoxUtils;

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
        const primary = extractPrimaryPayload(payload);
        return String(
            row?.device_id ||
                row?.deviceId ||
                primary?.device_id ||
                primary?.deviceId ||
                primary?.device?.id ||
                primary?.deviceName ||
                primary?.id ||
                "unknown"
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
            const [boxes, rows] = await Promise.all([apiGetBoxes(), fetchRaw(100)]);
            const boxBatteryById = new Map();
            for (const box of boxes) {
                const battery = clampInt(box.batteryPercent ?? 0, 0, 150);
                boxBatteryById.set(String(box.id), battery);
                if (box.deviceId) boxBatteryById.set(String(box.deviceId), battery);
                if (box.name) boxBatteryById.set(String(box.name), battery);
            }

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
                    const row = entry.row;
                    const payload = extractPrimaryPayload(entry.payload);
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
                    const battery = clampInt(
                        batteryFromPayload ?? boxBatteryById.get(deviceId) ?? 0,
                        0,
                        150
                    );

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
