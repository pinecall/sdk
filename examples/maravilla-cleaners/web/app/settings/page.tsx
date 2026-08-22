import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/page";
import { Settings } from "./model.server";

export const loader = () => Settings.get();
export const action = async ({ request }: Route.ActionArgs) =>
  Settings.update(Object.fromEntries(await request.formData()));

// `pinecall voices --language en` lists the catalogue.
const VOICES = {
  "elevenlabs/sarah": "Sarah · warm, clear (ElevenLabs)",
  "cartesia/sonic": "Sonic · quick, neutral",
  "elevenlabs/jessica": "Jessica · playful, warm",
  "elevenlabs/sarah": "Sarah · mature, reassuring",
  "elevenlabs/bella": "Bella · professional, bright",
  "elevenlabs/eric": "Eric · smooth, trustworthy",
};
const LANGUAGES = { en: "English", es: "Español", pt: "Português" };

const field = "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[15px] outline-none transition focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus:border-neutral-600";

export default function SettingsPage({ loaderData: s, actionData }: Route.ComponentProps) {
  const saving = useNavigation().state === "submitting";

  return (
    <Form method="post" className="space-y-8">
      <div>
        <h1 className="text-2xl tracking-tight">{s.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">Applied instantly. The next call is born with these settings.</p>
      </div>

      <div className="space-y-5">
        <Field label="Name"><input name="name" defaultValue={s.name} className={field} /></Field>
        <Field label="Greeting" hint="the first sentence of every call"><textarea name="greeting" rows={2} defaultValue={s.greeting} className={field} /></Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Voice">
            <select name="voice" defaultValue={s.voice} className={field}>
              {Object.entries(VOICES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="Language">
            <select name="language" defaultValue={s.language} className={field}>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Hours"><textarea name="hours" rows={2} defaultValue={s.hours} className={field} /></Field>
        <Field label="Services" hint="one per line"><textarea name="services" rows={5} defaultValue={s.services} className={field} /></Field>
        <Field label="Notes"><textarea name="notes" rows={2} defaultValue={s.notes} className={field} /></Field>
      </div>

      <div className="flex items-center gap-4">
        <button disabled={saving} className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
          {saving ? "Saving…" : "Save"}
        </button>
        {actionData && <span className="text-sm text-neutral-500">Applied</span>}
      </div>

      <p className="text-sm text-neutral-400">
        What the agent knows about the company comes from the knowledge base tapped from
        maravillacleaners.com. Prices, crews and availability come from a demo CRM — the model,
        the STT provider and the six tools live in <code className="text-xs">server/agent/</code>.
      </p>
    </Form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-neutral-600 dark:text-neutral-400">
        {label}{hint && <span className="text-neutral-400 dark:text-neutral-500"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
