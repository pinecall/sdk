import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRevalidator } from "react-router";
import type { ChatSession } from "@pinecall/web/chat";
import type { VoiceSession } from "@pinecall/web/core";
import type { Route } from "./+types/page";
import { Call, type CallRow, type Line } from "./model.server";
import { AGENT } from "~/lib/agent-id.server";
import { Markdown } from "./markdown";
import { TopBar } from "~/ui/shell";

export const loader = () => ({ calls: Call.recent(), agent: AGENT });

// ══ The screen ════════════════════════════════════════════════════════
// One app: a sidebar of conversations on the left, the selected one on the
// right. Every conversation on this page — the visitor's own call, the
// visitor's chat, a phone call the agent is taking somewhere else — is the
// same shape (`Conv`), so the list and the transcript never learn where a
// conversation came from.
export default function FrontDeskPage({ loaderData }: Route.ComponentProps) {
  const agent = loaderData.agent;
  const voice = useVoice(agent);
  const chat = useChat(agent);
  const server = useServerCalls(loaderData.calls);

  const convs = useConversations({ voice, chat, server });
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const composer = useRef<HTMLInputElement | null>(null);

  // Auto-follow: the newest live conversation, until the visitor picks one.
  const newestLive = convs.find((c) => c.live)?.id ?? null;
  const exists = picked !== null && convs.some((c) => c.id === picked);
  const selectedId = exists ? picked : (newestLive ?? convs[0]?.id ?? null);
  const selected = convs.find((c) => c.id === selectedId) ?? null;
  const strayed = exists && newestLive !== null && picked !== newestLive;

  const select = useCallback((id: string) => (setPicked(id), setDrawer(false)), []);

  const write = useCallback(() => {
    select(CHAT_ID);
    // The drawer closes with a transition; focus after it, or iOS keeps it shut.
    setTimeout(() => composer.current?.focus(), 60);
  }, [select]);

  const talk = useCallback(() => {
    if (voice.live || voice.state.status === "connecting") voice.session?.disconnect();
    else (voice.session?.connect(), select(VOICE_ID));
  }, [voice, select]);

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <TopBar onConversations={() => setDrawer(true)} />

      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar · every conversation ───────────────────────────── */}
        {drawer && (
          <button
            aria-label="Close conversations"
            onClick={() => setDrawer(false)}
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-[86vw] max-w-[320px] flex-col border-r border-line bg-inset transition-transform duration-200 lg:static lg:z-0 lg:w-[300px] lg:translate-x-0 ${
            drawer ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Actions
            live={voice.live}
            connecting={voice.state.status === "connecting"}
            ready={voice.ready}
            onTalk={talk}
            onWrite={write}
            onClose={() => setDrawer(false)}
          />
          <ConversationList
            convs={convs}
            selectedId={selectedId}
            onSelect={select}
            following={!strayed}
            onFollow={() => setPicked(null)}
            hasLive={newestLive !== null}
          />
        </aside>

        {/* ── Main · the conversation ────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          {selected ? (
            <Conversation
              conv={selected}
              voice={voice}
              onTalk={talk}
            />
          ) : (
            <Empty onTalk={talk} onWrite={write} />
          )}
          <Composer
            inputRef={composer}
            disabled={!chat.ready || voice.live}
            busy={chat.busy}
            hint={voice.live ? "You are on a call — just talk." : null}
            error={chat.state.error ?? null}
            onSend={(text) => (select(CHAT_ID), chat.send(text))}
          />
        </main>
      </div>
    </div>
  );
}

// ══ The model every panel reads ═══════════════════════════════════════
const CHAT_ID = "local:chat";
const VOICE_ID = "local:voice";

type Channel = "voice" | "chat" | "phone";
type Turn = { key: string; who: Line["who"]; text: string; at: number; draft?: boolean };
type Conv = {
  id: string;
  channel: Channel;
  title: string;
  startedAt: number;
  endedAt?: number;
  live: boolean;
  phase: string;
  turns: Turn[];
  mine: boolean;      // the visitor's own conversation, in this browser
  hangUp?: () => void;
};

const CHANNEL: Record<Channel, { icon: string; label: string }> = {
  voice: { icon: "◉", label: "Voice call" },
  chat: { icon: "✎", label: "Text chat" },
  phone: { icon: "☎", label: "Phone" },
};

const channelOf = (transport: string): Channel =>
  transport === "chat" ? "chat" : transport === "webrtc" ? "voice" : "phone";

/** Everything the two panes render, in one sorted list: live first, newest first. */
function useConversations({
  voice,
  chat,
  server,
}: {
  voice: ReturnType<typeof useVoice>;
  chat: ReturnType<typeof useChat>;
  server: ReturnType<typeof useServerCalls>;
}): Conv[] {
  const stamps = useRef(new Map<string, number>());
  const at = (key: string) => {
    const known = stamps.current.get(key);
    if (known) return known;
    const now = Date.now();
    stamps.current.set(key, now);
    return now;
  };

  return useMemo(() => {
    const out: Conv[] = [];

    // 1. This browser's voice call — only while it is happening. Once it ends
    //    the server's own row for it lands in the log, and that is the record.
    const vs = voice.state;
    if (vs.status === "connecting" || vs.status === "connected") {
      out.push({
        id: VOICE_ID,
        channel: "voice",
        title: "Your call",
        startedAt: voice.startedAt || Date.now(),
        live: true,
        phase: vs.status === "connecting" ? "connecting" : vs.phase,
        mine: true,
        hangUp: () => voice.session?.disconnect(),
        turns: vs.messages.map((m: any) => toTurn(m, at)),
      });
    }

    // 2. This browser's chat. It is always there: it is how the page is used.
    const cs = chat.state;
    out.push({
      id: CHAT_ID,
      channel: "chat",
      title: "Your conversation",
      startedAt: at(`${CHAT_ID}:open`),
      live: cs.status === "connected",
      phase: chat.busy ? "thinking" : "listening",
      mine: true,
      turns: cs.messages.map((m: any) => toTurn(m, at)),
    });

    // 3. What the agent is handling elsewhere — phone calls, other browsers —
    //    plus every call it has taken. The visitor's own WebRTC call is on the
    //    server too; while they are on it, theirs is the one that shows.
    for (const row of server.rows) {
      const feed = server.feed[row.id];
      const live = !row.endedAt;
      const channel = channelOf(row.transport);
      // The visitor's own two conversations reach the server as calls like any
      // other. While they are having them, THEIRS is the one that shows — the
      // server's mirror of the same conversation would be a duplicate row and a
      // second transcript of the same words.
      if (live && channel === "voice" && voice.live) continue;
      if (live && channel === "chat" && chat.state.status === "connected") continue;

      const turns: Turn[] = [];
      const seen = new Set<string>();
      for (const l of [...row.lines, ...(feed?.lines ?? [])]) {
        const key = `${l.who}|${l.at}|${l.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        turns.push({ key, who: l.who, text: l.text, at: l.at });
      }
      if (feed?.userDraft) turns.push({ key: "d:user", who: "user", text: feed.userDraft, at: Date.now(), draft: true });
      if (feed?.botDraft) turns.push({ key: "d:bot", who: "bot", text: feed.botDraft, at: Date.now(), draft: true });

      out.push({
        id: row.id,
        channel,
        title: title(row),
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        live,
        phase: feed?.phase ?? (live ? "listening" : "idle"),
        mine: false,
        turns,
      });
    }

    return out.sort((a, b) => Number(b.live) - Number(a.live) || b.startedAt - a.startedAt);
  }, [voice.state, voice.live, voice.startedAt, voice.session, chat.state, chat.busy, server.rows, server.feed]);
}

/** The session classes report tool calls as system messages ("🔧 Using x…" → "✓ x"). */
function toTurn(m: any, at: (key: string) => number): Turn {
  if (m.role === "system") {
    return {
      key: m.id,
      who: "tool",
      text: String(m.text).replace(/^🔧 Using |^✓ /, "").replace(/…$/, ""),
      at: at(m.id),
      draft: String(m.text).startsWith("🔧"),
    };
  }
  return {
    key: m.id,
    who: m.role === "user" ? "user" : "bot",
    text: m.text,
    at: at(m.id),
    draft: Boolean(m.isInterim || m.speaking || m.isStreaming),
  };
}

const title = (row: CallRow) =>
  row.from === "chat" ? "Text chat" : row.from === "browser" ? "Browser call" : row.from;

// ══ Sidebar ═══════════════════════════════════════════════════════════
function Actions({
  live,
  connecting,
  ready,
  onTalk,
  onWrite,
  onClose,
}: {
  live: boolean;
  connecting: boolean;
  ready: boolean;
  onTalk: () => void;
  onWrite: () => void;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-b border-line p-3">
      <div className="flex items-center justify-between px-1 pb-1 lg:hidden">
        <span className="text-[13px] text-ink-2">Conversations</span>
        <button onClick={onClose} aria-label="Close conversations" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-surface">✕</button>
      </div>
      <button
        type="button"
        onClick={onTalk}
        disabled={!ready}
        className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-medium transition disabled:opacity-50 ${
          live
            ? "bg-danger text-white hover:opacity-90"
            : "bg-accent text-accent-ink hover:opacity-90"
        }`}
      >
        <span className={`h-2 w-2 rounded-full bg-current ${live ? "" : "opacity-70"}`} />
        {connecting ? "Connecting…" : live ? "Hang up" : "Talk to the agent"}
      </button>
      <button
        type="button"
        onClick={onWrite}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[14px] text-ink transition hover:border-line-2"
      >
        <span className="text-ink-3">✎</span> Write instead
      </button>
    </div>
  );
}

function ConversationList({
  convs,
  selectedId,
  onSelect,
  following,
  onFollow,
  hasLive,
}: {
  convs: Conv[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  following: boolean;
  onFollow: () => void;
  hasLive: boolean;
}) {
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const live = convs.filter((c) => c.live);
  const past = convs.filter((c) => !c.live);

  // ↑/↓ walk the list, Enter opens — the buttons do the rest.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = rows.current.filter(Boolean) as HTMLButtonElement[];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
    items[i === -1 ? 0 : next]?.focus();
  };

  let index = -1;
  const row = (c: Conv) => {
    index++;
    const i = index;
    return (
      <Row
        key={c.id}
        conv={c}
        selected={c.id === selectedId}
        onSelect={() => onSelect(c.id)}
        ref={(el) => { rows.current[i] = el; }}
      />
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroller px-2 pb-4" onKeyDown={onKeyDown}>
      {hasLive && !following && (
        <button
          onClick={onFollow}
          className="mt-3 flex w-full items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent transition hover:opacity-90"
        >
          ⤷ Follow the live conversation
        </button>
      )}

      {live.length > 0 && <Group label={following && hasLive ? "Live · following" : "Live"} />}
      {live.map(row)}

      <Group label="Recent" />
      {past.length === 0 && <p className="px-3 py-2 text-[13px] text-ink-3">Nothing yet. The log fills as the agent takes calls.</p>}
      {past.map(row)}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return <p className="px-3 pb-1 pt-4 text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</p>;
}

const Row = ({
  ref,
  conv,
  selected,
  onSelect,
}: {
  ref: (el: HTMLButtonElement | null) => void;
  conv: Conv;
  selected: boolean;
  onSelect: () => void;
}) => {
  const preview = conv.turns.findLast?.((t) => t.who !== "tool")?.text ?? conv.turns.find((t) => t.who !== "tool")?.text;
  const tools = conv.turns.filter((t) => t.who === "tool").length;
  const secs = conv.endedAt ? Math.round((conv.endedAt - conv.startedAt) / 1000) : null;

  return (
    <button
      ref={ref}
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition ${
        selected ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-line" : "hover:bg-surface/60"
      }`}
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-inset text-[12px] text-ink-2 ring-1 ring-line">
        {CHANNEL[conv.channel].icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px]">{conv.title}</span>
          {conv.live && conv.channel !== "chat" ? (
            <Timer from={conv.startedAt} />
          ) : (
            <span suppressHydrationWarning className="shrink-0 text-[12px] tabular-nums text-ink-3">{ago(conv.startedAt)}</span>
          )}
        </span>
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">
            {conv.live ? <Phase phase={conv.phase} small /> : (preview ?? (conv.mine ? "Write below to start" : "No transcript"))}
          </span>
          <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
            {secs !== null && <>{fmt(secs)}</>}
            {tools > 0 && <> · {tools}⚙</>}
          </span>
        </span>
      </span>
    </button>
  );
};

// ══ Main pane ═════════════════════════════════════════════════════════
function Conversation({
  conv,
  voice,
  onTalk,
}: {
  conv: Conv;
  voice: ReturnType<typeof useVoice>;
  onTalk: () => void;
}) {
  const log = useRef<HTMLOListElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const count = conv.turns.length;
  const last = conv.turns[count - 1]?.text.length ?? 0;

  useEffect(() => {
    if (!pinned) return;
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [count, last, pinned, conv.id]);

  // Switching conversation always lands at the bottom.
  useEffect(() => setPinned(true), [conv.id]);

  const onScroll = () => {
    const el = log.current;
    if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <>
      <header className="z-10 flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-3 sm:px-5">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px]">{conv.title}</span>
            {conv.live && <StatePill phase={conv.phase} />}
          </span>
          <span suppressHydrationWarning className="mt-0.5 block truncate text-[12.5px] text-ink-3">
            {CHANNEL[conv.channel].label} · {conv.live ? "started" : ""} {ago(conv.startedAt)}
            {conv.endedAt && <> · {fmt(Math.round((conv.endedAt - conv.startedAt) / 1000))}</>}
          </span>
        </span>
        {conv.live && conv.channel !== "chat" && <Timer from={conv.startedAt} big />}
        {/* On a phone the sidebar is behind a drawer, so the primary action
            comes with the conversation instead. */}
        {!voice.live && voice.state.status !== "connecting" && (
          <button
            onClick={onTalk}
            className="h-9 shrink-0 rounded-full bg-accent px-4 text-[13px] font-medium text-accent-ink transition hover:opacity-90 lg:hidden"
          >
            Talk
          </button>
        )}
        {conv.hangUp && (
          <button
            onClick={conv.hangUp}
            className="h-9 shrink-0 rounded-full bg-danger px-4 text-[13px] text-white transition hover:opacity-90"
          >
            Hang up
          </button>
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        <ol
          ref={log}
          onScroll={onScroll}
          className="scroller absolute inset-0 space-y-3 overflow-y-auto px-3 py-5 sm:px-6"
        >
          {conv.id === VOICE_ID && voice.live && (
            <li className="mb-4 list-none">
              <VoiceHero voice={voice} />
            </li>
          )}
          {conv.turns.length === 0 &&
            (conv.mine && conv.channel === "chat" ? (
              <StartHere onTalk={onTalk} />
            ) : (
              <p className="text-[14px] text-ink-3">
                {conv.live ? "Listening… the transcript appears as it is spoken." : "No transcript."}
              </p>
            ))}
          {conv.turns.map((t, i) => (
            <Bubble key={t.key} turn={t} t={i === 0 ? 0 : Math.max(0, (t.at - conv.startedAt) / 1000)} />
          ))}
        </ol>

        {!pinned && (
          <button
            onClick={() => setPinned(true)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-canvas shadow-lg"
          >
            ↓ Jump to latest
          </button>
        )}
      </div>
    </>
  );
}

/** The call itself, at the top of its own transcript: level, mute, duration. */
function VoiceHero({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const speaking = voice.state.phase === "speaking";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-accent-soft px-4 py-4">
      <span className="flex h-10 items-end gap-1" aria-hidden="true">
        {[0, 120, 240, 360, 180].map((d, i) => (
          <span
            key={i}
            className={`w-1 rounded-full bg-accent ${speaking ? "wave-bar" : ""}`}
            style={{ height: `${[14, 26, 36, 22, 16][i]}px`, animationDelay: `${d}ms`, opacity: speaking ? 1 : 0.35 }}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px]">You are on a call with the front desk.</span>
        <span className="mt-0.5 block text-[12.5px] text-ink-2">
          {voice.state.isMuted ? "Your microphone is muted." : "Speak whenever you like — it listens while it talks."}
        </span>
      </span>
      <button
        onClick={() => voice.session?.toggleMute()}
        className="h-9 shrink-0 rounded-full border border-line bg-surface px-3.5 text-[13px] transition hover:border-line-2"
      >
        {voice.state.isMuted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}

/** The visitor's own chat, before they have said anything: the two doors. */
function StartHere({ onTalk }: { onTalk: () => void }) {
  return (
    <li className="list-none py-6">
      <p className="text-[20px] tracking-tight">Two ways to reach the front desk</p>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-2">
        Ask what the company cleans, get a price estimate, check a date and book it — the
        agent looks everything up in front of you. Write below, or{" "}
        <button onClick={onTalk} className="text-accent underline underline-offset-4">talk to it out loud</button>.
      </p>
      <ul className="mt-5 space-y-2">
        {["What do you clean?", "How much for a deep clean of a two-bedroom?", "Is Friday morning free?"].map((q) => (
          <li key={q} className="text-[13.5px] text-ink-3">“{q}”</li>
        ))}
      </ul>
    </li>
  );
}

function Empty({ onTalk, onWrite }: { onTalk: () => void; onWrite: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-[22px] tracking-tight">Two ways to reach the front desk</p>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Ask what the company cleans, get a price estimate, check a date and book it — the
          agent looks everything up in front of you, by voice or in writing.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={onTalk} className="h-11 rounded-xl bg-accent px-5 text-[14px] font-medium text-accent-ink transition hover:opacity-90">
            Talk to the agent
          </button>
          <button onClick={onWrite} className="h-11 rounded-xl border border-line bg-surface px-5 text-[14px] transition hover:border-line-2">
            Write instead
          </button>
        </div>
      </div>
    </div>
  );
}

function Composer({
  inputRef,
  disabled,
  busy,
  hint,
  error,
  onSend,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  busy: boolean;
  hint: string | null;
  error: string | null;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || disabled || busy) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      {/* Both controls are dead until the page has hydrated. A live-looking
          input in server-rendered HTML is a trap: Enter submits the form
          natively, the browser navigates, and the first message a visitor ever
          types is the one that disappears. */}
      <form onSubmit={submit} className="mx-auto flex max-w-3xl gap-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hint ?? (disabled ? "Connecting…" : busy ? "The agent is answering…" : "Write a message")}
          disabled={disabled || busy}
          aria-label="Write a message"
          className="h-11 w-full rounded-xl border border-line bg-canvas px-4 text-[15px] outline-none transition placeholder:text-ink-3 focus:border-line-2 disabled:opacity-60"
        />
        <button
          disabled={disabled || busy}
          className="h-11 shrink-0 rounded-xl bg-ink px-5 text-[14px] text-canvas transition hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
      </form>
      {error && <p className="mx-auto mt-2 max-w-3xl text-[13px] text-danger">{error}</p>}
    </div>
  );
}

// ══ Bits ══════════════════════════════════════════════════════════════
const PHASES: Record<string, [string, string]> = {
  connecting:  ["Connecting", "bg-ink-3"],
  listening:   ["Listening", "bg-success dot-live"],
  thinking:    ["Thinking", "bg-amber-400"],
  pause:       ["Pause", "bg-amber-300"],
  speaking:    ["Speaking", "bg-accent"],
  interrupted: ["Interrupted", "bg-ink-3"],
  idle:        ["Idle", "bg-ink-3"],
};

function Phase({ phase, small }: { phase: string; small?: boolean }) {
  const [label, dot] = PHASES[phase] ?? PHASES.idle;
  return (
    <span className={`inline-flex items-center gap-1.5 ${small ? "text-[12.5px]" : "text-sm"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function StatePill({ phase }: { phase: string }) {
  const [label, dot] = PHASES[phase] ?? PHASES.idle;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-inset px-2.5 py-1 text-[12px] text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** A second hand the server never has to send. */
function Timer({ from, big }: { from: number; big?: boolean }) {
  const [secs, setSecs] = useState(() => Math.max(0, Math.round((Date.now() - from) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.max(0, Math.round((Date.now() - from) / 1000))), 1000);
    return () => clearInterval(t);
  }, [from]);
  return <span suppressHydrationWarning className={`shrink-0 tabular-nums text-ink-2 ${big ? "text-[14px]" : "text-[12px]"}`}>{fmt(secs)}</span>;
}

function Bubble({ turn, t }: { turn: Turn; t: number }) {
  const [open, setOpen] = useState(false);

  if (turn.who === "tool") {
    // A tool call: what the agent looked up, centred and quiet.
    return (
      <li className="flex justify-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`max-w-full rounded-full bg-inset px-3 py-1 font-mono text-[11.5px] text-ink-2 ring-1 ring-line transition hover:text-ink ${turn.draft ? "opacity-60" : ""}`}
        >
          ⚙ <span className={open ? "" : "truncate"}>{turn.text}</span>
          {open && <span className="ml-2 tabular-nums text-ink-3">t+{t.toFixed(1)}s</span>}
        </button>
      </li>
    );
  }

  const user = turn.who === "user";
  return (
    <li className={`group flex flex-col ${user ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:max-w-[75%] ${
          user ? "bg-accent text-accent-ink" : "border border-line bg-surface text-ink"
        } ${turn.draft ? "opacity-60" : ""}`}
      >
        {/* The user typed plain text; the agent writes markdown-lite. */}
        {user ? <p className="whitespace-pre-wrap">{turn.text || "…"}</p> : <Markdown text={turn.text || "…"} />}
      </div>
      <span className="mt-1 px-1 text-[11px] tabular-nums text-ink-3 opacity-0 transition group-hover:opacity-100">
        t+{t.toFixed(1)}s
      </span>
    </li>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The server formats in the box's timezone and the browser in the visitor's;
 *  everything relative below is `suppressHydrationWarning` for that reason. */
function ago(ts: number) {
  if (ts > Date.now() + 60_000) return "now";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ══ Sessions ══════════════════════════════════════════════════════════
// Both live at the top of the page and are created exactly once: the sidebar,
// the header and the composer are views over them, never owners.

const IDLE_VOICE = { status: "idle", phase: "idle", messages: [], isMuted: false, duration: 0 } as unknown as ReturnType<VoiceSession["getState"]>;

function useVoice(agent: string) {
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
    () => (ready && sessionRef.current ? sessionRef.current.getState() : IDLE_VOICE),
    () => IDLE_VOICE,
  );

  // When this call began, so the timer is the call's and not the page's: it is
  // cleared on hang-up, and the next call starts its own clock.
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => {
    const active = state.status === "connecting" || state.status === "connected";
    setStartedAt((s) => (active ? s || Date.now() : 0));
  }, [state.status]);

  return { ready, state, startedAt, session: sessionRef.current, live: state.status === "connected" };
}

// One conversation per visitor, and it survives everything. The socket is
// opened when the page mounts (not on the first keystroke: `connect()`
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

/**
 * Resolves when the server has answered `chat.connected` — not before.
 *
 * Nothing here calls `connect()` a second time, and that is the point.
 * `ChatSession.connect()` only assigns `this.ws` AFTER awaiting the token, so
 * its `if (this.ws) return` guard does not hold against a concurrent call: two
 * overlapping connects open two WebSockets, and every WebSocket is one more
 * conversation on the server. The page connects exactly once, on mount, and
 * lets the session's own auto-reconnect handle a socket that dies.
 */
function whenConnected(session: ChatSession, ms = 20000) {
  if (session.getState().status === "connected") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => (off(), reject(new Error("chat did not connect"))), ms);
    off = session.subscribe(() => {
      const { status } = session.getState();
      if (status === "connected") (clearTimeout(timer), off(), resolve());
      if (status === "destroyed") (clearTimeout(timer), off(), reject(new Error("chat destroyed")));
    });
  });
}

const CHAT_IDLE = { status: "idle", error: null, messages: [], typing: false, streamingText: "", sessionId: null } as unknown as ReturnType<ChatSession["getState"]>;

function useChat(agent: string) {
  const sessionRef = useRef<ChatSession | null>(null);
  // The chat client is a dynamic import: someone who types in the first second
  // is typing before it lands. Awaiting this promise is what keeps that message
  // instead of dropping it on an empty ref.
  const arriving = useRef<Promise<ChatSession> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cleanup = () => {};
    arriving.current = import("@pinecall/web/chat").then(({ ChatSession }) => {
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
      return session;
    });
    return () => cleanup();
  }, [agent]);

  const state = useSyncExternalStore(
    (cb) => (ready && sessionRef.current ? sessionRef.current.subscribe(cb) : () => {}),
    () => (ready && sessionRef.current ? sessionRef.current.getState() : CHAT_IDLE),
    () => CHAT_IDLE,
  );

  const send = useCallback(async (text: string) => {
    try {
      const session = await arriving.current;
      if (!session) throw new Error("no chat client");
      await whenConnected(session);     // what the very first message needs
      session.send(text);
    } catch {
      /* nothing was sent; the error surfaces through the session state */
    }
  }, []);

  const busy = state.typing || state.messages.some((m) => m.isStreaming);
  return { ready, state, send, busy };
}

// ══ What the agent is handling, over SSE ══════════════════════════════
// Phone calls never touch this browser, so this is the only way to see them.
type Feed = { phase: string; lines: Line[]; userDraft: string; botDraft: string };

function useServerCalls(snapshot: CallRow[]) {
  const [rows, setRows] = useState<CallRow[]>(snapshot);
  const [feed, setFeed] = useState<Record<string, Feed>>({});
  const { revalidate } = useRevalidator();

  // The loader is the authority on what the log holds; SSE is what happens next.
  useEffect(() => {
    setRows((old) => {
      const merged = new Map(old.map((r) => [r.id, r]));
      for (const r of snapshot) merged.set(r.id, r);
      return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
    });
  }, [snapshot]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    const on = (name: string, fn: (d: any) => void) =>
      events.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)));

    const touch = (id: string, fn: (f: Feed) => Feed) =>
      setFeed((f) => ({ ...f, [id]: fn(f[id] ?? { phase: "listening", lines: [], userDraft: "", botDraft: "" }) }));

    on("call.started", (call: CallRow) => {
      setRows((r) => [call, ...r.filter((x) => x.id !== call.id)]);
      touch(call.id, (f) => ({ ...f, phase: "listening" }));
    });
    on("turn", ({ id, state }) => touch(id, (f) => ({ ...f, phase: state })));
    on("user.speaking", ({ id, text }) => touch(id, (f) => ({ ...f, userDraft: text })));
    on("bot.word", ({ id, text }) => touch(id, (f) => ({ ...f, botDraft: text })));
    // A line is applied once per (call, who, text, at): the same event can
    // reach the bus twice for a WebRTC call, and a bubble drawn twice is a lie.
    on("transcript", (line: Line & { id: string }) =>
      touch(line.id, (f) =>
        f.lines.some((k) => k.at === line.at && k.who === line.who && k.text === line.text)
          ? f
          : { ...f, lines: [...f.lines, { who: line.who, text: line.text, at: line.at }], userDraft: "", botDraft: "" },
      ),
    );
    on("call.ended", ({ id, endedAt }) => {
      setRows((r) => r.map((x) => (x.id === id ? { ...x, endedAt: endedAt ?? Date.now() } : x)));
      // The transcript is written server-side; pick up the finished row.
      revalidate();
    });

    return () => events.close();
  }, [revalidate]);

  return { rows, feed };
}
