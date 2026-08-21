import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Next to package.json, wherever the process runs — not next to this module,
// which moves into build/ when bundled.
const FILE = resolve(process.cwd(), "db.json");

type Data = { settings?: Record<string, unknown>; bookings?: unknown[]; calls?: unknown[] };

const load = (): Data => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {});

// db.settings / db.bookings / db.calls — read and write straight to db.json.
export const db = new Proxy({} as Data, {
  get: (_, key: keyof Data) => load()[key],
  set: (_, key: keyof Data, value) => (writeFileSync(FILE, JSON.stringify({ ...load(), [key]: value }, null, 2)), true),
});
