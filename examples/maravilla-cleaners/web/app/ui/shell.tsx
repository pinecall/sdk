import { useEffect, useState } from "react";
import { NavLink, useRouteLoaderData } from "react-router";

/** What the top bar needs, and the only thing the root loader is for. */
export type RootData = { name: string; phone: string | null };

const tab = ({ isActive }: { isActive: boolean }) =>
  `flex h-8 items-center whitespace-nowrap rounded-full px-3 text-[13px] transition ${
    isActive ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-ink-2 hover:text-ink"
  }`;

/**
 * The slim bar over every screen: who this is, where the agent can be reached,
 * the two routes, and the theme. On a phone it also carries the button that
 * opens the conversations drawer — the page owns that state, so it passes it in.
 */
export function TopBar({ onConversations }: { onConversations?: () => void }) {
  const root = useRouteLoaderData("root") as RootData | undefined;

  return (
    <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-5">
      {onConversations && (
        <button
          type="button"
          onClick={onConversations}
          aria-label="Open conversations"
          className="-ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 transition hover:bg-inset hover:text-ink lg:hidden"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}

      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[15px] tracking-tight">✨ {root?.name ?? "Maravilla Cleaners"}</span>
        <span className="hidden text-[13px] text-ink-3 sm:inline">Front desk</span>
      </span>

      <span className="flex-1" />

      {root?.phone && (
        <a
          href={`tel:${root.phone}`}
          className="mr-1 hidden items-center gap-1.5 rounded-full bg-inset px-3 py-1.5 text-[13px] tabular-nums text-ink-2 transition hover:text-ink md:inline-flex"
          title="The agent answers this number too"
        >
          <PhoneIcon /> {root.phone}
        </a>
      )}

      <nav className="flex shrink-0 gap-0.5 rounded-full bg-inset p-1">
        <NavLink to="/" end className={tab}>Front desk</NavLink>
        <NavLink to="/settings" className={tab}>Settings</NavLink>
      </nav>

      <ThemeToggle />
    </header>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="currentColor">
      <path d="M3.4 1.6a1.3 1.3 0 0 1 1.8.3l1 1.4c.3.5.3 1.1-.1 1.5l-.6.6c-.2.2-.2.4-.1.6.5 1 1.4 1.9 2.4 2.4.2.1.4 0 .6-.1l.6-.6c.4-.4 1-.4 1.5-.1l1.4 1c.6.4.7 1.2.3 1.8l-.5.6c-.5.6-1.3.9-2 .7-1.7-.4-3.3-1.4-4.6-2.7C4 8.3 3 6.7 2.6 5c-.2-.8.1-1.6.7-2z" />
    </svg>
  );
}

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const ICON: Record<Theme, string> = { system: "🖥", light: "☀", dark: "🌙" };

/** System by default; a click cycles system → light → dark and remembers it. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme((localStorage.getItem("theme") as Theme) ?? "system");
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
      className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-sm transition hover:bg-inset"
    >
      {ICON[theme]}
    </button>
  );
}
