// The process entry. Dev: Vite serves and hot-reloads everything, including
// server/app.ts. Prod: the built bundle. Nothing else lives here.
import express from "express";

const PORT = Number(process.env.PORT ?? 3000);
const app = express();

if (process.env.NODE_ENV === "development") {
  const vite = await import("vite").then((v) => v.createServer({ server: { middlewareMode: true } }));
  app.use(vite.middlewares);
  await vite.ssrLoadModule("./server/app.ts"); // boot the agent now, not on the first request
  app.use(async (req, res, next) => {
    try {
      const mod = await vite.ssrLoadModule("./server/app.ts");
      return await mod.app(req, res, next);
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error);
      next(error);
    }
  });
} else {
  app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
  app.use(express.static("build/client", { maxAge: "1h" }));
  app.use(await import("./build/server/index.js").then((mod) => mod.app));
}

app.listen(PORT, () => console.log(`\n  ✨  http://localhost:${PORT}\n`));
