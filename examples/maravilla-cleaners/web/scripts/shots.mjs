/**
 * shots — what the front desk looks like, in both themes and on both sizes.
 *
 * Seven PNGs into web/docs/: desktop 1280 and phone 390, light and dark, plus a
 * desktop pair with a real chat conversation open, and the drawer on a phone (it types a question, waits
 * for the answer, and shoots the transcript). They are committed, so a review
 * can see the result without deploying anything.
 *
 *   node scripts/shots.mjs [origin]
 *
 * Default origin: https://maravilla.bernardocastro.dev
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const ORIGIN = (process.argv[2] ?? "https://maravilla.bernardocastro.dev").replace(/\/$/, "");
const OUT = new URL("../docs/", import.meta.url).pathname;
const SIZES = { desktop: { width: 1280, height: 860 }, mobile: { width: 390, height: 844 } };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function shot(name, { scheme, size, act }) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: SIZES[size], deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if (act) await act(page);
  await page.screenshot({ path: `${OUT}${name}.png` });
  await ctx.close();
  console.log(`  ✓ docs/${name}.png`);
}

/** Ask something the agent has to look up, so the shot has tools in it. */
const converse = async (page) => {
  const input = page.getByPlaceholder("Write a message");
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await input.fill("how much for a deep clean of a 3 bedroom, 2 bathroom house?");
  await input.press("Enter");
  await page.waitForTimeout(18_000);
};

for (const scheme of ["light", "dark"]) {
  await shot(`front-desk-${scheme}`, { scheme, size: "desktop" });
  await shot(`front-desk-${scheme}-mobile`, { scheme, size: "mobile" });
}
await shot("conversations-mobile-light", {
  scheme: "light",
  size: "mobile",
  act: async (page) => {
    await page.getByLabel("Open conversations").first().click();
    await page.waitForTimeout(500);
  },
});
await shot("conversation-light", { scheme: "light", size: "desktop", act: converse });
await shot("conversation-dark", { scheme: "dark", size: "desktop", act: converse });

await browser.close();
console.log("done");
