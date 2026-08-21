/**
 * Maravilla Cleaners — demo CRM.
 *
 * Fictional data (crm/data.json), loaded once and kept in memory: every
 * booking a call makes lives only for the current `pinecall run` process
 * and resets on restart. Nothing here talks to a real database or a real
 * Maravilla Cleaners system — it exists to give the six tools something
 * to work over.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "data.json");
const seed = JSON.parse(readFileSync(dataPath, "utf8"));

// Deep-clone the seed so mutations during a run never touch the file on disk.
const db = structuredClone(seed);

const SLOTS = ["09:00", "11:00", "13:00", "15:00"];

function findCustomer({ phone, email }) {
  return db.customers.find(
    (c) => (phone && c.phone === phone) || (email && c.email.toLowerCase() === email.toLowerCase()),
  );
}

export function lookupCustomer({ phone, email }) {
  const customer = findCustomer({ phone, email });
  if (!customer) return { found: false };

  const bookings = db.bookings.filter((b) => b.customerId === customer.id);
  return {
    found: true,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    pastBookings: bookings.map((b) => ({
      id: b.id,
      service: b.service,
      date: b.date,
      slot: b.slot,
      status: b.status,
    })),
  };
}

export function getQuote({ service, bedrooms = 0, bathrooms = 0, sqft = 0, frequency = "one-time" }) {
  const svc = db.services[service];
  if (!svc) return { error: `Unknown service "${service}". Options: ${Object.keys(db.services).join(", ")}` };

  let price = svc.base;
  if (svc.perBedroom) price += svc.perBedroom * bedrooms;
  if (svc.perBathroom) price += svc.perBathroom * bathrooms;
  if (svc.perSqft) price += svc.perSqft * sqft;

  const discount = db.frequencyDiscount[frequency] ?? 0;
  const low = Math.round(price * (1 - discount) * 0.9);
  const high = Math.round(price * (1 - discount) * 1.1);

  return {
    service: svc.label,
    priceRangeUsd: [low, high],
    duration: svc.duration,
    frequency,
    discountApplied: discount > 0 ? `${Math.round(discount * 100)}%` : "none",
    demo: true,
  };
}

export function checkAvailability({ date, area, zip, service }) {
  const target = area || zip;
  const eligible = db.crews.filter(
    (c) => c.skills.includes(service) && (!target || c.areas.includes(target)),
  );

  if (eligible.length === 0) {
    return { available: false, reason: `No crew covers "${target ?? "that area"}" for ${service} cleaning (demo coverage)` };
  }

  const crew = eligible.sort((a, b) => b.rating - a.rating)[0];
  const takenSlots = new Set(
    db.bookings.filter((b) => b.crewId === crew.id && b.date === date).map((b) => b.slot),
  );
  const openSlots = SLOTS.filter((s) => !takenSlots.has(s));

  return {
    available: openSlots.length > 0,
    date,
    slots: openSlots,
    crew: { name: crew.name, languages: crew.languages, rating: crew.rating },
    demo: true,
  };
}

export function bookCleaning({ customer, service, date, slot, address, notes }) {
  const eligible = db.crews.filter((c) => c.skills.includes(service));
  const crew = eligible.sort((a, b) => b.rating - a.rating)[0];
  if (!crew) return { booked: false, reason: `No crew offers ${service} cleaning (demo)` };

  const taken = db.bookings.some((b) => b.crewId === crew.id && b.date === date && b.slot === slot);
  if (taken) return { booked: false, reason: `${slot} on ${date} is no longer open — call checkAvailability again` };

  let cust = findCustomer(typeof customer === "object" ? customer : { phone: customer, email: customer });
  if (!cust) {
    cust = {
      id: `cust-${String(db.customers.length + 1).padStart(3, "0")}`,
      name: typeof customer === "object" ? customer.name : customer,
      phone: typeof customer === "object" ? customer.phone : undefined,
      email: typeof customer === "object" ? customer.email : undefined,
      bookings: [],
    };
    db.customers.push(cust);
  }

  const id = `BK-${1000 + db.bookings.length + 1}`;
  const booking = { id, customerId: cust.id, service, date, slot, address, notes, crewId: crew.id, status: "confirmed" };
  db.bookings.push(booking);
  cust.bookings.push(id);

  return {
    booked: true,
    confirmationId: id,
    confirmationText: `You're booked — ${service} cleaning on ${date} at ${slot}, ${crew.name} at ${address}. Confirmation ${id}.`,
    crew: crew.name,
  };
}

export function listCrews() {
  return db.crews.map((c) => ({
    name: c.name,
    areas: c.areas,
    languages: c.languages,
    skills: c.skills,
    rating: c.rating,
  }));
}

export function escalateToHuman({ reason }) {
  const entry = { id: `CB-${db.callbacks.length + 1}`, reason, at: new Date().toISOString() };
  db.callbacks.push(entry);
  return { recorded: true, callbackId: entry.id, reason };
}
