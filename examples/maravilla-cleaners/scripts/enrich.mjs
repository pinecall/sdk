/**
 * LLM enrichment for the Maravilla scraped pages — option D of
 * docs/notes/tap-llm-quality-research.md (§3 D, §6-§7), reusing the exact
 * prompt/header shape measured in scripts/research/07-option-d.mjs.
 *
 * For each page, one call to Pinecall's own LLM gateway
 * (POST /api/llm/chat, no `model` field → the cheap OpenRouter default)
 * asks for { title, breadcrumb, summary, questions[3-5], keywords[5-12] }
 * and the result is inserted as a `## What this page answers` header under
 * the frontmatter — the body is never touched.
 *
 * Title rule (the measured trap, §6.2): the cheap model rewrites EVERY
 * title, and on marketing sites with already-good titles that cost 0.13
 * MRR (basecamp). So the doc's `title` is replaced only when the original
 * is empty, a bare date, or the SPA's static site name — every other page
 * keeps its original title and the generated one lives in the header only.
 *
 * Cached by sha256 of the page body (the frontmatter carries a fresh
 * `scraped_at` every run, so hashing the whole doc text would defeat the
 * cache) in .enrich-cache.json, gitignored — an unchanged page costs zero
 * LLM calls on the next `npm run scrape`.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(HERE, "..", ".enrich-cache.json");
const LLM_API = process.env.PINECALL_VOICE_URL ?? "https://voice.pinecall.io";
const SITE_TITLE = "Maravilla — Marvelously Clean.";
const MAX_ERROR_RATE = 0.1;
const RETRIES = 3;

// $/M tokens for the gateway's default (cheap) model — docs/notes/tap-llm-quality-research.md §5.
const PRICE = { in: 0.048, out: 0.193 };

// Exactly the system prompt measured in scripts/research/07-option-d.mjs.
const SYSTEM = `You index web pages for a voice agent's knowledge base. Given one page (url, title, markdown), return ONLY JSON:
{"title": "<clear descriptive title, <= 80 chars, no site name suffix>",
 "breadcrumb": "<Site > Section > Page, from the URL and content>",
 "summary": "<one sentence, <= 30 words, what this page tells a user>",
 "questions": ["<3 to 5 natural questions a customer would ask that THIS page answers, in the page's language>"],
 "keywords": ["<5 to 12 exact terms, names, product names, numbers, synonyms users would say>"]}
Use only what is on the page. Never invent facts.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    breadcrumb: { type: "string" },
    summary: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["title", "questions", "keywords"],
};

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveCache(cache) {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

/** Split a doc's text into { frontmatter, body }. `body` is what gets hashed and shown to the LLM. */
function splitFrontmatter(text) {
  const m = text.match(/^---[\s\S]*?---\n\n/);
  const frontmatter = m ? m[0] : "";
  return { frontmatter, body: text.slice(frontmatter.length) };
}

/** Original title is a substitution candidate: empty, a bare date, or the SPA's static site name. */
function isReplaceableTitle(title) {
  const t = (title ?? "").trim();
  if (!t) return true;
  if (t === SITE_TITLE) return true;
  if (/^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(t)) return true; // e.g. "1999/12/24", "2026-08-21"
  return false;
}

function buildHeader(j, fallbackTitle) {
  return (
    `## What this page answers\n\n` +
    (j.summary ? `${j.summary}\n\n` : "") +
    (j.breadcrumb ? `*${j.breadcrumb}*\n\n` : "") +
    (j.questions?.length ? `**Questions this page answers:** ${j.questions.join(" · ")}\n\n` : "") +
    (j.keywords?.length ? `**Keywords:** ${j.keywords.join(", ")}\n\n` : "")
  );
}

function costOf(usage) {
  return ((usage?.input_tokens ?? 0) * PRICE.in + (usage?.output_tokens ?? 0) * PRICE.out) / 1e6;
}

/** One SSE call to the gateway. No `model` field → the gateway's cheap default. Throws on {type:error} and on a genuinely empty stream. */
async function llmOnce({ apiKey, system, user }) {
  const res = await fetch(`${LLM_API}/api/llm/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      system,
      messages: [{ role: "user", content: user }],
      temperature: 0,
      max_tokens: 700,
      mode: "analysis",
      format: SCHEMA,
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  let error = null;
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") break outer;
        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt.type === "token") text += evt.content;
        else if (evt.type === "done") usage = evt.usage ?? usage;
        else if (evt.type === "error") error = `${evt.code ?? "UPSTREAM_ERROR"}${evt.status ? ` ${evt.status}` : ""}: ${evt.error}`;
      }
    }
  }
  if (error) throw new Error(`llm upstream error: ${error}`);
  // A 200 with no token AND no usage is the outage failure mode seen 2026-08-21 — never treat it as success.
  if (!text.trim() && !(usage.output_tokens > 0)) throw new Error("llm upstream: empty stream (no tokens, no error frame)");
  return { text, usage };
}

async function llmWithRetry(opts) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await llmOnce(opts);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
    }
  }
  throw lastErr;
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {}
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  throw new Error(`not JSON: ${text.slice(0, 200)}`);
}

/**
 * Enrich `docs` (the array scrape.mjs builds, `{ path, title, text }`) in place
 * and return the enriched copies plus a run summary. `noEnrich: true` is the
 * cheap path — returns docs untouched, no LLM calls.
 */
export async function enrichDocs(docs, { apiKey, source, noEnrich = false } = {}) {
  if (noEnrich) return { docs, summary: { skipped: true, pages: docs.length, cached: 0, enriched: 0, errors: 0, costUSD: 0, titlesChanged: 0 } };
  if (!apiKey) throw new Error("enrichDocs: apiKey is required");

  const cache = loadCache();
  const out = [];
  let cached = 0, enriched = 0, errors = 0, costUSD = 0, titlesChanged = 0;

  for (const d of docs) {
    const { frontmatter, body } = splitFrontmatter(d.text);
    const hash = sha256(body);
    let j = cache[hash]?.enrichment;

    if (j) {
      cached += 1;
    } else {
      const url = (frontmatter.match(/^source: (.*)$/m) ?? [])[1] ?? "";
      const excerpt = body.length > 12000 ? body.slice(0, 12000) + "\n…(truncated)" : body;
      try {
        const res = await llmWithRetry({ apiKey, system: SYSTEM, user: `url: ${url}\ntitle: ${d.title}\n\n${excerpt}` });
        j = parseJson(res.text);
        costUSD += costOf(res.usage);
        cache[hash] = { enrichment: j, at: new Date().toISOString() };
        enriched += 1;
        console.log(`  ✓ enrich ${d.path}: "${j.title}" q=${j.questions?.length ?? 0} kw=${j.keywords?.length ?? 0}`);
      } catch (e) {
        errors += 1;
        console.error(`  ✗ enrich ${d.path}: ${e.message}`);
        out.push(d); // keep the page as scraped — a failed enrichment must not drop content
        continue;
      }
    }

    const header = buildHeader(j, d.title);
    const replaceTitle = isReplaceableTitle(d.title) && j.title;
    const newTitle = replaceTitle ? j.title : d.title;
    if (replaceTitle && j.title !== d.title) titlesChanged += 1;
    const fm2 = frontmatter.replace(/^title: .*$/m, `title: ${JSON.stringify(newTitle)}`);
    out.push({ path: d.path, title: newTitle, text: fm2 + header + body });
  }

  saveCache(cache);

  const attempted = enriched + errors;
  // Denominator is the whole page set, not just the pages attempted this run: on a
  // mostly-cached re-run a single persistently-failing page would otherwise be 100%
  // of "attempted" and crash a flow that is supposed to be safe to re-run forever.
  const errorRate = docs.length ? errors / docs.length : 0;
  const summary = { pages: docs.length, cached, enriched, errors, errorRate: Number(errorRate.toFixed(3)), costUSD: Number(costUSD.toFixed(5)), titlesChanged, source };
  console.log(`enrich: ${enriched} enriched, ${cached} cached, ${errors} errors, ${titlesChanged} titles replaced, $${costUSD.toFixed(4)} spent`);
  if (errorRate > MAX_ERROR_RATE) {
    throw new Error(`enrich: ${errors}/${docs.length} pages failed (${(errorRate * 100).toFixed(0)}% > ${MAX_ERROR_RATE * 100}% budget)`);
  }
  return { docs: out, summary };
}
