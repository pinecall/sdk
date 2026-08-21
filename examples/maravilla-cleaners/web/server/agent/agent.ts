import { Pinecall } from "@pinecall/sdk";
import { createRequire } from "node:module";
import { Call } from "~/calls/model.server";
import { Settings, type SettingsRow } from "~/settings/model.server";
import { AGENT } from "~/lib/agent-id.server";
import { bus } from "~/lib/bus.server";
import { PROMPT, vars } from "./prompt";
import { tools } from "./tools";

// PINECALL_LOG=./pinecall.log makes the SDK write every wire event it receives.
// Its file logger reaches for `require`, which an ESM bundle does not have —
// give it one, or the option silently does nothing.
if (process.env.PINECALL_LOG) (globalThis as any).require ??= createRequire(import.meta.url);

// ── Config ────────────────────────────────────────────────────────────
// The top half comes from the form. The bottom half comes from a pull request.
const config = (s: SettingsRow) => ({
  greeting: s.greeting,
  voice: s.voice,
  language: s.language,
  promptVars: vars(s),

  prompt: PROMPT,
  rawPrompt: false,
  knowledgeBase: process.env.MARAVILLA_KB_ID,
  llm: "openai/gpt-4.1-mini",
  stt: "deepgram/flux",
  tools,
  phoneNumber: process.env.PHONE,
});

// Every event the agent receives is logged as `name · call · detail`, so a
// phone call can be followed from the terminal.
const log = (name: string, call: any, detail = "") =>
  console.log(`  ${name.padEnd(16)} ${String(call?.id ?? "").slice(0, 12).padEnd(12)} ${detail}`);

// ── Agent ─────────────────────────────────────────────────────────────
export function startAgent() {
  const pc = new Pinecall();
  const agent = pc.agent(AGENT, config(Settings.get()));

  // The form saved → the next call is born with it.
  bus.on("settings", (s) => agent.update(config(s)));

  // ── The call log and the live page ──────────────────────────────────
  // Call.* writes the log and mirrors each step on the bus; `turn` is the
  // moment-to-moment state the live page shows and nobody needs to keep.
  const turn = (call: any, state: string) => (log("turn", call, state), bus.emit("turn", { id: call.id, state }));

  agent.on("call.started", (call) => {
    log("call.started", call, `${call.from ?? "browser"} · ${call.transport}`);
    Call.start({ id: call.id, from: call.from ?? "browser", transport: call.transport });
  });
  agent.on("chat.started" as any, (call: any) => {
    log("chat.started", call);
    Call.start({ id: call.id, from: "chat", transport: "chat" });
  });
  agent.on("call.ended", (call, reason) => (log("call.ended", call, reason), Call.end(call.id, reason)));

  // The user's side: interim words while they speak, one final line per turn.
  agent.on("speech.started", (_, call) => turn(call, "listening"));
  agent.on("user.speaking", ({ text }, call) => (log("user.speaking", call, text), bus.emit("user.speaking", { id: call.id, text })));
  agent.on("user.message", ({ text }, call) => (log("user.message", call, text), Call.line(call.id, "user", text)));
  agent.on("eager.turn", (_, call) => turn(call, "thinking"));
  agent.on("turn.pause" as any, (_: unknown, call: any) => turn(call, "pause"));  // SmartTurn: a pause, not the end
  agent.on("turn.end", (_, call) => turn(call, "thinking"));
  agent.on("turn.continued", (_, call) => turn(call, "listening"));
  agent.on("llm.toolCall", ({ toolCalls }, call) => log("llm.toolCall", call, toolCalls.map((t) => t.name).join(", ")));

  // The bot's side. One rule: the bot's line is what has been SAID. On voice,
  // bot.speaking may carry the whole text up front (the phone does, for the
  // greeting) but it is not shown until the audio plays — bot.word grows a
  // draft, bot.finished closes it with call.currentBotText. Chat has no audio
  // and no words, so there bot.speaking is the line.
  const voice = (call: any) => call.transport !== "chat";
  agent.on("bot.speaking", ({ text }, call) => {
    log("bot.speaking", call, text ? `"${text.slice(0, 50)}"` : "(streaming)");
    turn(call, "speaking");
    if (voice(call)) bus.emit("bot.word", { id: call.id, text: "" });
    else Call.line(call.id, "bot", text);
  });
  agent.on("bot.word", ({ word }, call) => {
    process.stdout.write(word + " ");
    bus.emit("bot.word", { id: call.id, text: call.currentBotText });
  });
  agent.on("bot.finished", (_, call) => {
    console.log();
    log("bot.finished", call, `"${call.currentBotText.slice(0, 50)}"`);
    turn(call, "listening");
    if (voice(call) && call.currentBotText) Call.line(call.id, "bot", call.currentBotText);
  });
  agent.on("bot.interrupted", (_, call) => {
    console.log();
    log("bot.interrupted", call, `"${call.currentBotText.slice(0, 50)}"`);
    turn(call, "interrupted");
    if (call.currentBotText) Call.line(call.id, "bot", `${call.currentBotText} —`);
  });

  console.log(`  agent ${AGENT} · ${process.env.PHONE ?? "browser only"}`);
  return agent;
}
