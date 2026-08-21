import { createRequestHandler } from "@react-router/express";
import express from "express";
import { remember } from "~/lib/remember.server";
import { startAgent } from "./agent/agent";

// One agent per process, even across dev hot-reloads.
export const agent = remember("agent", startAgent);

export const app = express();

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
  }),
);
