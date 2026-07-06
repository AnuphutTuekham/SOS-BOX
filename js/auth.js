(() => {
    "use strict";

    const STORAGE_KEY = "sosbox_auth";
    const API_BASE = String(window.API_BASE || "").trim();
    const AUTH_FALLBACK_BASE = "https://sos-box-worker.anuphut.workers.dev";
    const DEFAULT_ADMIN_EMAIL = "superadmin@sosbox.com";
    const DEFAULT_ADMIN_PASSWORD = "sosbox12345";

    function isProductionMode() {
        if (typeof window.SOSBOX_IS_PRODUCTION === "boolean") {
            return window.SOSBOX_IS_PRODUCTION;
        }
        const host = String(window.location.hostname || "").toLowerCase();
        return !(host === "localhost" || host === "127.0.0.1" || host === "::1");
    }

    function isLocalhost() {
        const host = String(window.location.hostname || "").toLowerCase();
        return host === "localhost" || host === "127.0.0.1" || host === "::1";
    }

    function apiUrl(path) {
        return API_BASE ? new URL(path, API_BASE).toString() : path;
    }

    function normalizeEmail(value) {
        return String(value || "").trim().toLowerCase();
    }

    function canUseDefaultAdminFallback(email, password) {
        return normalizeEmail(email) === DEFAULT_ADMIN_EMAIL && String(password || "") === DEFAULT_ADMIN_PASSWORD;
    }

    function setSession(email) {
        const payload = {
            email: normalizeEmail(email),
            loggedInAt: Date.now(),
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }

    function getSession() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed?.email) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function logout() {
        window.localStorage.removeItem(STORAGE_KEY);
    }

    function buildCandidatePaths(path) {
        const normalized = String(path || "").trim() || "/";
        const candidates = [normalized];
        if (normalized.startsWith("/api/")) {
            candidates.push(normalized.replace(/^\/api/, ""));
        }
        return candidates;
    }

    function buildCandidateUrls(path) {
        const urls = [];
        const seen = new Set();
        const paths = buildCandidatePaths(path);

        for (const p of paths) {
            const primary = apiUrl(p);
            if (!seen.has(primary)) {
                urls.push(primary);
                seen.add(primary);
            }
            const fallback = new URL(p, AUTH_FALLBACK_BASE).toString();
            if (!seen.has(fallback)) {
                urls.push(fallback);
                seen.add(fallback);
            }
        }

        return urls;
    }

    async function request(path, body) {
        const payload = JSON.stringify(body);
        const urls = buildCandidateUrls(path);
        let lastResp = null;
        let lastData = {};

        for (const url of urls) {
            const resp = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
            });

            const data = await resp.json().catch(() => ({}));
            lastResp = resp;
            lastData = data;

            // Try next URL only when endpoint is not found.
            if (resp.status === 404) {
                continue;
            }

            if (!resp.ok) {
                throw new Error(data?.error || `Request failed: ${resp.status}`);
            }
            return data;
        }

        const status = lastResp?.status || 404;
        throw new Error(lastData?.error || `Auth endpoint not found (HTTP ${status})`);
    }

    async function login(email, password) {
        const normalizedEmail = normalizeEmail(email);
        const normalizedPassword = String(password || "");

        try {
            const data = await request("/api/auth/login", {
                email: normalizedEmail,
                password: normalizedPassword,
            });
            setSession(data.email || normalizedEmail);
            return data;
        } catch (error) {
            const message = String(error?.message || "");

            // If backend auth route is not deployed yet, allow default admin login as a compatibility fallback.
            if (message.toLowerCase().includes("not found") && canUseDefaultAdminFallback(normalizedEmail, normalizedPassword)) {
                const data = { ok: true, email: DEFAULT_ADMIN_EMAIL, mode: "fallback" };
                setSession(data.email);
                return data;
            }
            throw error;
        }
    }

    async function register(email, password) {
        if (isProductionMode()) {
            throw new Error("Production mode: registration is disabled");
        }
        const data = await request("/api/auth/register", {
            email: normalizeEmail(email),
            password: String(password || ""),
        });
        setSession(data.email || email);
        return data;
    }

    window.SOSBoxAuth = {
        login,
        register,
        logout,
        getSession,
        isProductionMode,
    };
})();
