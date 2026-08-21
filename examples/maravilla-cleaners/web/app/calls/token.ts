import { createToken } from "@pinecall/sdk";
import { AGENT } from "~/lib/agent-id.server";

// POST /api/token — a short-lived WebRTC token for the browser. The API key stays here.
export const action = async () =>
  Response.json(
    await createToken({
      channel: "webrtc",
      agentId: AGENT,
      apiKey: process.env.PINECALL_API_KEY!,
      metadata: { source: "web" },
    }),
  );
