import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { exec } from "node:child_process";
import crypto from "node:crypto";

const ROOT = process.cwd();
const DEFAULT_PORT = Number(process.env.PORT || 5173);
const MAX_PORT_TRIES = 25;

const DATA_DIR = path.resolve(ROOT, "data");
const DATA_FILE = path.resolve(DATA_DIR, "boxes.json");
const MAX_BODY_BYTES = 1_000_000;
const API_KEY = String(process.env.SOSBOX_API_KEY || "");

const MIME = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath) {
	return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function safeResolveUrlPathToFile(requestPath) {
	// Normalize and prevent path traversal
	const decoded = decodeURIComponent(requestPath);
	const withoutQuery = decoded.split("?")[0].split("#")[0];
	const rel = withoutQuery.replace(/^\/+/, "");
	const resolved = path.resolve(ROOT, rel);
	if (!resolved.startsWith(path.resolve(ROOT))) {
		return null;
	}
	return resolved;
}

function tryOpenBrowser(targetUrl) {
	const disabled = String(process.env.NO_OPEN || "").toLowerCase();
	if (disabled === "1" || disabled === "true") return;

	const platform = process.platform;
	const cmd =
		platform === "win32"
			? `start "" "${targetUrl}"`
			: platform === "darwin"
				? `open "${targetUrl}"`
				: `xdg-open "${targetUrl}"`;

	exec(cmd, { cwd: ROOT }, () => {
		// ignore failures (e.g. headless env)
	});
}

async function ensureDataFile() {
	await fs.promises.mkdir(DATA_DIR, { recursive: true });
	try {
		const st = await fs.promises.stat(DATA_FILE);
		if (!st.isFile()) throw new Error("DATA_FILE is not a file");
	} catch {
		await fs.promises.writeFile(DATA_FILE, "[]", "utf8");
	}
}

async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) {
			throw new Error("Body too large");
		}
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (!text.trim()) return null;
	return JSON.parse(text);
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

async function readBoxes() {
	try {
		const raw = await fs.promises.readFile(DATA_FILE, "utf8");
		const parsed = JSON.parse(raw || "[]");
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function writeBoxes(boxes) {
	await fs.promises.writeFile(DATA_FILE, JSON.stringify(boxes, null, 2), "utf8");
}

function json(res, status, payload) {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "content-type, x-api-key",
		"Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
	});
	res.end(JSON.stringify(payload));
}

function normalizeIncomingBox(input) {
	if (!input || typeof input !== "object") return null;
	const lat = Number(input.lat);
	const lng = Number(input.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

	const now = Date.now();
	const createdAt = Number(input.createdAt || input.firstSeen || now);
	return {
		id: String(input.id || crypto.randomUUID()),
		lat,
		lng,
		name: String(input.name || "SOS BOX"),
		note: String(input.note || ""),
		batteryPercent: clampInt(input.batteryPercent ?? input.battery ?? 0, 0, 150),
		powerbankMah: clampInt(input.powerbankMah ?? input.powerbank_mAh ?? 0, 0, 1_000_000),
		loadW: clampNumber(input.loadW ?? input.load_w ?? 5, 0.1, 1000),
		lastSeen: Number(input.lastSeen || input.ts || now),
		createdAt: Number.isFinite(createdAt) ? createdAt : now,
	};
}

async function handleApi(req, res, pathname) {
	if (req.method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Headers": "content-type, x-api-key",
			"Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
			"Cache-Control": "no-store",
		});
		res.end();
		return;
	}

	if (API_KEY) {
		const key = String(req.headers["x-api-key"] || "");
		if (key !== API_KEY) {
			json(res, 401, { error: "unauthorized" });
			return;
		}
	}

	if (req.method === "GET" && pathname === "/api/boxes") {
		const boxes = await readBoxes();
		json(res, 200, boxes);
		return;
	}

	if (req.method === "POST" && pathname === "/api/boxes/upsert") {
		let body;
		try {
			body = await readJsonBody(req);
		} catch (e) {
			json(res, 400, { error: String(e?.message || "invalid json") });
			return;
		}

		const items = Array.isArray(body)
			? body
			: Array.isArray(body?.boxes)
				? body.boxes
				: body
					? [body]
					: [];
		const incoming = items.map(normalizeIncomingBox).filter(Boolean);
		if (incoming.length === 0) {
			json(res, 400, { error: "no valid boxes" });
			return;
		}

		const existing = await readBoxes();
		const byId = new Map(existing.map((b) => [String(b.id), b]));
		for (const box of incoming) {
			const prev = byId.get(String(box.id));
			byId.set(String(box.id), { ...prev, ...box, id: String(box.id) });
		}
		const out = Array.from(byId.values());
		await writeBoxes(out);
		json(res, 200, { ok: true, upserted: incoming.length, total: out.length });
		return;
	}

	if (req.method === "DELETE" && pathname === "/api/boxes") {
		await writeBoxes([]);
		json(res, 200, { ok: true });
		return;
	}

	if (req.method === "DELETE" && pathname.startsWith("/api/boxes/")) {
		const id = decodeURIComponent(pathname.slice("/api/boxes/".length));
		const existing = await readBoxes();
		const filtered = existing.filter((b) => String(b.id) !== String(id));
		await writeBoxes(filtered);
		json(res, 200, { ok: true, deleted: existing.length - filtered.length });
		return;
	}

	json(res, 404, { error: "not found" });
}

function createServer() {
	return http.createServer((req, res) => {
		try {
			const reqUrl = new url.URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
			let pathname = reqUrl.pathname || "/";

			if (pathname.startsWith("/api/")) {
				void handleApi(req, res, pathname);
				return;
			}

			// Friendly default
			if (pathname === "/") {
				pathname = "/main.html";
			}

			const filePath = safeResolveUrlPathToFile(pathname);
			if (!filePath) {
				res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("Bad request");
				return;
			}

			fs.stat(filePath, (err, stat) => {
				if (err || !stat.isFile()) {
					res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
					res.end("Not found");
					return;
				}

				res.writeHead(200, {
					"Content-Type": contentTypeFor(filePath),
					"Cache-Control": "no-store",
				});

				fs.createReadStream(filePath).pipe(res);
			});
		} catch (e) {
			res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Internal server error");
		}
	});
}

async function listenOnFreePort(server, preferredPort) {
	for (let i = 0; i < MAX_PORT_TRIES; i++) {
		const port = preferredPort + i;
		const ok = await new Promise((resolve) => {
			server.once("error", (err) => {
				if (err && err.code === "EADDRINUSE") {
					resolve(false);
				} else {
					throw err;
				}
			});
			server.listen(port, "0.0.0.0", () => resolve(true));
		});
		if (ok) return port;
	}
	throw new Error(`No free port found starting at ${preferredPort}`);
}

await ensureDataFile();

const server = createServer();
const port = await listenOnFreePort(server, DEFAULT_PORT);

const localUrl = `http://127.0.0.1:${port}/main.html`;
console.log(`\nSOS BOX dev server running:`);
console.log(`- Root: ${ROOT}`);
console.log(`- URL:  ${localUrl}`);
console.log(`- Tip:  set NO_OPEN=1 to disable auto-open\n`);

tryOpenBrowser(localUrl);
