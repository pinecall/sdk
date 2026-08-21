/** Types for the demo CRM, so the web app (TypeScript) can use the same module. */

export type Service = "regular" | "deep" | "move-out" | "office";
export type Frequency = "one-time" | "weekly" | "biweekly" | "monthly";

export type Booking = {
  id: string;
  customerId: string;
  service: Service;
  date: string;
  slot: string;
  address: string;
  notes?: string;
  crewId: string;
  status: string;
};

export function lookupCustomer(args: { phone?: string; email?: string }): {
  found: boolean;
  name?: string;
  phone?: string;
  email?: string;
  pastBookings?: { id: string; service: Service; date: string; slot: string; status: string }[];
};

export function getQuote(args: {
  service: Service;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  frequency?: Frequency;
}): Record<string, unknown>;

export function checkAvailability(args: {
  date: string;
  area?: string;
  zip?: string;
  service: Service;
}): Record<string, unknown>;

export function bookCleaning(args: {
  customer: string;
  service: Service;
  date: string;
  slot: string;
  address: string;
  notes?: string;
}): { booked: boolean; reason?: string; confirmationId?: string; confirmationText?: string; crew?: string };

export function listCrews(): {
  name: string;
  areas: string[];
  languages: string[];
  skills: Service[];
  rating: number;
}[];

export function escalateToHuman(args: { reason: string }): {
  recorded: boolean;
  callbackId: string;
  reason: string;
};
