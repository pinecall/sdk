# Maravilla Cleaners — the front desk, on the web

The [Maravilla Cleaners demo agent](../README.md) as a site:
**https://maravilla.bernardocastro.dev**. A visitor talks to it over WebRTC or
types at it, and a live panel below shows every call the agent is handling —
including the ones that never touch this browser.

It is the same shape as [`dental-desk-sse`](https://github.com/pinecall/dental-desk-sse):
one Express + React Router 7 process, one `.env`, the agent living inside it.
Organised by what it does, not by what it is:

```
server.js              the process entry — Vite in dev, the build in prod. Nothing else.
server/app.ts          Express + the React Router handler + startAgent()
server/agent/          pc.agent() with the six tools and the prompt
app/routes.ts          the whole surface, URL → file
app/calls/             page (Talk · type · Watch · History) · events (SSE) · token · chat-token · api
app/settings/          model · page (the form) · api
app/bookings/          the demo CRM as a model — quotes, crews, availability, bookings
app/lib/               db (a JSON file) · bus (in-process events) · the agent slug
infra/                 the two nginx server blocks (container + relay)
```

The API is React Router resource routes — a file with a `loader`/`action` and no
component — so there is no second router to learn.

## The page

**Talk** is our own button over `VoiceSession` from `@pinecall/web/core` (no
widget): press it, allow the mic, and the transcript grows word by word with the
agent's tool calls inline — `⚙ getQuote {service:deep,…} → {priceRangeUsd:[266,325],…}`,
so you can see it looked the price up instead of inventing it.

**…or type** is `ChatSession` from `@pinecall/web/chat` against the same agent:
same prompt, same tools, same knowledge base, no microphone.

**Watch · live** is fed by `/api/events`, Server-Sent Events off the in-process
bus — `call.started`, `turn`, `user.speaking`, `bot.word`, `transcript`,
`call.ended`. A phone call never touches this browser, so this is the only way
to see one. Lines are applied once per `(call, who, text, at)`: the same event
can reach the bus twice on a WebRTC call, and a bubble drawn twice is a lie.

**Settings** edits name, greeting, voice, language, hours, services and notes.
It saves → `bus.emit("settings")` → `agent.update()`, so the next call is born
with it and nothing restarts. The model, the STT provider and the six tools are
in `server/agent/` — settings are data, behaviour is code.

## What it knows

- **The company**: knowledge base `MARAVILLA_KB_ID`, tapped from the real
  maravillacleaners.com (see `../scripts/tap.mjs` and `../scripts/scrape.mjs`).
  Grounded only — if it is not in there, the agent says it is not sure.
- **Prices, crews, availability, bookings**: the fictional demo CRM in
  `../crm/`, shared with the CLI example. `app/bookings/model.server.ts` is the
  app's door to it: same functions, plus a booking written to `db.json` and
  mirrored on the bus.

## Run it

```bash
cp .env.example .env      # your key; AGENT_SLUG=dev-maravilla locally
npm install
npm run dev               # http://localhost:3000
```

`AGENT_SLUG` is the one thing to get right: **`maravilla` is production**.
Two processes on one slug fight over it, so a laptop uses `dev-maravilla`.
`PHONE` is optional — there is no number assigned to this demo today; set it
and the same agent answers that number too.

## Deploy

```bash
./deploy.sh               # shipway deploy → smoke.mjs → the pm2 error log
```

Never bare `shipway deploy`: `smoke.mjs` runs eleven assertions against
production — DNS, TLS, the http→https redirect, `/` renders, both tokens mint,
`/api/calls`, `/api/events` actually streams (a buffering proxy is caught
here), the agent answers a chat message, it calls a tool, and it is registered
and active on voice.pinecall.io.

Where things live, once:

| what | where |
|---|---|
| process | pm2 `maravilla` on the `bernardocastro` container, port **2141**, `~/maravilla` |
| env | `~/maravilla/.env` on the box (`PINECALL_API_KEY`, `MARAVILLA_KB_ID`, `AGENT_SLUG=maravilla`, `PORT=2141`, `NODE_ENV=production`) — written once over ssh, excluded from the sync, never in git |
| container nginx | `/etc/nginx/sites-available/maravilla` ← `infra/nginx-container.conf` (listen 80, no TLS) |
| relay nginx | on 34.71.115.185, `/etc/nginx/sites-available/maravilla` ← `infra/nginx-relay.conf` (TLS → `http://10.8.0.2:8082`) |
| certificate | the shared `bernardocastro.dev` cert, **expanded** with the new SAN: `sudo certbot certonly --nginx --expand --cert-name bernardocastro.dev -d <every existing SAN> -d maravilla.bernardocastro.dev` |
| DNS | Route 53 zone `Z0682586XN1GGQS83986`, A `maravilla.bernardocastro.dev` → `34.71.115.185`, TTL 300 |

Two layers of nginx means any forwarded header is overwritten by the second
one — the container block respects the relay's `X-Forwarded-Proto` instead of
passing its own `$scheme`, and both turn `proxy_buffering` off so the SSE
stream is not held.

MIT
