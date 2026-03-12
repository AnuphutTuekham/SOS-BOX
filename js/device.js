(() => {
    "use strict";

    const { $, apiGetBoxes, apiDeleteBox, apiUpdateBoxName, computeStatus, clampInt, showToast } = window.SOSBoxUtils;

    let boxes = [];

    function formatSince(ts) {
        if (!ts) return "-";
        const delta = Math.max(0, Date.now() - Number(ts));
        const sec = Math.floor(delta / 1000);
        if (sec < 60) return `${sec} sec ago`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min} min ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
        const day = Math.floor(hr / 24);
        return `${day} day${day > 1 ? "s" : ""} ago`;
    }

    function batteryClass(percent) {
        if (percent <= 20) return "battery-low";
        if (percent <= 60) return "battery-mid";
        return "battery-high";
    }

    function updateSummary(list) {
        const offlineAfterMin = 30;
        const total = list.length;
        const online = list.filter((b) => computeStatus(b, offlineAfterMin) === "online").length;
        const warning = list.filter((b) => {
            const battery = Number(b.batteryPercent ?? 0);
            return Number.isFinite(battery) && battery < 50 && battery >= 20;
        }).length;
        const danger = list.filter((b) => {
            const battery = Number(b.batteryPercent ?? 0);
            return Number.isFinite(battery) && battery < 20;
        }).length;

        if ($("totalDevices")) $("totalDevices").textContent = String(total);
        if ($("onlineDevices")) $("onlineDevices").textContent = String(online);
        if ($("warningCount")) $("warningCount").textContent = String(warning);
        if ($("dangerCount")) $("dangerCount").textContent = String(danger);
    }

    function renderTable(list) {
        const tbody = $("deviceTableBody");
        if (!tbody) return;

        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:#8b949e; text-align:center;">No devices found from Cloudflare API</td></tr>`;
            if ($("devicePagination")) $("devicePagination").innerHTML = "<span>0 devices</span><span>[ 1 ]</span>";
            return;
        }

        tbody.innerHTML = list
            .map((box) => {
                const battery = clampInt(box.batteryPercent ?? 0, 0, 150);
                const location = `${Number(box.lat).toFixed(5)}, ${Number(box.lng).toFixed(5)}`;
                const lastUpdate = formatSince(box.lastSeen || box.createdAt);
                const safeName = String(box.name || "").replaceAll('"', "&quot;");
                return `
                    <tr data-id="${box.id}">
                        <td>${box.name}</td>
                        <td>${location}</td>
                        <td>${lastUpdate}</td>
                        <td><span class="battery-pill ${batteryClass(battery)}">${battery}%</span></td>
                        <td class="action-cell">
                            <button class="btn-table" type="button" data-action="edit" data-id="${box.id}" data-name="${safeName}">Edit</button>
                            <button class="btn-table danger" type="button" data-action="delete" data-id="${box.id}">Delete</button>
                        </td>
                    </tr>
                `;
            })
            .join("");

        if ($("devicePagination")) {
            $("devicePagination").innerHTML = `<span>1 - ${list.length} of ${list.length}</span><span>[ 1 ]</span>`;
        }
    }

    function getFiltered() {
        const query = String($("searchDevice")?.value || "").trim().toLowerCase();
        if (!query) return boxes;
        return boxes.filter((b) => String(b.name || "").toLowerCase().includes(query));
    }

    async function refresh() {
        try {
            boxes = await apiGetBoxes();
            const filtered = getFiltered();
            updateSummary(filtered);
            renderTable(filtered);
        } catch (e) {
            showToast(`Failed to load devices: ${e?.message || e}`, 3600);
            renderTable([]);
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        $('searchDevice')?.addEventListener("input", () => {
            const filtered = getFiltered();
            updateSummary(filtered);
            renderTable(filtered);
        });

        $("deviceTableBody")?.addEventListener("click", async (ev) => {
            const target = ev.target;
            if (!(target instanceof HTMLElement)) return;
            const action = target.getAttribute("data-action");
            const id = target.getAttribute("data-id");
            if (!action || !id) return;

            if (action === "edit") {
                const currentName = String(target.getAttribute("data-name") || "").trim();
                const nextName = window.prompt("Edit device name", currentName);
                if (nextName === null) return;
                const trimmedName = String(nextName).trim();
                if (!trimmedName) {
                    showToast("Device name cannot be empty", 2800);
                    return;
                }
                try {
                    await apiUpdateBoxName(id, trimmedName);
                    await refresh();
                    showToast("Device name updated");
                } catch (e) {
                    showToast(`Update name failed: ${e?.message || e}`, 3600);
                }
                return;
            }

            if (action === "delete") {
                if (!window.confirm("Delete this device?")) return;
                try {
                    await apiDeleteBox(id);
                    await refresh();
                    showToast("Device deleted");
                } catch (e) {
                    showToast(`Delete failed: ${e?.message || e}`, 3600);
                }
            }
        });

        void refresh();
        window.setInterval(refresh, 10000);
    });
})();
