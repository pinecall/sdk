import { index, prefix, route, type RouteConfig } from "@react-router/dev/routes";

// The whole surface of the app, URL → file. Pages render; api routes answer JSON.
export default [
  index("calls/page.tsx"),
  route("settings", "settings/page.tsx"),

  ...prefix("api", [
    route("settings", "settings/api.ts"),
    route("bookings", "bookings/api.ts"),
    route("calls", "calls/api.ts"),
    route("events", "calls/events.ts"),
    route("token", "calls/token.ts"),
    route("chat-token", "calls/chat-token.ts"),
  ]),
] satisfies RouteConfig;
