(() => {
    "use strict";

    const { $, apiGetBoxes, apiUrl, clampInt, showToast } = window.SOSBoxUtils;

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
            const boxBatteryById = new Map(boxes.map((b) => [String(b.id), clampInt(b.batteryPercent ?? 0, 0, 150)]));

            const latestByDevice = new Map();
            for (const row of rows) {
                const deviceId = String(row.device_id || row.deviceId || "unknown");
                if (!latestByDevice.has(deviceId)) {
                    latestByDevice.set(deviceId, row);
                }
            }

            const rendered = Array.from(latestByDevice.entries()).slice(0, 30);
            if (!rendered.length) {
                tbody.innerHTML = `<tr><td colspan="6" style="color:#8b949e; text-align:center;">No sensor data from Cloudflare API</td></tr>`;
                if (pager) pager.innerHTML = "<span>0 records</span><span>[ 1 ]</span>";
                return;
            }

            tbody.innerHTML = rendered
                .map(([deviceId, row]) => {
                    const payload = parsePayload(row.payload);
                    const speed = pickNumber(payload, ["speed", "spd"]);
                    const altitude = pickNumber(payload, ["altitude", "alt"]);
                    const gpsAccuracy = pickNumber(payload, ["accuracy", "gpsAccuracy", "hdop"]);
                    const activity = pickText(payload, ["activity", "motion", "state"]);

                    const batteryFromPayload = pickNumber(payload, ["battery", "batteryPercent"]);
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
