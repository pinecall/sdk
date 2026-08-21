/**
 * Maravilla Cleaners — tap the public site into the demo knowledge base.
 *
 * https://maravillacleaners.com/ is a pure client-rendered SPA (React/Vite —
 * every page's HTML body is `<div id="root"></div>`). `tap` has no headless
 * browser by design (docs/guides/tap.md), so planTap comes back with
 * needsJs: true and 0 words on every page — there is nothing for it to read.
 *
 * The site's own /llms.txt is the sanctioned fallback: its robots.txt names
 * it "Reading guide for language models" and explicitly allows LLM crawlers
 * to quote and cite it (see the "Using this content" section of the file
 * itself). We fetch it, split it by its `##` sections into a handful of
 * documents, and push them with the SDK's knowledge API (pushDocs) — upsert
 * by path, so re-running this script is idempotent exactly like syncTap.
 *
 * If a future site ever serves real markup, planTap/tap/syncTap run first
 * and this script uses that instead — the llms.txt path is a fallback, not
 * the primary route.
 */

import "dotenv/config";
import { planTap, tap, syncTap, TapSyncError } from "@pinecall/sdk/tap";
import { createKnowledgeBase, pushDocs } from "@pinecall/sdk";

const SITE = "https://maravillacleaners.com/";
const LLMS_TXT_URL = "https://maravillacleaners.com/llms.txt";
const KB_NAME = "maravilla-cleaners-demo";

const apiKey = process.env.PINECALL_API_KEY;
if (!apiKey) {
  console.error("Set PINECALL_API_KEY (see .env.example) before running npm run tap.");
  process.exit(1);
}
const auth = { apiKey };

// Skip auth/account flows, legal/policy pages, and paginated listing pages —
// docs/notes/tap-llm-quality-research.md §3 A, applied by hand in the plan step.
const exclude = [
  /\/(login|signup|sign-up|account|cart|checkout|my-account)(\/|$)/i,
  /\/(privacy|privacy-policy|terms|terms-of-service|legal)(\/|$)/i,
  /[?&]page=\d+/i,
];

let kbId = process.env.MARAVILLA_KB_ID;

// ── Fallback: fetch llms.txt and split it into docs by `##` section ────────

function splitLlmsTxt(text) {
  const lines = text.split("\n");
  const docs = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      if (current) docs.push(current);
      const title = heading[1].trim();
      const path = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".md";
      current = { path, title, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      // Content before the first `##` (the `#` title + intro) → its own doc.
      current = { path: "overview.md", title: "Overview", lines: [line] };
    }
  }
  if (current) docs.push(current);

  return docs.map((d) => ({
    path: d.path,
    title: d.title,
    text: `<!-- source: ${LLMS_TXT_URL} -->\n\n# ${d.title}\n\n${d.lines.join("\n").trim()}\n`,
  }));
}

async function tapFromLlmsTxt(kbId) {
  const res = await fetch(LLMS_TXT_URL);
  if (!res.ok) throw new Error(`GET ${LLMS_TXT_URL} → ${res.status}`);
  const text = await res.text();
  const docs = splitLlmsTxt(text);
  console.log(`llms.txt: ${text.length} chars → ${docs.length} docs (${docs.map((d) => d.path).join(", ")})`);

  const results = await pushDocs(auth, kbId, docs);
  for (const r of results) console.log(r.ok ? `  ✓ ${r.path}` : `  ✗ ${r.path}: ${r.error?.message}`);
  return results;
}

// ── Try tap() first; fall back to llms.txt when the site is all needsJs ────

if (kbId) {
  try {
    const report = await syncTap(auth, kbId, { exclude });
    if (report.pushed + report.updated + report.skipped > 0) {
      console.log(`synced maravilla-cleaners-demo (${kbId}) via tap:`);
      console.log(report);
      process.exit(0);
    }
  } catch (err) {
    if (!(err instanceof TapSyncError)) throw err;
    console.log(`KB ${kbId} has no tap manifest — trying tap fresh, then the llms.txt fallback.`);
  }
}

const plan = await planTap(SITE, { limit: 60, exclude });
console.log(
  `discovered via ${plan.source}: ${plan.totals.included}/${plan.totals.pages} pages included ` +
    `(${plan.totals.excluded} excluded, ${plan.totals.thin} thin, ${plan.totals.needsJs} needsJs), ` +
    `~${plan.totals.tokens} tokens`,
);

if (!kbId) {
  const kb = await createKnowledgeBase(auth, KB_NAME, "Maravilla Cleaners public website (demo agent KB)");
  kbId = kb.id;
  console.log(`created knowledge base ${kbId} — add MARAVILLA_KB_ID=${kbId} to your .env`);
}

if (plan.totals.tokens > 0) {
  const report = await tap(auth, kbId, plan);
  console.log(`tapped into ${kbId}:`);
  console.log(report);
} else {
  console.log(`every page needs JS to render (0 tokens extracted) — falling back to ${LLMS_TXT_URL}`);
  await tapFromLlmsTxt(kbId);
}
