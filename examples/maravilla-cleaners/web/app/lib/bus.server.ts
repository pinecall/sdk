import { EventEmitter } from "node:events";
import { remember } from "./remember.server";

// One in-process event bus: models emit, the agent and the browser listen.
export const bus = remember("bus", () => new EventEmitter());

// What /api/events forwards to the browser.
export const TOPICS = [
  "settings",
  "booking",
  "call.started",
  "call.ended",
  "turn",          // listening · thinking · speaking · interrupted
  "user.speaking", // interim STT, replaced as it refines
  "bot.word",      // the bot's line so far, word by word
  "transcript",    // a final line, user or bot
] as const;
