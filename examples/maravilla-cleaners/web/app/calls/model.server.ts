import { db } from "~/lib/db.server";
import { bus } from "~/lib/bus.server";

export type Line = { who: "user" | "bot" | "tool"; text: string; at: number };
export type CallRow = {
  id: string;
  from: string;
  transport: string;
  startedAt: number;
  endedAt?: number;
  reason?: string;
  lines: Line[];
};

const KEEP = 50;
const all = () => (db.calls ?? []) as CallRow[];
const save = (calls: CallRow[]) => (db.calls = calls.slice(-KEEP));
const patch = (id: string, fn: (c: CallRow) => void) => {
  const calls = all();
  const call = calls.find((c) => c.id === id);
  if (call) (fn(call), save(calls));
  return call;
};

// The call log: every call the agent took, with its transcript. Written by the
// agent as events arrive, read by the calls page — and mirrored on the bus so an
// open tab sees it happen.
export const Call = {
  start(call: { id: string; from: string; transport: string }): CallRow {
    const row: CallRow = { ...call, startedAt: Date.now(), lines: [] };
    save([...all().filter((c) => c.id !== call.id), row]);
    bus.emit("call.started", row);
    return row;
  },

  line(id: string, who: Line["who"], text: string) {
    const line: Line = { who, text, at: Date.now() };
    patch(id, (c) => c.lines.push(line));
    bus.emit("transcript", { id, ...line });
  },

  end(id: string, reason: string) {
    const row = patch(id, (c) => Object.assign(c, { endedAt: Date.now(), reason }));
    bus.emit("call.ended", { id, reason, endedAt: row?.endedAt });
  },

  recent(limit = 20): CallRow[] {
    return all().slice(-limit).reverse();
  },
};
