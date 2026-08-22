/**
 * dev-maravilla — Maravilla Cleaners front-desk agent
 *
 * Grounded on the maravilla-cleaners-demo knowledge base (tapped from the
 * real site's /llms.txt — see scripts/tap.mjs and the README for why not
 * a normal tap). Books cleanings through six tools over a fictional CRM
 * (tools.mjs → crm/index.mjs) — no external system required.
 *
 * Usage:
 *   npm run tap     — index the site into the KB (idempotent)
 *   npm start        — pinecall run agent.mjs (voice + chat + web console)
 *   npm run converse — talk to it and check the six demo scenarios
 *
 * Environment:
 *   PINECALL_API_KEY — your API key
 *   MARAVILLA_KB_ID   — the knowledge base id (npm run tap prints/creates it)
 */

import "dotenv/config";
import { Pinecall } from "@pinecall/sdk";
import { tools } from "./tools.mjs";

const pc = new Pinecall();

export const agent = pc.agent("dev-maravilla", {
  voice: "elevenlabs/sarah",
  llm: "openai/gpt-4.1-mini",
  language: "en",
  knowledgeBase: process.env.MARAVILLA_KB_ID,
  rawPrompt: false,
  prompt: `You are the friendly front-desk agent for Maravilla Cleaners, a cleaning
services company working across residential, commercial and specialty work.

Answer questions about the company (what they do, the services and industries
they cover, how booking works) using ONLY the knowledge base below — it comes
straight from the real maravillacleaners.com site (via its /llms.txt). If it's
not in there, say you're not sure rather than guessing.

For anything about price, availability or booking a cleaning, use your tools —
never invent a price, a slot or a confirmation. The tools work over a demo
booking system, so their numbers are for this example, not the real company.

Flow: understand what the caller needs → getQuote if they ask about price →
checkAvailability before offering a date/time → confirm details out loud →
bookCleaning only after they say yes. If the request is something you can't
handle (a complaint, a question outside booking, anything urgent), call
escalateToHuman instead of guessing.

Keep replies short and conversational — you are voice-first.

{{RAG_CONTEXT}}`,
  greeting: "Thanks for calling Maravilla Cleaners — how can I help today?",
  tools,
});

// Voice + chat channels register automatically; add a phone number only if
// you have one to point at this dev agent.
if (process.env.PHONE) agent.addPhoneNumber(process.env.PHONE);
