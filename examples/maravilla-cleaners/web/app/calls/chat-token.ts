import { createToken } from "@pinecall/sdk";
import { AGENT } from "~/lib/agent-id.server";

// POST /api/chat-token — the same thing for the text chat channel.
export const action = async () =>
  Response.json(
    await createToken({
      channel: "chat",
      agentId: AGENT,
      apiKey: process.env.PINECALL_API_KEY!,
      metadata: { source: "web" },
    }),
  );
