import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

function parseIds(value) {
	return String(value || "")
		.split(/[^0-9]+/g)
		.map((s) => s.trim())
		.filter(Boolean);
}

async function fileExists(rel) {
	try {
		const st = await fs.stat(path.resolve(ROOT, rel));
		return st.isFile();
	} catch {
		return false;
	}
}

function fail(message) {
	console.error(`❌ ${message}`);
	process.exitCode = 1;
	throw new Error(message);
}

const expectedIds = parseIds(process.env.SOSBOX_STUDENT_IDS);
const ids = expectedIds.length ? expectedIds : ["67022995"];

const preferredTargets = ["public/main.html", "public/edit.html"];
const fallbackTargets = ["main.html", "edit.html"];

const hasPreferred = (await Promise.all(preferredTargets.map(fileExists))).every(Boolean);
const targets = hasPreferred ? preferredTargets : fallbackTargets;

for (const rel of targets) {
	if (!(await fileExists(rel))) {
		fail(`Missing file to validate: ${rel}`);
	}
	const html = await fs.readFile(path.resolve(ROOT, rel), "utf8");

	if (!html.includes('data-testid="group-info"')) {
		fail(`Expected group marker data-testid=\"group-info\" not found in ${rel}`);
	}

	for (const id of ids) {
		if (!html.includes(id)) {
			fail(`Expected student id ${id} not found in ${rel}`);
		}
	}

	console.log(`✅ ${rel}: contains group-info + ${ids.length} id(s)`);
}

console.log("✅ Student ID visibility check passed");
