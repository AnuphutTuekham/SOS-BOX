(() => {
    "use strict";

    const host = String(window.location.hostname || "").toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (isLocal) return;

    const restrictedPages = new Set([
        "dashboard.html",
        "device.html",
        "sensor.html",
        "raw-input.html",
    ]);

    const currentPath = window.location.pathname || "/";
    const currentPage = (currentPath.split("/").pop() || "").toLowerCase();
    if (!restrictedPages.has(currentPage)) return;

    const session = window.SOSBoxAuth?.getSession?.() || null;
    if (session?.email) return;

    const returnTo = `${currentPage}${window.location.search || ""}${window.location.hash || ""}`;
    const loginUrl = new URL("register.html", window.location.href);
    loginUrl.searchParams.set("return", returnTo);
    window.location.replace(loginUrl.toString());
})();
