import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRevalidator } from "react-router";
import type { ChatSession } from "@pinecall/web/chat";
import type { VoiceSession } from "@pinecall/web/core";
import type { Route } from "./+types/page";
import { Call, type CallRow, type Line } from "./model.server";
import { AGENT } from "~/lib/agent-id.server";
import { Settings } from "~/settings/model.server";
import { Markdown } from "./markdown";

export const loader = () => ({
  calls: Call.recent(),
  phone: process.env.PHONE ?? null,
  agent: AGENT,
  name: Settings.get().name,
});

export default function FrontDeskPage({ loaderData }: Route.ComponentProps) {
  // While the browser is on a call, the live panel below would show the same
  // call a second time (the server's view of it) — so it steps aside.
  const [browserLive, setBrowserLive] = useState(false);
  return (
    <div className="space-y-14">
      <Hero name={loaderData.name} phone={loaderData.phone} />
      <section className="grid gap-10 sm:grid-cols-2">
        <BrowserCall agent={loaderData.agent} onLive={setBrowserLive} />
        <BrowserChat agent={loaderData.agent} />
      </section>
      <AgentLive hideWebrtc={browserLive} />
      <History calls={loaderData.calls} />
    </div>
  );
}

// ── 1. What this is ───────────────────────────────────────────────────
function Hero({ name, phone }: { name: string; phone: string | null }) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl tracking-tight">{name}</h1>
      <p className="max-w-xl text-[15px] leading-relaxed text-neutral-500">
        The front desk, answering by voice and by text. Ask what the company cleans, get a
        price estimate, check a date and book it — the agent looks everything up in front of
        you.{" "}
        {phone ? (
          <>It also answers <a href={`tel:${phone}`} className="text-neutral-900 underline decoration-neutral-300 underline-offset-4 dark:text-white">{phone}</a>.</>
        ) : (
          <>No phone number wired yet (<code className="text-sm">PHONE</code> in the environment).</>
        )}
      </p>
    </section>
  );
}

// ── 2. Talk — our own button over VoiceSession ────────────────────────
// The transcript here comes straight from the DataChannel: the session keeps a
// `messages` array that mutates as the STT refines and as the bot's words play.
function BrowserCall({ agent, onLive }: { agent: string; onLive: (live: boolean) => void }) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    import("@pinecall/web/core").then(({ VoiceSession }) => {
      sessionRef.current = new VoiceSession({
        agent,
        tokenProvider: () => fetch("/api/token", { method: "POST" }).then((r) => r.json()),
      });
      setReady(true);
    });
    return () => sessionRef.current?.disconnect();
  }, [agent]);

  const state = useSyncExternalStore(
    (cb) => (ready && sessionRef.current ? sessionRef.current.subscribe(cb) : () => {}),
    () => (ready && sessionRef.current ? sessionRef.current.getState() : IDLE),
    () => IDLE,
  );

  const session = sessionRef.current;
  const live = state.status === "connected";
  useEffect(() => onLive(live), [live, onLive]);

  return (
    <section className="space-y-5">
      <SectionTitle>Talk</SectionTitle>
      <div className="flex flex-wrap items-center gap-4">
        <button
          disabled={!ready || state.status === "connecting"}
          onClick={() => (live ? session?.disconnect() : session?.connect())}
          className={`rounded-full px-6 py-3 text-sm transition disabled:opacity-50 ${
            live ? "bg-red-600 text-white hover:bg-red-500" : "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          }`}
        >
          {state.status === "connecting" ? "Connecting…" : live ? "Hang up" : "Call"}
        </button>
        {live && (
          <>
            <Phase phase={state.phase} />
            <span className="text-sm tabular-nums text-neutral-400">{fmt(state.duration)}</span>
            <button onClick={() => session?.toggleMute()} className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
              {state.isMuted ? "Unmute" : "Mute"}
            </button>
          </>
        )}
        {state.status === "error" && <span className="text-sm text-red-600">Could not connect.</span>}
      </div>
      {state.messages.length > 0 && (
        <ol className="space-y-3">
          {state.messages.map((m) =>
            // The session reports tool calls as system messages ("🔧 Using x…" → "✓ x").
            m.role === "system"
              ? <Bubble key={m.id} who="tool" text={m.text.replace(/^🔧 Using |^✓ /, "").replace(/…$/, "")} draft={m.text.startsWith("🔧")} />
              : <Bubble key={m.id} who={m.role === "user" ? "user" : "bot"} text={m.text} draft={m.isInterim || m.speaking} />,
          )}
        </ol>
      )}
    </section>
  );
}

const IDLE = { status: "idle", phase: "idle", messages: [], isMuted: false, duration: 0 } as unknown as ReturnType<VoiceSession["getState"]>;

// ── 3. …or type instead ───────────────────────────────────────────────
// The same agent, same tools, same knowledge base — over the chat channel.
//
// One conversation per visitor, and it survives everything. The socket is
// opened when the panel mounts (not on the first keystroke: `connect()`
// resolves as soon as the WebSocket exists, so a `send()` chained onto it lands
// on a CONNECTING socket and ChatSession drops it on the floor) and a `thread`
// id kept in localStorage means a refresh, a tab left in the background or a
// redeploy reconnects into the SAME conversation — the server replays the
// history into the model, so the agent still knows the quote it just gave.

const THREAD_KEY = "maravilla.chat.thread";

function threadId(): string {
  try {
    const kept = localStorage.getItem(THREAD_KEY);
    if (kept) return kept;
    const fresh = crypto.randomUUID();
    localStorage.setItem(THREAD_KEY, fresh);
    return fresh;
  } catch {
    // Private mode with storage blocked: one conversation for this page life.
    return crypto.randomUUID();
  }
}

/** Resolves when the server has answered `chat.connected` — not before. */
function whenConnected(session: ChatSession, ms = 15000) {
  if (session.getState().status === "connected") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => (off(), reject(new Error("chat did not connect"))), ms);
    off = session.subscribe(() => {
      const { status } = session.getState();
      if (status === "connected") (clearTimeout(timer), off(), resolve());
      if (status === "error") (clearTimeout(timer), off(), reject(new Error("chat error")));
    });
  });
}

function BrowserChat({ agent }: { agent: string }) {
  const sessionRef = useRef<ChatSession | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    import("@pinecall/web/chat").then(({ ChatSession }) => {
      if (!alive) return;
      const session = new ChatSession({
        agent,
        thread: threadId(),
        tokenProvider: () => fetch("/api/chat-token", { method: "POST" }).then((r) => r.json()),
      });
      sessionRef.current = session;
      setReady(true);
      void session.connect();
      // A conversation people read between messages outlives any idle timeout a
      // proxy might impose: a cleared context block is a no-op the socket feels.
      const beat = setInterval(() => session.setContext("keepalive", null), 25_000);
      cleanup = () => (clearInterval(beat), session.destroy());
    });
    return () => { alive = false; cleanup(); };
  }, [agent]);

  const state = useSyncExternalStore(
    (cb) => (ready && sessionRef.current ? sessionRef.current.subscribe(cb) : () => {}),
    () => (ready && sessionRef.current ? sessionRef.current.getState() : CHAT_IDLE),
    () => CHAT_IDLE,
  );

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [state.messages.length, state.streamingText, state.typing]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = sessionRef.current;
    const text = draft.trim();
    if (!text || !session || state.typing) return;
    setDraft("");
    try {
      await session.connect();          // a no-op while the socket is up
      await whenConnected(session);     // …and this is what the first send needs
      session.send(text);
    } catch {
      setDraft(text);                   // nothing was sent — give the words back
    }
  };

  const busy = state.typing || state.messages.some((m) => m.isStreaming);

  return (
    <section className="flex h-[30rem] flex-col gap-4">
      <SectionTitle>…or type</SectionTitle>
      <ol ref={log} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {state.messages.length === 0 && (
          <p className="text-sm text-neutral-400">
            Ask it anything — “what do you clean?”, “how much for a deep clean of a two-bedroom?”
          </p>
        )}
        {state.messages.map((m) =>
          m.role === "system"
            ? <Bubble key={m.id} who="tool" text={m.text.replace(/^🔧 Using |^✓ /, "").replace(/…$/, "")} draft={m.text.startsWith("🔧")} />
            : <Bubble key={m.id} who={m.role === "user" ? "user" : "bot"} text={m.text} />,
        )}
        {state.typing && !state.messages.some((m) => m.isStreaming) && <Typing />}
      </ol>
      <form onSubmit={send} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={busy ? "…" : "Write a message"}
          disabled={busy}
          className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-[15px] outline-none transition focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:focus:border-neutral-600"
        />
        <button disabled={!ready || busy} className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
          Send
        </button>
      </form>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </section>
  );
}

function Typing() {
  return (
    <li className="flex justify-start">
      <span className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
    </li>
  );
}

const CHAT_IDLE = { status: "idle", error: null, messages: [], typing: false, streamingText: "", sessionId: null } as unknown as ReturnType<ChatSession["getState"]>;

// ── 4. Watch — what the agent is handling right now, over SSE ─────────
// Phone calls never touch this browser, so this is the only way to see them.
type Live = { call: CallRow; state: string; lines: Line[]; userDraft: string; botDraft: string };

function AgentLive({ hideWebrtc }: { hideWebrtc: boolean }) {
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    const events = new EventSource("/api/events");
    const on = (name: string, fn: (d: any) => void) => events.addEventListener(name, (e) => fn(JSON.parse(e.data)));
    on("call.started", (call: CallRow) => setLive({ call, state: "listening", lines: [], userDraft: "", botDraft: "" }));
    on("turn", ({ state }) => setLive((l) => l && { ...l, state }));
    on("user.speaking", ({ text }) => setLive((l) => l && { ...l, userDraft: text }));
    on("bot.word", ({ text }) => setLive((l) => l && { ...l, botDraft: text }));
    // A line is applied once per (call, who, text, at): the same event can
    // reach the bus twice for a WebRTC call, and a bubble drawn twice is a lie.
    on("transcript", (line: Line & { id: string }) =>
      setLive((l) => {
        if (!l || l.lines.some((k) => k.at === line.at && k.who === line.who && k.text === line.text)) return l;
        return { ...l, lines: [...l.lines, line], userDraft: "", botDraft: "" };
      }),
    );
    on("call.ended", () => setLive(null));
    return () => events.close();
  }, []);

  const ownCall = live?.call.transport === "webrtc" && hideWebrtc;

  return (
    <section className="space-y-5">
      <SectionTitle>Watch · live</SectionTitle>
      {!live || ownCall ? (
        <p className="text-sm text-neutral-400">
          {ownCall ? "Your call above, seen from the server — same conversation." : "No call in progress. When one comes in, by phone or from another browser, it shows up here."}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-3 text-sm">
            <Phase phase={live.state} />
            <span className="text-neutral-400">{live.call.from} · {live.call.transport}</span>
          </div>
          <ol className="space-y-3">
            {live.lines.map((l, i) => <Bubble key={i} who={l.who} text={l.text} />)}
            {live.userDraft && <Bubble who="user" text={live.userDraft} draft />}
            {live.botDraft && <Bubble who="bot" text={live.botDraft} draft />}
          </ol>
        </>
      )}
    </section>
  );
}

// ── 5. Every call the agent took ──────────────────────────────────────
function History({ calls }: { calls: CallRow[] }) {
  const { revalidate } = useRevalidator();

  useEffect(() => {
    // The log is written server-side; re-run the loader when a call ends.
    const events = new EventSource("/api/events");
    events.addEventListener("call.ended", () => revalidate());
    return () => events.close();
  }, [revalidate]);

  return (
    <section className="space-y-4">
      <SectionTitle>History</SectionTitle>
      {calls.length === 0 && <p className="text-sm text-neutral-400">No calls yet.</p>}
      <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
        {calls.map((c) => <PastCall key={c.id} call={c} />)}
      </ul>
    </section>
  );
}

function PastCall({ call }: { call: CallRow }) {
  const when = new Date(call.startedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
  const secs = call.endedAt ? Math.round((call.endedAt - call.startedAt) / 1000) : null;
  return (
    <li>
      <details className="py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm">
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-neutral-400">{when}</span>
            <span>{call.from}</span>
            <span className="text-neutral-400">{call.transport}</span>
          </span>
          <span className="tabular-nums text-neutral-400">
            {secs !== null ? fmt(secs) : "live"} · {call.lines.length} lines
          </span>
        </summary>
        <ol className="mt-4 space-y-3">
          {call.lines.length === 0 && <p className="text-sm text-neutral-400">No transcript.</p>}
          {call.lines.map((l, i) => <Bubble key={i} who={l.who} text={l.text} />)}
        </ol>
      </details>
    </li>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────
const PHASES: Record<string, [string, string]> = {
  listening:   ["Listening",   "bg-emerald-500 animate-pulse"],
  thinking:    ["Thinking",    "bg-amber-400"],
  pause:       ["Pause",       "bg-amber-300"],
  speaking:    ["Speaking",    "bg-accent"],
  interrupted: ["Interrupted", "bg-neutral-400"],
  idle:        ["Idle",        "bg-neutral-300"],
};

function Phase({ phase }: { phase: string }) {
  const [label, dot] = PHASES[phase] ?? PHASES.idle;
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs uppercase tracking-[0.12em] text-neutral-400">{children}</h2>;
}

function Bubble({ who, text, draft }: { who: Line["who"]; text: string; draft?: boolean }) {
  if (who === "tool") {
    // A tool call: what the agent looked up, centred and quiet.
    return (
      <li className="flex justify-center">
        <code className={`max-w-full overflow-hidden text-ellipsis rounded-full bg-neutral-200/60 px-3 py-1 font-mono text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400 ${draft ? "opacity-50" : ""}`}>
          ⚙ {text}
        </code>
      </li>
    );
  }
  const user = who === "user";
  return (
    <li className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
        user ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
      } ${draft ? "opacity-50" : ""}`}>
        {/* The user typed plain text; the agent writes markdown-lite. */}
        {user ? <p className="whitespace-pre-wrap">{text || "…"}</p> : <Markdown text={text || "…"} />}
      </div>
    </li>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
