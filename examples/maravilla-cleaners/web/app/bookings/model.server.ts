import * as crm from "../../../crm/index.mjs";
import { bus } from "~/lib/bus.server";
import { db } from "~/lib/db.server";

// The demo CRM (../../crm — shared with the CLI example) is the domain: prices,
// crews, availability and bookings, all fictional. This model is the app's door
// to it: the same functions, plus the two things a web app needs — a booking
// lands in db.json so it survives a restart, and it is mirrored on the bus so
// every open tab sees it happen.
export type BookingRow = {
  confirmationId: string;
  service: string;
  date: string;
  slot: string;
  address: string;
  customer: string;
  crew?: string;
  at: number;
};

const all = () => (db.bookings ?? []) as BookingRow[];

export const Booking = {
  lookup: crm.lookupCustomer,
  quote: crm.getQuote,
  availability: crm.checkAvailability,
  crews: crm.listCrews,
  escalate: crm.escalateToHuman,

  create(args: Parameters<typeof crm.bookCleaning>[0]) {
    const result = crm.bookCleaning(args);
    if (result.booked && result.confirmationId) {
      const row: BookingRow = {
        confirmationId: result.confirmationId,
        service: args.service,
        date: args.date,
        slot: args.slot,
        address: args.address,
        customer: args.customer,
        crew: result.crew,
        at: Date.now(),
      };
      db.bookings = [...all(), row].slice(-50);
      bus.emit("booking", row);
    }
    return result;
  },

  recent(limit = 20): BookingRow[] {
    return all().slice(-limit).reverse();
  },
};
