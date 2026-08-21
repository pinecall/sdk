// The slug this process owns: `maravilla` in production, `dev-maravilla` on a
// laptop. One name, read in three places (the agent, both token routes).
export const AGENT = process.env.AGENT_SLUG || "maravilla";
