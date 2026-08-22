import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { Settings } from "~/settings/model.server";
import "./app.css";

// The two things every screen's top bar needs. Kept here so both routes read
// the same source, and so renaming the company in Settings refreshes the bar.
export const loader = () => ({
  name: Settings.get().name,
  phone: process.env.PHONE ?? null,
});

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <title>Maravilla Cleaners · Front desk</title>
        {/* Inline, so the browser never asks for a /favicon.ico this app has no route for. */}
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%E2%9C%A8%3C/text%3E%3C/svg%3E" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        <Meta />
        <Links />
        {/* Before first paint: apply the saved choice, or the OS preference. No flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      {/* The app is a screen, not a document: each route owns its own scrolling. */}
      <body className="h-full overflow-hidden">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const THEME_BOOT = `(()=>{try{var t=localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})()`;

export default function App() {
  return <Outlet />;
}
