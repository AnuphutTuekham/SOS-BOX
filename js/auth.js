(() => {
    "use strict";

    const STORAGE_KEY = "sosbox_auth";
    const API_BASE = String(window.API_BASE || "").trim();
    const AUTH_FALLBACK_BASE = "https://sos-box-worker.anuphut.workers.dev";

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

    async function request(path, body) {
        let resp = await fetch(apiUrl(path), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        // Some hosts may not rewrite /api/auth/* correctly. Fallback to Worker auth API on 404.
        if (resp.status === 404) {
            resp = await fetch(new URL(path, AUTH_FALLBACK_BASE).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
        }

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data?.error || `Request failed: ${resp.status}`);
        }
        return data;
    }

    async function login(email, password) {
        const data = await request("/api/auth/login", {
            email: normalizeEmail(email),
            password: String(password || ""),
        });
        setSession(data.email || email);
        return data;
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
