/**
 * Maravilla Cleaners — replayable self-check by REAL messages, not `pinecall test`.
 *
 * Talks to a running `dev-maravilla` (npm start in another terminal) over the
 * same `llm.chat` WebSocket protocol the CLI's `pinecall chat` REPL and the
 * MCP `chat` tool use (src/api/chat-client.ts is internal to the CLI, so this
 * is a small, self-contained client speaking the same wire protocol).
 *
 * Six scripted cases, chained in one conversation exactly like a real caller:
 *   1. a service question, answered from the tapped KB
 *   2. areas served, answered from the tapped KB
 *   3. a quote for a 3-bed/2-bath deep clean (getQuote)
 *   4. availability on a date (checkAvailability)
 *   5. the full booking flow (bookCleaning + a confirmation id)
 *   6. an off-topic complaint (escalateToHuman)
 *
 * Usage: npm run converse   (agent must already be running — npm start)
 */

import "dotenv/config";
import WebSocket from "ws";

const SERVER = (process.env.PINECALL_SERVER ?? "https://voice.pinecall.io").replace(/^http/, "ws") + "/client";
const AGENT_ID = "dev-maravilla";
const apiKey = process.env.PINECALL_API_KEY;

if (!apiKey) {
  console.error("Set PINECALL_API_KEY (see .env.example).");
  process.exit(1);
}

// ── A minimal llm.chat client — same protocol as src/api/chat-client.ts ────

class MicroChatClient {
  #ws = null;
  #sessionId = null;

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(SERVER);
      this.#ws = ws;
      const timeout = setTimeout(() => reject(new Error("connect timeout")), 10000);
      ws.on("open", () => ws.send(JSON.stringify({ event: "connect", api_key: apiKey })));
      ws.on("message", (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.event === "connected") {
          clearTimeout(timeout);
          resolve();
        } else if (data.event === "error" && !this.#sessionId) {
          clearTimeout(timeout);
          reject(new Error(data.error || "connect failed"));
        } else if (data.event === "ping") {
          ws.send(JSON.stringify({ event: "pong" }));
        }
      });
      ws.on("error", reject);
    });
  }

  /** Send one message, wait for the full reply + any tool calls. */
  send(text, { timeoutMs = 30000 } = {}) {
    if (!this.#sessionId) this.#sessionId = "converse-" + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      let fullText = "";
      const toolCalls = [];
      const timer = setTimeout(() => {
        this.#ws.off("message", onMessage);
        reject(new Error(`response timeout (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      const onMessage = (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.event === "llm.chat.token") {
          fullText += data.token ?? "";
        } else if (data.event === "llm.chat.tool_call") {
          for (const tc of data.tool_calls ?? []) toolCalls.push({ name: tc.name, arguments: tc.arguments });
        } else if (data.event === "llm.chat.done") {
          clearTimeout(timer);
          this.#ws.off("message", onMessage);
          resolve({ text: data.text || fullText, toolCalls });
        } else if (data.event === "llm.chat.error") {
          clearTimeout(timer);
          this.#ws.off("message", onMessage);
          reject(new Error(data.error));
        } else if (data.event === "ping") {
          this.#ws.send(JSON.stringify({ event: "pong" }));
        }
      };
      this.#ws.on("message", onMessage);
      this.#ws.send(JSON.stringify({ event: "llm.chat", session_id: this.#sessionId, agent_id: AGENT_ID, text }));
    });
  }

  close() {
    this.#ws?.close();
  }
}

// ── The six cases, chained as one conversation ──────────────────────────────

const cases = [
  {
    name: "1. service question — answered from the tapped KB",
    message: "Hi, what kind of cleaning services does Maravilla offer?",
    check: (r) => /clean/i.test(r.text) && r.text.length > 40,
  },
  {
    name: "2. areas served — answered from the tapped KB",
    message: "What areas or locations do you serve?",
    check: (r) => /area|location|zip|serve/i.test(r.text),
  },
  {
    name: "3. quote for a 3-bed/2-bath deep clean — getQuote",
    message: "Can I get a quote for a deep clean? It's a 3 bedroom, 2 bathroom house.",
    check: (r) => r.toolCalls.some((t) => t.name === "getQuote" && /"service":"deep".*"bedrooms":3.*"bathrooms":2/.test(t.arguments)),
  },
  {
    name: "4. availability on a date — checkAvailability",
    message: "What's available on 2026-09-01? I'm in the downtown area.",
    check: (r) => r.toolCalls.some((t) => t.name === "checkAvailability" && t.arguments.includes("2026-09-01")),
  },
  {
    name: "5. full booking flow — bookCleaning + confirmation id",
    message: "Book it for 11:00. My name is Carla Mendez, phone +13055559999, address 100 Brickell Ave, Miami, FL. Yes, please confirm and book.",
    check: (r) => r.toolCalls.some((t) => t.name === "bookCleaning") && /BK-\d+/.test(r.text),
  },
  {
    name: "6. off-topic complaint — escalateToHuman",
    message: "Actually, I want to file a complaint — my last cleaner broke a vase and nobody called me back. Can I talk to a manager?",
    check: (r) => r.toolCalls.some((t) => t.name === "escalateToHuman"),
  },
];

const client = new MicroChatClient();
console.log(`connecting to ${AGENT_ID} on ${SERVER} …`);
try {
  await client.connect();
} catch (err) {
  console.error(`could not connect — is the agent running? (npm start)\n${err.message}`);
  process.exit(1);
}

let failed = 0;
for (const c of cases) {
  process.stdout.write(`\n${c.name}\n  you  › ${c.message}\n`);
  let result;
  try {
    result = await client.send(c.message);
  } catch (err) {
    console.log(`  ✗ FAIL — ${err.message}`);
    failed++;
    continue;
  }
  console.log(`  bot  › ${result.text}`);
  if (result.toolCalls.length) {
    for (const t of result.toolCalls) console.log(`  ⚡ ${t.name}(${t.arguments})`);
  }
  const ok = c.check(result);
  console.log(ok ? "  ✓ PASS" : "  ✗ FAIL");
  if (!ok) failed++;
}

client.close();
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed > 0 ? 1 : 0);
