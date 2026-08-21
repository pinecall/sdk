import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// server/app.ts is the production entry: the SSR build bundles it together with
// the routes, so the agent, the models and the pages share one module graph.
// The demo CRM lives one directory up (it is shared with the CLI example), so
// dev has to be allowed to read it; the build inlines it like any other import.
export default defineConfig(({ isSsrBuild }) => ({
  build: { rollupOptions: isSsrBuild ? { input: "./server/app.ts" } : undefined },
  server: { fs: { allow: [".."] } },
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
}));
