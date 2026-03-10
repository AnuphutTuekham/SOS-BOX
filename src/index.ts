import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
	// Cloudflare D1 binding (wrangler.json: d1_databases.binding)
	sos_boxbd: D1Database;
}

function json(data: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("cache-control", "no-store");
	headers.set("access-control-allow-origin", "*");
	headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
	headers.set("access-control-allow-headers", "content-type");
	return new Response(JSON.stringify(data), { ...init, headers });
}

function clampInt(value: unknown, min: number, max: number) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}

function clampNumber(value: unknown, min: number, max: number) {
	const n = Number(value);
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}

type IncomingBox = {
	id?: string | number;
	name?: string;
	lat: number;
	lng?: number;
	lon?: number;
	status?: string;
	batt?: number;
	batteryPercent?: number;
	lastSeen?: number;
	createdAt?: number;
	wifi_count?: number;
	wifiCount?: number;
};

function normalizeIncomingBox(input: unknown) {
	if (!input || typeof input !== "object") return null;
	const b = input as IncomingBox;
	const lat = Number(b.lat);
	const lon = Number(b.lng ?? b.lon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	return {
		id: String(b.id ?? ""),
		name: String(b.name ?? "SOS BOX"),
		lat,
		lon,
		status: String(b.status ?? "online"),
		batt: clampInt(b.batt ?? b.batteryPercent ?? 0, 0, 150),
		wifi_count: clampInt(b.wifi_count ?? b.wifiCount ?? 0, 0, 100000),
		createdAt: Number(b.createdAt ?? Date.now()),
		lastSeen: Number(b.lastSeen ?? Date.now()),
	};
}

async function ensureSchema(db: D1Database) {
	// Keep it simple: create table if missing
	await db
		.prepare(
			"CREATE TABLE IF NOT EXISTS sosbox (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, lat REAL, lon REAL, status TEXT, batt INTEGER, wifi_count INTEGER DEFAULT 0, created_at TEXT, device_id TEXT)"
		)
		.run();

	await db
		.prepare(
			"CREATE TABLE IF NOT EXISTS traccar_raw_input (id INTEGER PRIMARY KEY AUTOINCREMENT, received_at TEXT NOT NULL, path TEXT NOT NULL, method TEXT NOT NULL, content_type TEXT, device_id TEXT, ip TEXT, payload TEXT NOT NULL)"
		)
		.run();

	await db
		.prepare(
			"CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)"
		)
		.run();

	const columns = await db.prepare("PRAGMA table_info(sosbox)").all();
	const names = new Set((columns.results ?? []).map((c: any) => String(c.name)));
	if (!names.has("device_id")) {
		await db.prepare("ALTER TABLE sosbox ADD COLUMN device_id TEXT").run();
	}
	if (!names.has("wifi_count")) {
		await db.prepare("ALTER TABLE sosbox ADD COLUMN wifi_count INTEGER DEFAULT 0").run();
	}
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const arr = Array.from(new Uint8Array(digest));
	return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeEmail(value: unknown): string {
	return String(value ?? "").trim().toLowerCase();
}

function payloadToText(payload: unknown): string {
	if (typeof payload === "string") return payload;
	try {
		return JSON.stringify(payload ?? null);
	} catch {
		return String(payload ?? "");
	}
}

function pickDeviceId(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "";
	const p = payload as any;
	const item =
		Array.isArray(p?.positions) && p.positions.length > 0
			? p.positions[0]
			: Array.isArray(p)
				? p[0]
				: p;
	if (!item || typeof item !== "object") return "";
	return String(item.device_id ?? item.deviceId ?? item.device?.id ?? item.id ?? item.deviceName ?? "");
}

function pickClientIp(request: Request): string {
	const forwarded = request.headers.get("x-forwarded-for") || "";
	if (forwarded.trim()) {
		return forwarded.split(",")[0]?.trim() || "";
	}
	return request.headers.get("cf-connecting-ip") || "";
}

async function logRawInput(
	db: D1Database,
	request: Request,
	path: string,
	payload: unknown
): Promise<void> {
	await db
		.prepare(
			"INSERT INTO traccar_raw_input (received_at, path, method, content_type, device_id, ip, payload) VALUES (?,?,?,?,?,?,?)"
		)
		.bind(
			new Date().toISOString(),
			path,
			request.method,
			request.headers.get("content-type") || "",
			pickDeviceId(payload),
			pickClientIp(request),
			payloadToText(payload)
		)
		.run();
}

type TraccarPayload = Record<string, unknown> | Array<Record<string, unknown>>;

function parseTimestampMs(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const ms = Date.parse(value);
		if (Number.isFinite(ms)) return ms;
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return Date.now();
}

function normalizeTraccarItem(input: unknown) {
	if (!input || typeof input !== "object") return null;
	let item: any = input;

	// Some Traccar client payloads wrap useful fields under a "location" object.
	if (item.location && typeof item.location === "object") {
		const loc: any = item.location;
		let lat: number | undefined;
		let lon: number | undefined;
		let battery: number | undefined;

		if (typeof loc._ === "string") {
			const qs = new URLSearchParams(loc._);
			lat = Number(qs.get("lat"));
			lon = Number(qs.get("lon"));
			const battStr = qs.get("batt") ?? qs.get("battery") ?? qs.get("batteryLevel");
			battery = battStr ? Number(battStr) : undefined;
		}

		if (!Number.isFinite(lat)) lat = Number(loc.lat ?? loc.latitude);
		if (!Number.isFinite(lon)) lon = Number(loc.lon ?? loc.lng ?? loc.longitude);
		if (!Number.isFinite(battery as any)) {
			const batt = loc.battery;
			battery = typeof batt === "object" ? Number(batt?.level ?? batt?.value) : Number(batt);
		}

		item = {
			...item,
			lat,
			lon,
			battery,
			timestamp: loc.timestamp ?? item.timestamp,
		};
	}

	const lat = Number(item.lat ?? item.latitude);
	const lon = Number(item.lon ?? item.lng ?? item.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

	const deviceId = String(
		item.device_id ?? item.deviceId ?? item.device?.id ?? item.id ?? item.deviceName ?? ""
	);
	const name = String(item.name ?? item.deviceName ?? item.device?.name ?? deviceId ?? "SOS BOX");

	// Battery can be 0-1 or 0-100 depending on source.
	const battRaw = Number(
		item.battery ??
			item.batt ??
			item.batteryLevel ??
			item.attributes?.batteryLevel ??
			item.attributes?.battery ??
			0
	);
	const battPercent = battRaw <= 1 ? battRaw * 100 : battRaw;
	const batt = clampInt(battPercent, 0, 150);
	const wifiCount = clampInt(Number(item.wifi_count ?? item.wifiCount ?? 0), 0, 100000);

	const lastSeen = parseTimestampMs(
		item.timestamp ?? item.fixTime ?? item.deviceTime ?? item.serverTime ?? item.time
	);

	return {
		deviceId,
		name,
		lat,
		lon,
		status: String(item.status ?? "online"),
		batt,
		wifi_count: wifiCount,
		lastSeen,
	};
}

async function readTraccarPayload(request: Request): Promise<TraccarPayload | null> {
	const contentType = request.headers.get("content-type") || "";
	if (contentType.includes("application/json")) {
		return (await request.json().catch(() => null)) as TraccarPayload | null;
	}
	if (contentType.includes("application/x-www-form-urlencoded")) {
		const text = await request.text();
		const params = new URLSearchParams(text);
		const obj: Record<string, unknown> = {};
		for (const [k, v] of params.entries()) obj[k] = v;
		return obj;
	}
	if (contentType.includes("multipart/form-data")) {
		const form = await request.formData();
		const obj: Record<string, unknown> = {};
		for (const [k, v] of form.entries()) obj[k] = typeof v === "string" ? v : "";
		return obj;
	}
	// Fallback: try JSON
	return (await request.json().catch(() => null)) as TraccarPayload | null;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		await ensureSchema(env.sos_boxbd);

		// Log root POST for Traccar Client
		if (url.pathname === "/" && request.method === "POST") {
			try {
				const contentType = request.headers.get("content-type") || "";
				let payload: any = null;

				if (contentType.includes("application/json")) {
					payload = await request.clone().json().catch(() => null);
				} else if (contentType.includes("application/x-www-form-urlencoded")) {
					const text = await request.clone().text();
					payload = Object.fromEntries(new URLSearchParams(text).entries());
				} else if (contentType.includes("multipart/form-data")) {
					const form = await request.clone().formData();
					payload = Object.fromEntries(form.entries());
				} else {
					try {
						payload = await request.clone().json();
					} catch {
						payload = await request.clone().text();
					}
				}

				await logRawInput(env.sos_boxbd, request, url.pathname, payload);

				// Extract Traccar fields - handle nested location object
				let item = typeof payload === "object" && payload !== null ? payload : {};
				
				// If payload has nested location, extract from there
				if (item.location && typeof item.location === "object") {
					const loc = item.location as any;
					
					// Try to extract from location._ (query string format)
					let lat: number | undefined;
					let lon: number | undefined;
					let battery: number | undefined;
					
					if (typeof loc._ === "string") {
						const qs = new URLSearchParams(loc._);
						lat = Number(qs.get("lat"));
						lon = Number(qs.get("lon"));
						const battStr = qs.get("batt") ?? qs.get("battery");
						battery = battStr ? Number(battStr) : undefined;

					}
					
					// Fallback to direct properties
					if (!Number.isFinite(lat)) lat = loc.lat ?? loc.latitude;
					if (!Number.isFinite(lon)) lon = loc.lon ?? loc.lng ?? loc.longitude;
					if (!Number.isFinite(battery as any)) {
						const batt = loc.battery;
						battery = typeof batt === "object" ? Number(batt?.level) : Number(batt);
					}
					
					item = {
						...item,
						lat,
						lon,
						battery,
						timestamp: loc.timestamp,
					};
				}

				const lat = Number(item.lat ?? item.latitude);
				const lon = Number(item.lon ?? item.lng ?? item.longitude);
				if (Number.isFinite(lat) && Number.isFinite(lon)) {
					const deviceId = String(item.device_id ?? item.id ?? item.deviceId ?? item.deviceName ?? "");
					// Battery value from Traccar is 0-1 (decimal), convert to percentage
					const battRaw = Number(item.battery ?? item.batt ?? 0);
					const battPercent = battRaw <= 1 ? battRaw * 100 : battRaw;
					const batt = clampInt(battPercent, 0, 150);
					const wifiCount = clampInt(Number(item.wifi_count ?? item.wifiCount ?? 0), 0, 100000);
					const lastSeen = item.timestamp ? new Date(item.timestamp).getTime() : Date.now();
					const name = String(item.name ?? item.deviceName ?? deviceId ?? "SOS BOX");
					const createdAtIso = new Date(lastSeen).toISOString();

					if (deviceId) {
						const existing = await env.sos_boxbd
							.prepare("SELECT id FROM sosbox WHERE device_id = ? LIMIT 1")
							.bind(deviceId)
							.first();
						if (existing?.id) {
							await env.sos_boxbd
								.prepare(
									"UPDATE sosbox SET name=?, lat=?, lon=?, status=?, batt=?, created_at=? WHERE id=?"
								)
								.bind(name, lat, lon, "online", batt, createdAtIso, existing.id)
								.run();
							return json({ ok: true, upserted: 1 });
						}
					}

					await env.sos_boxbd
						.prepare(
							"INSERT INTO sosbox (name, lat, lon, status, batt, created_at, device_id) VALUES (?,?,?,?,?,?,?)"
						)
						.bind(name, lat, lon, "online", batt, createdAtIso, deviceId)
						.run();
					return json({ ok: true, upserted: 1 });
				}

				return json({ error: "missing or invalid lat/lon", received: payload }, { status: 400 });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"access-control-allow-origin": "*",
					"access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
					"access-control-allow-headers": "content-type",
					"cache-control": "no-store",
				},
			});
		}

		// Health check
		if (url.pathname === "/api/health") {
			return json({ ok: true, service: "sos-box-worker" });
		}

		if (url.pathname === "/api/raw-input" && request.method === "GET") {
			try {
				const limit = clampInt(url.searchParams.get("limit") ?? 100, 1, 500);
				const r = await env.sos_boxbd
					.prepare(
						"SELECT id, received_at, path, method, content_type, device_id, ip, payload FROM traccar_raw_input ORDER BY id DESC LIMIT ?"
					)
					.bind(limit)
					.all();
				return json(r.results ?? []);
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/raw-input" && request.method === "DELETE") {
			try {
				await env.sos_boxbd.prepare("DELETE FROM traccar_raw_input").run();
				return json({ ok: true });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/auth/register" && request.method === "POST") {
			try {
				const body = await request.json().catch(() => null);
				const email = normalizeEmail(body?.email);
				const password = String(body?.password ?? "");
				if (!email || !email.includes("@") || password.length < 4) {
					return json({ error: "invalid email or password" }, { status: 400 });
				}

				const exists = await env.sos_boxbd
					.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
					.bind(email)
					.first();
				if (exists?.id) {
					return json({ error: "email already exists" }, { status: 409 });
				}

				const passwordHash = await sha256Hex(password);
				await env.sos_boxbd
					.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)")
					.bind(email, passwordHash, new Date().toISOString())
					.run();

				return json({ ok: true, email });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/auth/login" && request.method === "POST") {
			try {
				const body = await request.json().catch(() => null);
				const email = normalizeEmail(body?.email);
				const password = String(body?.password ?? "");
				if (!email || !password) {
					return json({ error: "missing email or password" }, { status: 400 });
				}

				const user = await env.sos_boxbd
					.prepare("SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1")
					.bind(email)
					.first<{ id: number; email: string; password_hash: string }>();

				if (!user?.id) {
					return json({ error: "invalid credentials" }, { status: 401 });
				}

				const passwordHash = await sha256Hex(password);
				if (passwordHash !== user.password_hash) {
					return json({ error: "invalid credentials" }, { status: 401 });
				}

				return json({ ok: true, email: user.email });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		// Minimal API compatible with your frontend: /api/boxes + /api/boxes/upsert
		if (url.pathname === "/api/boxes" && request.method === "GET") {
			try {
				await ensureSchema(env.sos_boxbd);
				const r = await env.sos_boxbd
					.prepare(
						"SELECT id, name, lat, lon, status, batt, wifi_count, created_at, device_id FROM sosbox ORDER BY id DESC"
					)
					.all();
				const rows = (r.results ?? []).map((x: any) => ({
					id: String(x.id),
					name: x.name ?? "SOS BOX",
					lat: clampNumber(x.lat, -90, 90),
					lng: clampNumber(x.lon, -180, 180),
					batteryPercent: clampInt(x.batt, 0, 150),
					note: "",
					powerbankMah: 10000,
					loadW: 5,
					deviceId: String(x.device_id ?? ""),
					lastSeen: Date.parse(x.created_at) || Date.now(),
					createdAt: Date.parse(x.created_at) || Date.now(),
				}));
				return json(rows);
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/boxes" && request.method === "DELETE") {
			try {
				await ensureSchema(env.sos_boxbd);
				await env.sos_boxbd.prepare("DELETE FROM sosbox").run();
				return json({ ok: true });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname.startsWith("/api/boxes/") && request.method === "DELETE") {
			try {
				await ensureSchema(env.sos_boxbd);
				const id = url.pathname.slice("/api/boxes/".length);
				const n = clampInt(id, 0, 2_000_000_000);
				await env.sos_boxbd.prepare("DELETE FROM sosbox WHERE id = ?").bind(n).run();
				return json({ ok: true });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/boxes/upsert" && request.method === "POST") {
			try {
				await ensureSchema(env.sos_boxbd);
				const body = await request.json().catch(() => null);
				const items = Array.isArray(body)
					? body
					: Array.isArray((body as any)?.boxes)
						? (body as any).boxes
						: body
							? [body]
							: [];
				const normalized = items.map(normalizeIncomingBox).filter(Boolean) as any[];
				if (normalized.length === 0) return json({ error: "no valid boxes" }, { status: 400 });

				for (const b of normalized) {
					// If the caller provides numeric id, update; otherwise insert new
					const idNum = Number(b.id);
					const createdAtIso = new Date(b.lastSeen || Date.now()).toISOString();
					if (Number.isFinite(idNum) && idNum > 0) {
						await env.sos_boxbd
							.prepare(
							"UPDATE sosbox SET name=?, lat=?, lon=?, status=?, batt=?, wifi_count=?, created_at=? WHERE id=?"
						)
						.bind(b.name, b.lat, b.lon, b.status, b.batt, b.wifi_count ?? 0, createdAtIso, idNum)
						.run();
					} else {
						await env.sos_boxbd
							.prepare(
								"INSERT INTO sosbox (name, lat, lon, status, batt, wifi_count, created_at) VALUES (?,?,?,?,?,?,?)"
							)
							.bind(b.name, b.lat, b.lon, b.status, b.batt, b.wifi_count ?? 0, createdAtIso)
							.run();
					}
				}
				return json({ ok: true, upserted: normalized.length });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/traccar" && (request.method === "POST" || request.method === "GET")) {
			try {
				const payload =
					request.method === "GET"
						? Object.fromEntries(url.searchParams.entries())
						: await readTraccarPayload(request);
				await logRawInput(env.sos_boxbd, request, url.pathname, payload);
				const items = Array.isArray(payload)
					? payload
					: Array.isArray((payload as any)?.positions)
						? (payload as any).positions
						: payload
							? [payload]
							: [];
				const normalized = items
					.map((item: any) => normalizeTraccarItem(item))
					.filter(Boolean) as any[];
				if (normalized.length === 0) return json({ error: "no valid positions" }, { status: 400 });

				for (const b of normalized) {
					const createdAtIso = new Date(b.lastSeen || Date.now()).toISOString();
					if (b.deviceId) {
						const existing = await env.sos_boxbd
							.prepare("SELECT id FROM sosbox WHERE device_id = ? LIMIT 1")
							.bind(b.deviceId)
							.first();
						if (existing?.id) {
							await env.sos_boxbd
								.prepare(
								"UPDATE sosbox SET name=?, lat=?, lon=?, status=?, batt=?, wifi_count=?, created_at=? WHERE id=?"
							)
							.bind(b.name, b.lat, b.lon, b.status, b.batt, b.wifi_count ?? 0, createdAtIso, existing.id)
							.run();
						continue;
						}
					}

					await env.sos_boxbd
						.prepare(
							"INSERT INTO sosbox (name, lat, lon, status, batt, wifi_count, created_at, device_id) VALUES (?,?,?,?,?,?,?,?)"
						)
						.bind(b.name, b.lat, b.lon, b.status, b.batt, b.wifi_count ?? 0, createdAtIso, b.deviceId)
						.run();
				}
				return json({ ok: true, upserted: normalized.length });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		if (url.pathname === "/api/traccar/raw" && request.method === "POST") {
			try {
				const payload = await readTraccarPayload(request);
				await logRawInput(env.sos_boxbd, request, url.pathname, payload);
				return json({ ok: true });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		const wifiMatch = url.pathname.match(/^\/api\/boxes\/(\d+)\/wifi_count$/);
		if (wifiMatch) {
			const id = clampInt(wifiMatch[1], 0, 2_000_000_000);
			try {
				await ensureSchema(env.sos_boxbd);
				if (request.method === "GET") {
					const r = await env.sos_boxbd
						.prepare("SELECT wifi_count FROM sosbox WHERE id = ? LIMIT 1")
						.bind(id)
						.first();
					const count = Number(r?.wifi_count ?? 0);
					return json({ wifi_count: count });
				}
				if (request.method === "POST") {
					const body = await request.json().catch(() => null);
					const val = clampInt(body?.wifi_count ?? body?.wifiCount ?? body?.count ?? 0, 0, 100000);
					await env.sos_boxbd
						.prepare("UPDATE sosbox SET wifi_count = ? WHERE id = ?")
						.bind(val, id)
						.run();
					return json({ ok: true, wifi_count: val });
				}
				return json({ error: "method not allowed" }, { status: 405 });
			} catch (e: any) {
				return json({ error: e?.message || String(e) }, { status: 500 });
			}
		}

		return json({ error: "not found" }, { status: 404 });
	},
};
