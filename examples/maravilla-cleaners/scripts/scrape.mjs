/**
 * Maravilla Cleaners — full-site Playwright scrape into the demo KB.
 *
 * `scripts/tap.mjs` covers the fallback: maravillacleaners.com is a pure
 * client-rendered SPA (`<div id="root"></div>`), so `@pinecall/sdk/tap`
 * (no headless browser, by design) sees 0 words on every page and tap falls
 * back to the site's own `/llms.txt` — 9 documents, hand-curated by the site
 * owner, not the actual pages.
 *
 * This script renders every page for real with Playwright, extracts the
 * main content with the same Defuddle+linkedom pipeline `@pinecall/sdk/tap`
 * uses internally (`src/tap/extract.ts` isn't exported from the `/tap`
 * subpath — see the hand-in note on `render: true` — so it's reimplemented
 * here, ~20 lines, against the same two deps), enriches each page with an
 * LLM header (scripts/enrich.mjs — descriptive title/breadcrumb/summary/
 * questions/keywords, cached by content hash, `--no-enrich` skips it), and
 * pushes it all into the same knowledge base the llms.txt docs live in.
 * Idempotent by path: re-running updates the same docs instead of
 * duplicating them.
 */

import "dotenv/config";
import { chromium } from "playwright";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { pushDocs } from "@pinecall/sdk";
import { enrichDocs } from "./enrich.mjs";

const SITE = "https://maravillacleaners.com";
const SITEMAP_URL = `${SITE}/sitemap.xml`;
const MAX_PAGES = 80;
const CRAWL_DELAY_MS = 300;
const RENDER_WAIT_TEXT_CHARS = 200;
const RENDER_WAIT_TIMEOUT_MS = 8000;
const THIN_WORDS = 40;
const BOILERPLATE_THRESHOLD = 0.5; // a line on > 50% of pages is boilerplate
const NO_ENRICH = process.argv.includes("--no-enrich");

const apiKey = process.env.PINECALL_API_KEY;
const kbId = process.env.MARAVILLA_KB_ID;
if (!apiKey) {
  console.error("Set PINECALL_API_KEY (see .env.example) before running npm run scrape.");
  process.exit(1);
}
if (!kbId) {
  console.error("Set MARAVILLA_KB_ID (see .env.example / npm run tap) before running npm run scrape.");
  process.exit(1);
}
const auth = { apiKey };

// ── 1. Discover URLs ────────────────────────────────────────────────────
//
// sitemap.xml here is a sitemapindex pointing at two child sitemaps
// (static pages + the /perspectives article API); tap.mjs's own discovery
// isn't exported past planTap, so this follows the index one level by hand.

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function discoverUrls() {
  const seen = new Set();
  const rootXml = await fetch(SITEMAP_URL).then((r) => r.text());
  const rootLocs = extractLocs(rootXml);
  const isIndex = /<sitemapindex/i.test(rootXml);

  const urlLists = isIndex
    ? await Promise.all(rootLocs.map((u) => fetch(u).then((r) => r.text()).then(extractLocs)))
    : [rootLocs];

  const origin = new URL(SITE).origin;
  const urls = [];
  for (const list of urlLists) {
    for (const raw of list) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      u.hash = "";
      u.search = "";
      const key = u.toString().replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(u.toString());
      if (urls.length >= MAX_PAGES) return urls;
    }
  }
  return urls;
}

// ── 2. Render + extract (mirrors src/tap/extract.ts) ───────────────────

async function extractMarkdown(html, url) {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, url, { markdown: true, removeImages: true, useAsync: false });
  const markdown = (result.content ?? "").trim();
  const words = result.wordCount ?? (markdown.match(/\S+/g)?.length ?? 0);
  const title = result.title || document.querySelector("h1")?.textContent?.trim() || document.title || "";
  return { markdown, words, title };
}

async function renderPage(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    try {
      await page.waitForFunction(
        (min) => (document.getElementById("root")?.innerText?.length ?? 0) > min,
        RENDER_WAIT_TEXT_CHARS,
        { timeout: RENDER_WAIT_TIMEOUT_MS },
      );
    } catch {
      // Fine — a legitimately short page (e.g. a thin legal stub) times out
      // the same way an empty shell would; wordCount below sorts it out.
    }
    return await page.content();
  } finally {
    await page.close();
  }
}

// ── 3. Path from URL ────────────────────────────────────────────────────

function pathFor(url) {
  const p = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  return (p ? `${p}.md` : "index.md");
}

// ── 4. Cross-page boilerplate: one copy kept in _site.md ───────────────

function stripBoilerplate(pages) {
  const lineCounts = new Map();
  for (const p of pages) {
    const lines = new Set(p.markdown.split("\n").map((l) => l.trim()).filter((l) => l.length >= 12));
    for (const l of lines) lineCounts.set(l, (lineCounts.get(l) ?? 0) + 1);
  }
  const threshold = pages.length * BOILERPLATE_THRESHOLD;
  const boilerplate = [...lineCounts.entries()]
    .filter(([, count]) => count > threshold)
    .map(([line]) => line);
  const boilerplateSet = new Set(boilerplate);

  for (const p of pages) {
    p.markdown = p.markdown
      .split("\n")
      .filter((l) => !boilerplateSet.has(l.trim()))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return boilerplate;
}

// ── Run ──────────────────────────────────────────────────────────────────

const urls = await discoverUrls();
console.log(`discovered ${urls.length} same-origin URLs (sitemap, capped at ${MAX_PAGES})`);

const browser = await chromium.launch();
const rendered = [];
let i = 0;
for (const url of urls) {
  i += 1;
  try {
    const html = await renderPage(browser, url);
    const { markdown, words, title } = await extractMarkdown(html, url);
    if (words < THIN_WORDS) {
      console.log(`  ⋯ [${i}/${urls.length}] ${url} — ${words} words, dropped (thin)`);
    } else {
      rendered.push({ url, path: pathFor(url), title, markdown, words });
      console.log(`  ✓ [${i}/${urls.length}] ${url} — ${words} words`);
    }
  } catch (err) {
    console.log(`  ✗ [${i}/${urls.length}] ${url} — ${err.message}`);
  }
  if (i < urls.length) await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
}
await browser.close();

const boilerplateLines = stripBoilerplate(rendered);
console.log(`boilerplate: ${boilerplateLines.length} lines seen on > ${BOILERPLATE_THRESHOLD * 100}% of pages, kept once in _site.md`);

const scrapedAt = new Date().toISOString();
const docs = rendered.map((p) => ({
  path: p.path,
  title: p.title,
  text: `---\nsource: ${p.url}\ntitle: ${p.title}\nscraped_at: ${scrapedAt}\n---\n\n# ${p.title}\n\n${p.markdown}\n`,
}));
if (boilerplateLines.length > 0) {
  docs.push({
    path: "_site.md",
    title: "Site-wide (nav, footer, contact)",
    text: `---\nsource: ${SITE}\ntitle: Site-wide (nav, footer, contact)\nscraped_at: ${scrapedAt}\n---\n\n# Site-wide content\n\nRepeated on more than ${BOILERPLATE_THRESHOLD * 100}% of pages (nav, footer, contact info) — kept once here instead of duplicated on every page.\n\n${boilerplateLines.join("\n")}\n`,
  });
}

const totalWords = rendered.reduce((sum, p) => sum + p.words, 0);
const totalTokens = Math.ceil(rendered.map((p) => p.markdown).join("").length / 4);

console.log(`enriching ${docs.length} docs${NO_ENRICH ? " — skipped (--no-enrich)" : " ..."}`);
const { docs: enrichedDocs, summary: enrichSummary } = await enrichDocs(docs, { apiKey, noEnrich: NO_ENRICH, source: "scrape" });

console.log(`pushing ${enrichedDocs.length} docs to ${kbId} ...`);
const results = await pushDocs(auth, kbId, enrichedDocs);
let pushedOk = 0;
for (const r of results) {
  if (r.ok) pushedOk += 1;
  else console.log(`  ✗ ${r.path}: ${r.error?.message}`);
}

console.log("");
console.log("=== scrape totals ===");
console.log(`pages rendered:  ${urls.length}`);
console.log(`pages kept:      ${rendered.length}`);
console.log(`words:           ${totalWords}`);
console.log(`tokens (~):      ${totalTokens}`);
console.log(`docs pushed:     ${pushedOk}/${enrichedDocs.length}`);
if (!NO_ENRICH) {
  console.log(`enrich:          ${enrichSummary.enriched} enriched, ${enrichSummary.cached} cached, ${enrichSummary.errors} errors, ${enrichSummary.titlesChanged} titles replaced, $${enrichSummary.costUSD}`);
}
