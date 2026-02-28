import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.resolve(ROOT, "public");

const toCopy = [
	"main.html",
	"edit.html",
	"config.js",
	"css",
	"js",
	"pic",
	"favicon.svg",
];

async function rmDir(dir) {
	await fs.promises.rm(dir, { recursive: true, force: true });
}

async function copyDir(src, dest) {
	await fs.promises.mkdir(dest, { recursive: true });
	const entries = await fs.promises.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			await copyDir(from, to);
		} else if (entry.isFile()) {
			await fs.promises.copyFile(from, to);
		}
	}
}

async function copyOne(rel) {
	const src = path.resolve(ROOT, rel);
	const dest = path.resolve(OUT_DIR, rel);
	const st = await fs.promises.stat(src);
	if (st.isDirectory()) {
		await copyDir(src, dest);
		return;
	}
	await fs.promises.mkdir(path.dirname(dest), { recursive: true });
	await fs.promises.copyFile(src, dest);
}

await rmDir(OUT_DIR);
await fs.promises.mkdir(OUT_DIR, { recursive: true });

for (const rel of toCopy) {
	try {
		await copyOne(rel);
	} catch {
		// Optional asset might not exist in some repos.
	}
}

// Vercel-friendly default: / serves main.html via vercel.json redirect,
// but having an index.html helps local/static hosting too.
try {
	await fs.promises.copyFile(path.resolve(OUT_DIR, "main.html"), path.resolve(OUT_DIR, "index.html"));
} catch {
	// ignore
}

console.log(`Prepared static output: ${path.relative(ROOT, OUT_DIR)}`);
