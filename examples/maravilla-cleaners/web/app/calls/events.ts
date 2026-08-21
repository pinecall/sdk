import type { Route } from "./+types/events";
import { bus, TOPICS } from "~/lib/bus.server";

// GET /api/events — Server-Sent Events: everything on the bus, as it happens.
export const loader = ({ request }: Route.LoaderArgs) => {
  const encoder = new TextEncoder();
  let stop = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop(); // the tab is gone and the stream already closed under us
        }
      };
      // A tab that just opened learns the stream is alive before anything
      // happens on it — and a proxy that buffers is caught by the smoke test.
      send("hello", { at: Date.now() });
      const listeners = TOPICS.map((topic) => [topic, (data: unknown) => send(topic, data)] as const);
      for (const [topic, fn] of listeners) bus.on(topic, fn);
      const ping = setInterval(() => send("ping", Date.now()), 25_000);

      stop = () => {
        clearInterval(ping);
        for (const [topic, fn] of listeners) bus.off(topic, fn);
        try { controller.close(); } catch { /* already closed */ }
      };
      // A closed tab reaches us either way: as an aborted request or as a cancelled stream.
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
};
