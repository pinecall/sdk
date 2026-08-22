import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/page";
import { Settings } from "./model.server";
import { TopBar } from "~/ui/shell";

export const loader = () => Settings.get();
export const action = async ({ request }: Route.ActionArgs) =>
  Settings.update(Object.fromEntries(await request.formData()));

// ElevenLabs is the only TTS this demo speaks with. The aliases come from
// GET /v1/audio/voices?provider=elevenlabs&language=en (`pinecall voices
// --language en` lists the same catalogue).
const VOICES = {
  "elevenlabs/sarah": "Sarah · mature, reassuring",
  "elevenlabs/jessica": "Jessica · playful, warm",
  "elevenlabs/eric": "Eric · smooth, trustworthy",
};
const LANGUAGES = { en: "English", es: "Español", pt: "Português" };

const field =
  "w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-[15px] outline-none transition placeholder:text-ink-3 focus:border-line-2";

export default function SettingsPage({ loaderData: s, actionData }: Route.ComponentProps) {
  const saving = useNavigation().state === "submitting";

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <TopBar />
      <div className="scroller min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-6">
        <Form method="post" className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-[22px] tracking-tight">Front desk settings</h1>
            <p className="mt-1 text-[14px] text-ink-2">Applied instantly. The next call is born with these settings.</p>
          </div>

          <div className="space-y-5 rounded-2xl border border-line bg-surface p-5">
            <Field label="Name"><input name="name" defaultValue={s.name} className={field} /></Field>
            <Field label="Greeting" hint="the first sentence of every call">
              <textarea name="greeting" rows={2} defaultValue={s.greeting} className={field} />
            </Field>

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
            <button
              disabled={saving}
              className="h-11 rounded-xl bg-accent px-5 text-[14px] font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {actionData && <span className="text-[13px] text-ink-2">Applied</span>}
          </div>

          <p className="text-[13px] leading-relaxed text-ink-3">
            What the agent knows about the company comes from the knowledge base tapped from
            maravillacleaners.com. Prices, crews and availability come from a demo CRM — the model,
            the STT provider and the six tools live in <code className="text-[12px]">server/agent/</code>.
          </p>
        </Form>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] text-ink-2">
        {label}{hint && <span className="text-ink-3"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}
