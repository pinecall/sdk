import { chromium } from "playwright";
const b = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ colorScheme: scheme, viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto("https://maravilla.bernardocastro.dev/", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${process.env.S}/mv-${scheme}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
console.log("ok");
