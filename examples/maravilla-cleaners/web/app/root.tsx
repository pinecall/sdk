import { useEffect, useState } from "react";
import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./app.css";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3.5 py-1.5 text-sm transition ${isActive ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"}`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>Maravilla Cleaners · Front desk</title>
        {/* Inline, so the browser never asks for a /favicon.ico this app has no route for. */}
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%A8%3C/text%3E%3C/svg%3E" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap" rel="stylesheet" />
        <Meta />
        <Links />
        {/* Before first paint: apply the saved choice, or the OS preference. No flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-full">
        <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-6">
          <span className="text-sm tracking-tight">✨ Maravilla Cleaners</span>
          <nav className="flex gap-1 rounded-full bg-neutral-200/60 p-1 dark:bg-neutral-800/60">
            <NavLink to="/" end className={link}>Front desk</NavLink>
            <NavLink to="/settings" className={link}>Settings</NavLink>
          </nav>
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-3xl px-6 pb-24">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const THEME_BOOT = `(()=>{try{var t=localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})()`;

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const ICON: Record<Theme, string> = { system: "🖥", light: "☀", dark: "🌙" };

/** System by default; a click cycles system → light → dark and remembers it. */
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(((localStorage.getItem("theme") as Theme) ?? "system"));
  }, []);

  const apply = (next: Theme) => {
    localStorage.setItem("theme", next);
    setTheme(next);
    const dark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  // While on "system", follow the OS if it changes under us.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      document.documentElement.classList.toggle("dark", mq.matches);
      document.documentElement.style.colorScheme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => apply(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!)}
      title={`Theme: ${theme} — click to change`}
      aria-label={`Theme: ${theme}`}
      className="rounded-full bg-neutral-200/60 px-3 py-1.5 text-sm transition hover:bg-neutral-300/60 dark:bg-neutral-800/60 dark:hover:bg-neutral-700/60"
    >
      {ICON[theme]}
    </button>
  );
}

export default function App() {
  return <Outlet />;
}
