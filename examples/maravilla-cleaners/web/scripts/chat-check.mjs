/**
 * chat-check — talk to the site's chat the way the page does, and prove it is
 * ONE conversation.
 *
 * It mints a token through the site's own /api/chat-token, opens ONE
 * ChatSession (the same class the browser loads) with a thread id, and sends
 * three chained messages. The third only works if the agent still remembers
 * the second — so the transcript is the test.
 *
 *   node scripts/chat-check.mjs [origin]
 *
 * Default origin: https://maravilla.bernardocastro.dev
 */
import { ChatSession } from "@pinecall/web/chat";

const ORIGIN = process.argv[2] ?? "https://maravilla.bernardocastro.dev";
const THREAD = `check-${Date.now().toString(36)}`;

const TURNS = [
  "what do you clean?",
  "how much for a 3-bedroom 2-bathroom deep clean?",
  "book it for Friday 10:00 under Bernardo",
];

const token = await fetch(`${ORIGIN}/api/chat-token`, { method: "POST" }).then((r) => r.json());

const session = new ChatSession({
  agent: token.agentId ?? "maravilla",
  thread: THREAD,
  tokenProvider: async () => token,
});

const seen = new Set();
const sessionIds = new Set();

session.addEventListener("event", (e) => {
  const d = e.detail;
  if (d.session_id) sessionIds.add(d.session_id);
  if (d.event === "chat.tool_call" || d.event === "llm.chat.tool_call")
    for (const t of d.tool_calls ?? []) console.log(`   ⚙ ${t.name}`);
});

const settled = () =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 90_000);
    const off = session.subscribe(() => {
      const s = session.getState();
      if (s.status === "error") { clearTimeout(t); off(); reject(new Error(s.error ?? "error")); }
      if (!s.typing && !s.messages.some((m) => m.isStreaming)) { clearTimeout(t); off(); resolve(s); }
    });
  });

const connected = new Promise((resolve) => {
  const off = session.subscribe(() => {
    if (session.getState().status === "connected") { off(); resolve(); }
  });
});

await session.connect();
await connected;
console.log(`thread   ${THREAD}`);
console.log(`session  ${session.getState().sessionId}\n`);

for (const text of TURNS) {
  console.log(`› ${text}`);
  session.send(text);      // flips `typing` synchronously…
  await settled();         // …so the wait below cannot resolve on the way in
  for (const m of session.getState().messages) {
    if (m.role !== "bot" || seen.has(m.id)) continue;
    seen.add(m.id);
    console.log(`‹ ${m.text.replace(/\n/g, "\n  ")}\n`);
  }
}

console.log(`session ids seen: ${[...sessionIds].join(", ") || "(none)"}`);
console.log([...sessionIds].length === 1 ? "✓ ONE session for all three turns" : "✗ more than one session");
session.destroy();
process.exit([...sessionIds].length === 1 ? 0 : 1);
