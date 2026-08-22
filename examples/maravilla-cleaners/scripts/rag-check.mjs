/**
 * Retrieval probe for the Maravilla demo KB — hits@5 and MRR against a fixed
 * set of realistic caller questions (scripts/rag-check.fixture.json), each
 * labeled with the doc path that should answer it. Used to produce the
 * before/after tables for the enrichment lane (tk-56c63b).
 *
 *   node scripts/rag-check.mjs [--label=before|after] [--out=rag-check.<label>.json]
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { queryKnowledge } from "@pinecall/sdk";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const label = opt("label", "run");
const K = 10; // fetch enough to compute MRR past the hits@5 cutoff

const apiKey = process.env.PINECALL_API_KEY;
const kbId = process.env.MARAVILLA_KB_ID;
if (!apiKey || !kbId) {
  console.error("Set PINECALL_API_KEY and MARAVILLA_KB_ID (see .env.example).");
  process.exit(1);
}
const auth = { apiKey };

const fixture = JSON.parse(readFileSync(join(HERE, "rag-check.fixture.json"), "utf8"));

const rows = [];
for (const { q, expected } of fixture) {
  const hits = await queryKnowledge(auth, kbId, q, { k: K });
  const rank = hits.findIndex((h) => h.doc_path === expected) + 1; // 0 → not found in top-K
  const hit5 = rank > 0 && rank <= 5;
  const topPath = hits[0]?.doc_path ?? "(none)";
  rows.push({ q, expected, rank: rank || null, hit5, top: topPath });
  console.log(
    `  ${hit5 ? "✓" : "✗"} rank=${rank || `>${K}`}  "${q}"  → expected ${expected}${rank !== 1 ? `  (top hit: ${topPath})` : ""}`,
  );
}

const hitsAt5 = rows.filter((r) => r.hit5).length;
const mrr = rows.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / rows.length;

console.log("");
console.log(`=== rag-check (${label}) ===`);
console.log(`questions: ${rows.length}`);
console.log(`hits@5:    ${hitsAt5}/${rows.length}`);
console.log(`MRR:       ${mrr.toFixed(3)}`);

const out = { label, at: new Date().toISOString(), kbId, hitsAt5, total: rows.length, mrr: Number(mrr.toFixed(4)), rows };
const outPath = join(HERE, "..", opt("out", `rag-check.${label}.json`));
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`written: ${outPath}`);
