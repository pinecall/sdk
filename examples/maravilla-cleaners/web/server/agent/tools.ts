import { tool } from "@pinecall/sdk";
import { z } from "zod";
import { Booking } from "~/bookings/model.server";
import { Call } from "~/calls/model.server";

// The six demo tools of the Maravilla example, over the same CRM the CLI
// version uses (../../crm). The only difference here is `traced`: a tool call
// is part of the conversation, so it gets one line in the call log — the page
// (and the history) show the agent actually looked something up.
const service = z.enum(["regular", "deep", "move-out", "office"]);

export const lookupCustomer = tool({
  name: "lookupCustomer",
  description: "Look up an existing customer and their past bookings by phone or email.",
  schema: z.object({
    phone: z.string().optional().describe("Phone number, e.g. +13055550101"),
    email: z.string().optional().describe("Email address"),
  }),
  execute: traced("lookupCustomer", async (args) => Booking.lookup(args)),
});

export const getQuote = tool({
  name: "getQuote",
  description:
    "Get a price range and estimated duration for a cleaning. Demo pricing — " +
    "always say the numbers are an estimate, the final quote is confirmed at booking.",
  schema: z.object({
    service,
    bedrooms: z.number().default(0).describe("Number of bedrooms"),
    bathrooms: z.number().default(0).describe("Number of bathrooms"),
    sqft: z.number().optional().describe("Square footage, for office cleaning"),
    frequency: z.enum(["one-time", "weekly", "biweekly", "monthly"]).default("one-time"),
  }),
  execute: traced("getQuote", async (args) => Booking.quote(args)),
});

export const checkAvailability = tool({
  name: "checkAvailability",
  description: "Check open time slots for a date, area/zip and service, and which crew would take it.",
  schema: z.object({
    date: z.string().describe("Date in YYYY-MM-DD format"),
    area: z.string().optional().describe("Neighborhood/area name, e.g. downtown, midtown, north"),
    zip: z.string().optional().describe("ZIP code, e.g. 33101"),
    service,
  }),
  execute: traced("checkAvailability", async (args) => Booking.availability(args)),
});

export const bookCleaning = tool({
  name: "bookCleaning",
  description:
    "Book a cleaning. ONLY call after the caller has confirmed the date, slot and address, " +
    "and after checkAvailability showed that slot open.",
  schema: z.object({
    customer: z.string().describe("Customer's name, phone, or email"),
    service,
    date: z.string().describe("Date in YYYY-MM-DD format"),
    slot: z.string().describe("Time slot, e.g. 11:00"),
    address: z.string().describe("Service address"),
    notes: z.string().optional().describe("Access instructions, pets, special requests"),
  }),
  execute: traced("bookCleaning", async (args) => Booking.create(args)),
});

export const listCrews = tool({
  name: "listCrews",
  description: "List the cleaning crews: their areas, languages, skills and rating.",
  schema: z.object({}),
  execute: traced("listCrews", async () => ({ crews: Booking.crews() })),
});

export const escalateToHuman = tool({
  name: "escalateToHuman",
  description:
    "Record a callback request when the caller needs a human — a question outside " +
    "booking/pricing, a complaint, or anything you can't resolve.",
  schema: z.object({ reason: z.string().describe("Why the caller needs a human callback") }),
  execute: traced("escalateToHuman", async (args) => Booking.escalate(args)),
});

export const tools = [lookupCustomer, getQuote, checkAvailability, bookCleaning, listCrews, escalateToHuman];

function traced<A, R>(name: string, run: (args: A) => Promise<R>) {
  return async (args: A, call: any) => {
    const result = await run(args);
    const text = `${name} ${short(args)} → ${short(result)}`;
    console.log(`  ${"tool".padEnd(16)} ${String(call?.id ?? "").slice(0, 12).padEnd(12)} ${text}`);
    if (call?.id) Call.line(call.id, "tool", text);
    return result;
  };
}
const short = (v: unknown) => JSON.stringify(v).replace(/"/g, "").slice(0, 80);
