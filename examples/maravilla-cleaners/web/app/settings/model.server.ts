import { db } from "~/lib/db.server";
import { bus } from "~/lib/bus.server";

const DEFAULTS = {
  name: "Maravilla Cleaners",
  greeting: "Thanks for calling Maravilla Cleaners — how can I help today?",
  voice: "elevenlabs/sarah",
  language: "en",
  hours: "Monday to Friday, 8am to 6pm. Saturdays, 9am to 2pm.",
  services: "Regular cleaning\nDeep cleaning\nMove-out cleaning\nOffice cleaning",
  notes: "Prices, crews and availability come from a demo booking system — say the numbers are an estimate.",
};

export type SettingsRow = typeof DEFAULTS & { updatedAt?: number };

export const Settings = {
  get(): SettingsRow {
    return { ...DEFAULTS, ...db.settings };
  },

  update(patch: Record<string, unknown>): SettingsRow {
    const next: SettingsRow = { ...this.get(), updatedAt: Date.now() };
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      if (key in patch) next[key] = String(patch[key]);
    }
    db.settings = next;
    bus.emit("settings", next);
    return next;
  },
};
