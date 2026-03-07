// Auto-detect: use local dev server if on localhost, otherwise use production
if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
	window.API_BASE = "";
} else {
	window.API_BASE = "https://sos-box-worker.anuphut.workers.dev";
}
