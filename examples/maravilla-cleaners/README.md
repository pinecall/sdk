# Maravilla Cleaners — demo agent

A front-desk voice/chat agent for Maravilla Cleaners, a real cleaning-services
company (residential, commercial and specialty work). Built to show four
pieces of the SDK working together end to end: **tap** (site → knowledge
base), **knowledge bases** (grounded answers), **tools** (a demo CRM), and
the **run console** (`pinecall run`).

## What's real, what's fictional

| | source |
|---|---|
| What Maravilla Cleaners does, its services, industries, article library | **real** — [maravillacleaners.com](https://maravillacleaners.com/), tapped into the knowledge base (see below) |
| Prices, crews, availability, customers, bookings | **fictional demo data** — `crm/data.json`, invented for this example |

The agent is instructed to answer company questions only from the knowledge
base and to say "I'm not sure" rather than guess — try asking it something
the site doesn't cover.

## Why `npm run tap` doesn't do a plain tap

`maravillacleaners.com` is a pure client-rendered SPA (React/Vite bundle) —
every page's HTML body is a bare `<div id="root"></div>`; the content is
drawn in by JavaScript after load. `@pinecall/sdk/tap` has no headless
browser, by design (see `docs/guides/tap.md`), so `planTap` on this site
comes back with `needsJs: true` and **0 words** on every one of its 59 pages.

The site itself anticipates this: its `robots.txt` points AI crawlers at
`/llms.txt` — "Reading guide for language models" — and that file is
static, plain-text markdown covering the company, its services (54 pages),
industries (13 pages) and article library. Its own "Using this content"
section explicitly allows crawling, indexing and quoting it, including for
AI grounding. `scripts/tap.mjs` tries `planTap`/`tap`/`syncTap` first (so a
future SSR version of the site would just work); when that comes back empty
it fetches `/llms.txt`, splits it by its `##` sections into a handful of
markdown documents, and pushes them into the knowledge base with the SDK's
`pushDocs` — upsert by path, so re-running the script is idempotent exactly
like `syncTap` would be.

## Setup

```bash
cp .env.example .env
# edit .env: PINECALL_API_KEY=pk_...
npm install
npm run tap   # creates the KB on first run, prints MARAVILLA_KB_ID — add it to .env
npm start     # pinecall run agent.mjs
```

## Commands

| command | what it does |
|---|---|
| `npm run tap` | (re)index the site into the demo knowledge base — idempotent |
| `npm run scrape` | Playwright-render every page and index the real content too — idempotent |
| `npm start` | `pinecall run agent.mjs` — boots `dev-maravilla`, prints the web console URL (`http://127.0.0.1:4747`) |
| `npm run converse` | talk to the running agent through six scripted real-message cases, pass/fail per case |

## The web version

`web/` is the same agent as a site — **https://maravilla.bernardocastro.dev** —
built like [`dental-desk-sse`](https://github.com/pinecall/dental-desk-sse):
one Express + React Router 7 process with the agent inside it, a page where a
visitor talks by WebRTC or types, and a live panel that watches every call over
SSE. It shares this example's knowledge base and its `crm/`. See `web/README.md`.

With the agent running, `pinecall run agent.mjs --call +1…` rings your phone,
and `c` in the terminal opens a one-line chat prompt.

### Tap numbers (this run)

```
discovered via sitemap: 59/60 pages included (1 excluded, 59 thin, 59 needsJs), ~0 tokens
every page needs JS to render (0 tokens extracted) — falling back to https://maravillacleaners.com/llms.txt
llms.txt: 24443 chars → 9 docs (overview.md, start-here.md, read-these-first-the-4-most-comprehensive-pieces.md,
  perspectives-all-41-published-articles-newest-first.md, service-pages-54.md, industry-pages-13.md,
  full-url-inventory.md, using-this-content.md, contact.md)
  ✓ overview.md  ✓ start-here.md  ✓ read-these-first-the-4-most-comprehensive-pieces.md
  ✓ perspectives-all-41-published-articles-newest-first.md  ✓ service-pages-54.md  ✓ industry-pages-13.md
  ✓ full-url-inventory.md  ✓ using-this-content.md  ✓ contact.md
```

Knowledge base: `maravilla-cleaners-demo`, id `6a88ce38093d0c0b471822b4` — re-running `npm run tap`
with `MARAVILLA_KB_ID` set re-pushes the same 9 paths (confirmed: doc count stayed at 9 after a
second run — `pushDocs` upserts by path).

## Full-site scrape (`npm run scrape`)

`llms.txt` is a hand-curated 9-document summary the site owner publishes for crawlers — useful,
but not the actual pages: it doesn't have the per-service or per-industry detail (what
`biohazard-remediation` covers, whether `gsa-schedule` federal work is offered, what
`industries/healthcare` says). `scripts/scrape.mjs` renders every page for real with
[Playwright](https://playwright.dev/) — this site is a client-rendered SPA (`<div id="root">`),
so a plain `fetch` sees nothing — extracts the main content with the same Defuddle+linkedom
pipeline `@pinecall/sdk/tap` uses internally, and pushes it into the *same* knowledge base the
`llms.txt` docs live in, one doc per page (`path` = the URL path, e.g.
`/solutions/deep-cleaning` → `solutions/deep-cleaning.md`), plus one `_site.md` for the
handful of lines repeated on more than half the pages (nav, footer, contact info — useful, but
only needed once). Idempotent: `pushDocs` upserts by path, so a second run updates the same
84 docs instead of duplicating them.

Crawl is polite by design: one page at a time, 300 ms between pages, same-origin only, capped
at 80 pages; URLs come from `sitemap.xml` (a `sitemapindex` here, followed one level).

```bash
npm run scrape
```

### Scrape numbers (this run)

```
discovered 80 same-origin URLs (sitemap, capped at 80)
... (per-page ✓/⋯/✗ lines omitted here — see the terminal for the full crawl log)
boilerplate: 5 lines seen on > 50% of pages, kept once in _site.md
enriching 76 docs ...
... (per-page enrich ✓/✗ lines omitted — see "Enrich numbers" below)
pushing 76 docs to 6a88ce38093d0c0b471822b4 ...

=== scrape totals ===
pages rendered:  80
pages kept:      75          (5 dropped: < 40 words after extraction — thin/empty shells)
words:           16664
tokens (~):      32792
docs pushed:     76/76        (75 pages + _site.md)
enrich:          71 enriched, 3 cached, 2 errors, 73 titles replaced, $0.00455
```

The knowledge base now holds **84 documents** total: the 9 `llms.txt` docs plus the 76 scraped
ones, minus one path collision (`contact.md` — both the `llms.txt` split and the rendered
`/contact` page land on that path; the rendered page's fuller content won on the upsert, which
is the intended behavior for a path that both routes produce). The other 8 `llms.txt` docs are
untouched.

## LLM enrichment (`scripts/enrich.mjs`)

All 76 scraped pages carry the SPA's one static `<title>` —
`Maravilla — Marvelously Clean.` — so BM25 (the hybrid retriever's keyword lane) never sees
the words a caller actually says for a specific page; every doc's title token is identical.
This is exactly option D of
[`docs/notes/tap-llm-quality-research.md`](../../docs/notes/tap-llm-quality-research.md)
(§3 D, §6–§7): one call per page to Pinecall's own LLM gateway
(`POST /api/llm/chat`, no `model` field → the gateway's cheap default,
`openrouter/qwen/qwen3-30b-a3b-instruct-2507`) asking for a descriptive title, a breadcrumb,
a one-sentence summary, 3–5 questions the page answers, and 5–12 keywords — inserted as a
`## What this page answers` header right under the frontmatter. The body is never touched.

**Title rule (the measured trap, §6.2).** The cheap model rewrites *every* title it's asked
for, and on a site whose titles were already good that cost 0.13 MRR in the research
(basecamp). So `scripts/enrich.mjs` only replaces the doc's `title` frontmatter when the
original is empty, a bare date, or the SPA's static site name — otherwise the original title
is kept and the generated one lives in the header only. Here all 75 SPA-titled pages qualify
for substitution (they're all the same site name); `_site.md`, which already has a real title,
does not.

**Cache.** Enrichments are cached in `.enrich-cache.json` (gitignored) keyed by the sha256 of
the page *body* — not the whole doc text, since the frontmatter's `scraped_at` changes on
every run and would defeat a whole-text hash. An unchanged page costs zero LLM calls on the
next `npm run scrape`; `--no-enrich` skips the lane entirely for a cheap re-push.

**Errors.** A truncated or malformed reply (not valid JSON — seen twice below, both from
the model running past `max_tokens: 400` on longer policy pages) aborts that one page (kept
as scraped, un-enriched) and the run keeps going; a genuinely empty stream (no token, no
usage, no error — the outage mode seen 2026-08-21 in the research) is retried up to 3 times
and treated as a failure, never as success. The run exits non-zero if more than 10% of
attempted pages fail.

```bash
npm run scrape             # render → extract → enrich → push, one flow
npm run scrape -- --no-enrich   # skip the LLM lane (cheap re-push after e.g. a copy fix)
```

### Enrich numbers (first run, cold cache)

```
✗ enrich social-media-moderation-policy.md: not JSON: {"title": ... (truncated at max_tokens)
✗ enrich solutions/gsa-schedule.md: not JSON: {"title": ... (truncated at max_tokens)
enrich: 71 enriched, 3 cached, 2 errors, 73 titles replaced, $0.0045 spent
```

2/76 pages failed (2.6%, under the 10% budget) — both kept their original scraped title/body,
no LLM header. 3 pages hit an identical cached hash within the same run (pages whose
extracted body is byte-identical, e.g. near-duplicate stub pages) and cost zero calls.

**Idempotence check.** Re-running `npm run scrape` twice more with a warm cache surfaced a
real bug and fixed it: the failure budget was originally `errors / attempted-this-run`, so
on a fully-cached re-run a single persistently-failing page (`social-media-moderation-policy.md`,
its generated JSON kept running past `max_tokens: 400` on both attempts) was 1/2 = 50% and
aborted the whole flow *before the push* — a page that fails once would break every future
`npm run scrape` forever. Fixed two ways: `max_tokens` 400 → 700 (this alone fixed
`solutions/gsa-schedule.md`, which only needed the extra room), and the denominator changed
to the whole page set (`errors / docs.length`), so one stubborn page reads as 1.3% and the
run finishes and pushes. Third run: `0 enriched, 75 cached, 1 errors, $0` — confirms the
cache makes a re-run free, and the retrieval numbers above (measured against this same live
KB) are unaffected — `social-media-moderation-policy.md` isn't one of the 12 fixture
questions.

## Retrieval — before vs after enrichment

`scripts/rag-check.mjs` runs 12 realistic caller questions (`scripts/rag-check.fixture.json`)
through `queryKnowledge` (top 10) and checks the rank of the doc path that should answer each
one — a mix of service pages, industry pages, contact/location, and two questions only the
`llms.txt` docs answer (a manifest-style listing, not a page a caller would naturally reach).

| # | question | expected doc | rank before | rank after |
|---|---|---|---|---|
| 1 | Do you do mold fogging? | `solutions/mold-fogging.md` | 1 | 1 |
| 2 | Can you clean a hospital or medical office? | `industries/healthcare.md` | 1 | 1 |
| 3 | Do you offer pressure washing for a building exterior? | `solutions/pressure-washing.md` | 1 | 1 |
| 4 | What's your phone number? | `contact.md` | 2 | 1 |
| 5 | Where is Maravilla headquartered? | `contact.md` | >10 | 2 |
| 6 | Do you clean schools or university campuses? | `industries/education.md` | 1 | 1 |
| 7 | Do you handle biohazard cleanup? | `solutions/biohazard-remediation.md` | 1 | 1 |
| 8 | Can you do a move-out cleaning before I hand back the keys? | `solutions/move-in-out.md` | 1 | 1 |
| 9 | Do you do Airbnb turnover cleaning between guests? | `solutions/airbnb-turnover.md` | 1 | 1 |
| 10 | What's the complete list of every service page on your site? | `service-pages-54.md` | 1 | 1 |
| 11 | What are the most comprehensive guides on your site about compliance and government contracts? | `read-these-first-the-4-most-comprehensive-pieces.md` | 1 | 1 |
| 12 | Can I read customer reviews of Maravilla? | `reviews.md` | 1 | 1 |

| | hits@5 | MRR |
|---|---|---|
| before | 11/12 | 0.883 |
| after | 12/12 | 0.958 |

**No regression.** Every question that already ranked 1 stayed at rank 1 — none of the two
llms.txt-only questions were pushed down by the newly-enriched scraped pages (unlike the
basecamp case in the research, where the cheap model's title rewrite outranked the correct
page). Two questions improved: "What's your phone number?" moved rank 2 → 1, and "Where is
Maravilla headquartered?" moved from outside the top 10 to rank 2 (still short of hits@5's
top-5, but now findable at all) — `contact.md`'s generated header adds "headquartered" and
"Miami-Dade (HQ)" as keywords/breadcrumb next to the phone/email block the raw page never
phrases that way. Raw numbers: `rag-check.before.json`, `rag-check.after.json` (both
committed, per-question ranks and the exact top hit for every miss).

The 8 remaining `llms.txt` docs (excluding `contact.md`, which the scrape overwrote) were
**not** enriched: all their questions already ranked 1 in the baseline — no retrieval headroom
to gain, and the instructions for this lane are to never touch their curated titles or bodies.

## The six tools (`tools.mjs` → `crm/index.mjs`)

All demo data, in-memory: `crm/data.json` is the seed (fictional prices, three
crews, two sample customers, one past booking); every booking a call makes
lives only for the current `pinecall run` process and resets when it restarts.

- `lookupCustomer({ phone, email })` — existing customer + past bookings
- `getQuote({ service, bedrooms, bathrooms, sqft?, frequency? })` — price range + duration
- `checkAvailability({ date, area|zip, service })` — open slots + the crew that'd take it
- `bookCleaning({ customer, service, date, slot, address, notes? })` — confirmation id
- `listCrews()` — the crew roster (areas, languages, skills, rating)
- `escalateToHuman({ reason })` — records a callback request

## Self-check — real messages, not `pinecall test`

Verified by talking to the running `dev-maravilla` agent, both through the
Pinecall MCP `chat` tool and the replayable `scripts/converse.mjs` (same
`llm.chat` WebSocket protocol `pinecall chat` uses). `npm run converse` runs
all six and prints pass/fail; last run: **6/6 passed**.

### 1. Service question — answered from the tapped KB

```
you › Hi, what kind of cleaning services does Maravilla offer?
bot › Hi! Maravilla Cleaners offers a wide range of cleaning services across residential,
      commercial, and specialty work. These include cleaning for offices, healthcare
      facilities, data centers, hotels, construction handover sites, industrial and retail
      sites, and homes.
      We also provide specialty services like deep cleaning, move-in/out cleaning,
      antimicrobial shielding, biohazard remediation, carpet upholstery, disaster recovery,
      and many more.
```
✓ PASS — matches the "Service pages" and "Start here" sections of the tapped KB.

### 2. Areas served — answered from the tapped KB

```
you › Good to know. What areas or locations do you serve?
bot › I don't have the specific list of cities and states served right here, but Maravilla
      Cleaners covers multiple locations. For detailed info on the exact areas or cities we
      serve, you can check our Locations page on the website.
```
✓ PASS — the KB doesn't list specific cities (llms.txt only links to `/locations`), and the
agent says so instead of inventing a list — exactly the "don't guess" instruction working.

### 3. Quote for a 3-bed/2-bath deep clean — `getQuote`

```
you › Hi, can I get a quote for a deep clean? It's a 3 bedroom, 2 bathroom house.
bot › For a deep clean of your 3-bedroom, 2-bathroom house, the estimated price range is
      $266 to $325. The cleaning would take about 3 to 4 hours. This is a one-time service
      estimate. Would you like to check available dates to book?
  ⚡ getQuote({"service":"deep","bedrooms":3,"bathrooms":2})
```
✓ PASS — correct tool + args; price matches `crm/data.json` (`160 + 25×3 + 30×2 = 295`, ±10%).

### 4. Availability on a date — `checkAvailability`

```
you › Yes, what's available on 2026-09-01? I'm in the downtown area.
bot › On September 1, 2026, in downtown, Team Aurora is available for a deep cleaning with
      slots at 09:00, 11:00, 13:00, and 15:00. They have a 4.9 rating and speak English and
      Spanish. Which time would you prefer?
  ⚡ checkAvailability({"date":"2026-09-01","area":"downtown","service":"deep"})
```
✓ PASS — correct tool + args; matches Team Aurora's seeded profile.

### 5. Full booking flow — `bookCleaning` + confirmation id

```
you › Let's do 11:00. My name is Carla Mendez, phone +13055559999, address 100 Brickell Ave, Miami, FL.
bot › Just to confirm: you want to book a deep cleaning for a 3-bedroom, 2-bathroom house on
      2026-09-01 at 11:00, downtown area, with Team Aurora... Is that all correct?
you › Yes, that's all correct, please book it.
bot › You're all set! Your deep cleaning with Team Aurora is booked for 2026-09-01 at 11:00
      at 100 Brickell Ave, Miami, FL. Your confirmation ID is BK-1002.
  ⚡ bookCleaning({"customer":"Carla Mendez, +13055559999","service":"deep","date":"2026-09-01","slot":"11:00","address":"100 Brickell Ave, Miami, FL"})
```
✓ PASS — confirms before booking, calls `bookCleaning`, returns a real confirmation id.

### 6. Off-topic complaint — `escalateToHuman`

```
you › Actually, I want to file a complaint — my last cleaner broke a vase and nobody has
      called me back about it. Can I talk to a manager?
bot › I'm sorry to hear about the broken vase and that you haven't been contacted yet. I've
      flagged this so a manager can call you back to address your complaint directly.
  ⚡ escalateToHuman({"reason":"Customer complaint about broken vase and no callback; requests to talk to a manager."})
```
✓ PASS — recognizes it's outside booking/pricing and escalates instead of guessing.

### Retrieval probes — questions `llms.txt` alone couldn't answer

Direct `knowledge query` calls (`node ../../dist/cli.js knowledge query <kb> "<q>"`), against
content only the Playwright scrape put in the KB — no per-service or per-industry detail page
exists in the 9 `llms.txt` docs:

1. **"What does Maravilla's biohazard remediation service cover?"** — top hit (score 1.416):
   `solutions/biohazard-remediation.md`, the rendered `/solutions/biohazard-remediation` page.
2. **"What cleaning services does Maravilla offer for healthcare facilities?"** — top hit
   (score 1.359): `industries/healthcare.md`, the rendered `/industries/healthcare` page.
3. **"Does Maravilla work under a GSA schedule for federal facilities?"** — top hit
   (score 1.307): `solutions/gsa-schedule.md`, the rendered `/solutions/gsa-schedule` page.

## What this example teaches

- **`@pinecall/sdk/tap`** — `planTap`/`tap`/`syncTap`, the `needsJs` flag, and what to do when
  a site has nothing tap can read (fall back to its own `/llms.txt`, pushed with `pushDocs`).
- **`scripts/scrape.mjs`** — when `needsJs` is true for real (a client-rendered SPA), the fix
  is a headless browser: Playwright renders the page, the same extract-and-`pushDocs` pipeline
  takes it from there. See "Full-site scrape" above.
- **Knowledge bases** — `knowledgeBase: <id>`, `{{RAG_CONTEXT}}`, grounding an agent to say
  "I don't know" instead of inventing an answer.
- **Tools** — `tool()` + Zod schemas over a local, dependency-free demo CRM; a realistic
  quote → availability → booking flow.
- **The run console** — `pinecall run agent.mjs`, the web console at `:4747`, `--call`, `c` chat.
