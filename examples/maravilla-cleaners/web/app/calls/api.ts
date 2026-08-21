import { Call } from "./model.server";

// GET /api/calls — the live snapshot: every call the agent took, newest first,
// each with its transcript. A tab that opens mid-call catches up from here and
// then follows /api/events.
export const loader = () => Response.json({ calls: Call.recent() });
