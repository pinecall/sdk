/**
 * maravilla.bernardocastro.dev — the deploy that cannot lie.
 *
 * Eleven assertions against PRODUCTION, run by deploy.sh right after shipway.
 * They check the whole chain, not the process: DNS → the relay's TLS → the
 * container's nginx → pm2 → the agent on voice.pinecall.io. A green shipway
 * with a red smoke means the site is down; say so instead of reporting a
 * successful deploy.
 *
 * Usage: node smoke.mjs [https://maravilla.bernardocastro.dev]
 *   PINECALL_API_KEY (from .env) is used for the "agent is online" assertion.
 */

import { readFileSync } from "node:fs";
import { resolve4 } from "node:dns/promises";
import WebSocket from "ws";

const SITE = (process.argv[2] ?? "https://maravilla.bernardocastro.dev").replace(/\/$/, "");
const HOST = new URL(SITE).hostname;
const RELAY = "34.71.115.185";
// The slug is not guessed and not read from a local .env: it is whatever the
// SITE seals into the tokens it mints, decoded below.
let AGENT = "?";
const KEY = process.env.PINECALL_API_KEY ?? env("PINECALL_API_KEY");

function env(name) {
  try {
    const line = readFileSync(new URL("./.env", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

let failed = 0;
async function check(what, run) {
  try {
    const detail = await run();
    console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${what} — ${err.message}`);
  }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log(`\n  smoke · ${SITE}\n`);

await check("DNS points at the relay", async () => {
  const ips = await resolve4(HOST);
  must(ips.includes(RELAY), `A record is ${ips.join(", ")}, expected ${RELAY}`);
  return ips.join(", ");
});

await check("TLS is valid for this name", async () => {
  const res = await fetch(SITE, { redirect: "manual" });   // no -k: a bad cert throws
  must(res.status < 500, `status ${res.status}`);
  return `HTTP ${res.status}`;
});

await check("http:// redirects to https://", async () => {
  const res = await fetch(`http://${HOST}/`, { redirect: "manual" });
  must(res.status === 301, `status ${res.status}`);
  must(res.headers.get("location")?.startsWith("https://"), `location ${res.headers.get("location")}`);
  return res.headers.get("location");
});

await check("/ renders the front desk", async () => {
  const html = await fetch(SITE).then((r) => r.text());
  must(html.includes("Maravilla Cleaners"), "the page does not name Maravilla Cleaners");
  must(html.includes("Watch"), "no Watch panel in the markup");
  return `${html.length} bytes`;
});

await check("POST /api/token mints a WebRTC token", async () => {
  const t = await fetch(`${SITE}/api/token`, { method: "POST" }).then((r) => r.json());
  must(String(t.token ?? "").startsWith("wrt_"), `got ${JSON.stringify(t).slice(0, 80)}`);
  return t.server ?? "";
});

let chatToken, chatServer;
await check("POST /api/chat-token mints a chat token", async () => {
  const t = await fetch(`${SITE}/api/chat-token`, { method: "POST" }).then((r) => r.json());
  must(String(t.token ?? "").startsWith("cht_"), `got ${JSON.stringify(t).slice(0, 80)}`);
  chatToken = t.token;
  chatServer = t.server ?? "https://voice.pinecall.io";
  AGENT = JSON.parse(Buffer.from(chatToken.split("_")[1].split(".")[0], "base64url")).agent;
  return `${chatServer} · agent ${AGENT}`;
});

await check("GET /api/calls answers the snapshot", async () => {
  const body = await fetch(`${SITE}/api/calls`).then((r) => r.json());
  must(Array.isArray(body.calls), `got ${JSON.stringify(body).slice(0, 80)}`);
  return `${body.calls.length} calls`;
});

await check("GET /api/events streams (nothing buffers it)", async () => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${SITE}/api/events`, { signal: ac.signal });
    must(res.headers.get("content-type")?.includes("text/event-stream"), `content-type ${res.headers.get("content-type")}`);
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const first = new TextDecoder().decode(value);
    must(first.includes("event: hello"), `first frame was ${JSON.stringify(first.slice(0, 60))}`);
    reader.cancel();
    return "hello frame arrived";
  } finally {
    clearTimeout(timer);
  }
});

await check("the agent answers a chat message", async () => {
  const reply = await chat(chatServer, chatToken, "What services do you offer?");
  must(reply.length > 20, `reply was ${JSON.stringify(reply)}`);
  return `"${reply.slice(0, 60)}…"`;
});

await check("the agent uses its tools", async () => {
  const { text, tools } = await chatTools(chatServer, chatToken, "How much for a deep clean of a 3 bedroom, 2 bathroom house?");
  must(tools.includes("getQuote"), `tools called: ${tools.join(", ") || "none"} · reply "${text.slice(0, 60)}"`);
  return tools.join(", ");
});

await check("the agent is registered and active", async () => {
  must(KEY, "no PINECALL_API_KEY to ask with");
  const res = await fetch("https://voice.pinecall.io/api/sdk/agents", { headers: { Authorization: `Bearer ${KEY}` } });
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.agents ?? []);
  const row = list.find((a) => (a.agent_id ?? a.id ?? a.slug) === AGENT);
  must(row, `"${AGENT}" is not in the list of ${list.length} agents`);
  must(row.active, `registered but not active: ${JSON.stringify(row).slice(0, 120)}`);
  must(row.channels?.webrtc, "no webrtc channel — the browser could not call it");
  return `${AGENT} · ${Object.keys(row.channels).join(", ")}`;
});

// ── the chat client: the same wire the browser's ChatSession speaks ────
function open(server, token) {
  const url = server.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + `/chat/ws?token=${token}`;
  const ws = new WebSocket(url);
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("chat connect timeout")), 15000);
    ws.on("message", (raw) => {
      const d = JSON.parse(raw.toString());
      if (d.event === "chat.connected") (clearTimeout(t), ok(ws));
      if (d.event === "error") (clearTimeout(t), no(new Error(d.error ?? "chat error")));
    });
    ws.on("error", (e) => (clearTimeout(t), no(e)));
  });
}

async function chat(server, token, text) {
  return (await chatTools(server, token, text)).text;
}

async function chatTools(server, token, text) {
  const ws = await open(server, token);
  const tools = [];
  try {
    return await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error("no reply in 45s")), 45000);
      ws.on("message", (raw) => {
        const d = JSON.parse(raw.toString());
        if (d.event?.endsWith("chat.tool_call")) for (const c of d.tool_calls ?? []) tools.push(c.name);
        if (d.event?.endsWith("chat.done")) (clearTimeout(t), ok({ text: d.text ?? "", tools }));
        if (d.event?.endsWith("chat.error")) (clearTimeout(t), no(new Error(d.error ?? "chat error")));
      });
      ws.send(JSON.stringify({ event: "message", text }));
    });
  } finally {
    ws.close();
  }
}

console.log(failed === 0 ? "\n  all green\n" : `\n  ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
