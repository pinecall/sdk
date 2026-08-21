/**
 * Maravilla Cleaners — tap the public site into the demo knowledge base.
 *
 * First run: no MARAVILLA_KB_ID set → planTap, create the KB, tap() it in,
 * print the id to save into .env.
 * Later runs: MARAVILLA_KB_ID set → syncTap, incremental, idempotent.
 *
 * Exclusions applied by hand (docs/notes/tap-llm-quality-research.md §3 A,
 * option A "deterministic pass"): skip auth/account pages, legal/policy
 * pages, and pagination query strings; syncTap's near-dup handling on repeat
 * runs keeps one copy of any repeated block.
 */

import "dotenv/config";
import { planTap, tap, syncTap, TapSyncError } from "@pinecall/sdk/tap";
import { createKnowledgeBase } from "@pinecall/sdk";

const SITE = "https://maravillacleaners.com/";
const KB_NAME = "maravilla-cleaners-demo";

const apiKey = process.env.PINECALL_API_KEY;
if (!apiKey) {
  console.error("Set PINECALL_API_KEY (see .env.example) before running npm run tap.");
  process.exit(1);
}
const auth = { apiKey };

// Skip auth/account flows, legal/policy pages, and paginated listing pages.
const exclude = [
  /\/(login|signup|sign-up|account|cart|checkout|my-account)(\/|$)/i,
  /\/(privacy|privacy-policy|terms|terms-of-service|legal)(\/|$)/i,
  /[?&]page=\d+/i,
];

let kbId = process.env.MARAVILLA_KB_ID;

if (kbId) {
  try {
    const report = await syncTap(auth, kbId, { exclude });
    console.log(`synced maravilla-cleaners-demo (${kbId}):`);
    console.log(report);
    process.exit(0);
  } catch (err) {
    if (!(err instanceof TapSyncError)) throw err;
    console.log(`KB ${kbId} has no manifest yet — tapping fresh.`);
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

const report = await tap(auth, kbId, plan);
console.log(`tapped into ${kbId}:`);
console.log(report);
