/**
 * Maravilla Cleaners — six tools over the demo CRM (crm/index.mjs).
 *
 * All fictional: prices, crews, availability and bookings are demo data,
 * never anything scraped from the real maravillacleaners.com.
 */

import { tool } from "@pinecall/sdk";
import { z } from "zod";
import * as crm from "./crm/index.mjs";

export const lookupCustomer = tool({
  name: "lookupCustomer",
  description: "Look up an existing customer and their past bookings by phone or email.",
  schema: z.object({
    phone: z.string().optional().describe("Phone number, e.g. +13055550101"),
    email: z.string().optional().describe("Email address"),
  }),
  execute: async ({ phone, email }) => crm.lookupCustomer({ phone, email }),
});

export const getQuote = tool({
  name: "getQuote",
  description:
    "Get a price range and estimated duration for a cleaning. Demo pricing — " +
    "always say the numbers are an estimate, the final quote is confirmed at booking.",
  schema: z.object({
    service: z.enum(["regular", "deep", "move-out", "office"]),
    bedrooms: z.number().default(0).describe("Number of bedrooms"),
    bathrooms: z.number().default(0).describe("Number of bathrooms"),
    sqft: z.number().optional().describe("Square footage, for office cleaning"),
    frequency: z.enum(["one-time", "weekly", "biweekly", "monthly"]).default("one-time"),
  }),
  execute: async (args) => crm.getQuote(args),
});

export const checkAvailability = tool({
  name: "checkAvailability",
  description: "Check open time slots for a date, area/zip and service, and which crew would take it.",
  schema: z.object({
    date: z.string().describe("Date in YYYY-MM-DD format"),
    area: z.string().optional().describe("Neighborhood/area name, e.g. downtown, midtown, north"),
    zip: z.string().optional().describe("ZIP code, e.g. 33101"),
    service: z.enum(["regular", "deep", "move-out", "office"]),
  }),
  execute: async ({ date, area, zip, service }) => crm.checkAvailability({ date, area, zip, service }),
});

export const bookCleaning = tool({
  name: "bookCleaning",
  description:
    "Book a cleaning. ONLY call after the caller has confirmed the date, slot and address, " +
    "and after checkAvailability showed that slot open.",
  schema: z.object({
    customer: z.string().describe("Customer's name, phone, or email"),
    service: z.enum(["regular", "deep", "move-out", "office"]),
    date: z.string().describe("Date in YYYY-MM-DD format"),
    slot: z.string().describe("Time slot, e.g. 11:00"),
    address: z.string().describe("Service address"),
    notes: z.string().optional().describe("Access instructions, pets, special requests"),
  }),
  execute: async (args) => crm.bookCleaning(args),
});

export const listCrews = tool({
  name: "listCrews",
  description: "List the cleaning crews: their areas, languages, skills and rating.",
  schema: z.object({}),
  execute: async () => ({ crews: crm.listCrews() }),
});

export const escalateToHuman = tool({
  name: "escalateToHuman",
  description: "Record a callback request when the caller needs a human — a question outside booking/pricing, a complaint, or anything you can't resolve.",
  schema: z.object({
    reason: z.string().describe("Why the caller needs a human callback"),
  }),
  execute: async ({ reason }) => crm.escalateToHuman({ reason }),
});

export const tools = [lookupCustomer, getQuote, checkAvailability, bookCleaning, listCrews, escalateToHuman];
