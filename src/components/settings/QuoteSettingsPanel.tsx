import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { db, errText } from "@/lib/platform/db";
import { companyLines, companyOf, fitLogo, type Branding } from "@/lib/quotes/branding";
import { useClauses, type Clause } from "@/lib/quotes/data";
import { prepareLogo, saveBranding, saveLogo, useQuoteSettings } from "@/lib/quotes/settings";

const KINDS: { kind: Clause["kind"]; label: string }[] = [
  { kind: "inclusion", label: "Inclusions" },
  { kind: "exclusion", label: "Exclusions" },
  { kind: "clarification", label: "Clarifications" },
];

/** Everything that is the same on every quote: logo, company details, footer, notes, short terms, the conditions page and the clause library. */
export function QuoteSettingsPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuoteSettings();
  const [form, setForm] = useState<Branding | null>(null);
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data && !form) {
      setForm(data.branding);
      setTerms(data.branding.shortTerms.join("\n"));
    }
  }, [data, form]);

  if (error) return <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The quote settings could not be loaded: {errText(error)}</p>;
  if (isLoading || !form || !data) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const current: Branding = { ...form, shortTerms: terms.split("\n").map((t) => t.trim()).filter(Boolean) };
  const dirty = JSON.stringify(current) !== JSON.stringify(data.branding);
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setForm({ ...form, [k]: v });
  const refresh = () => qc.invalidateQueries({ queryKey: ["quote-settings"] });
  const save = async () => {
    if (!current.companyName.trim()) {
      toast.error("Enter the company name.");
      return;
    }
    setBusy(true);
    try {
      await saveBranding(current);
      await refresh();
      toast.success("Quote settings saved. New and draft quotes use them straight away.");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      await saveLogo(await prepareLogo(f));
      await refresh();
      toast.success("Logo saved.");
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };
  const logoSize = data.logo ? fitLogo(data.logo.width, data.logo.height, 170, 54) : null;
  const text = (label: string, key: "companyName" | "phone" | "email" | "website" | "gstNumber" | "businessNumber" | "hours" | "termsTitle", o: { max: number; placeholder?: string; type?: string } = { max: 200 }) => (
    <label className="block text-sm font-medium">
      {label}
      <Input className="mt-1" type={o.type ?? "text"} maxLength={o.max} placeholder={o.placeholder} value={form[key]} onChange={(e) => set(key, e.target.value)} />
    </label>
  );
  const area = (label: string, key: "officeAddress" | "mailingAddress" | "footer" | "defaultNotes" | "termsText", o: { max: number; rows: number; hint?: string; placeholder?: string }) => (
    <label className="block text-sm font-medium">
      {label}
      <Textarea className="mt-1" rows={o.rows} maxLength={o.max} placeholder={o.placeholder} value={form[key]} onChange={(e) => set(key, e.target.value)} />
      {o.hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{o.hint}</span>}
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Logo</h2>
        <p className="mt-1 text-sm text-muted-foreground">Shown at the top of every quote and on the client's quote page. PNG or JPEG. A wide logo on a white or transparent background prints best.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <div className="flex h-20 w-52 items-center justify-center rounded-md border border-border bg-white p-2">
            {data.logo && logoSize ? <img src={data.logo.dataUrl} alt="Current quote logo" style={{ width: logoSize.width, height: logoSize.height }} /> : <img src="/bmd-logo.png" alt="Built-in BMD logo" className="max-h-14 max-w-[11rem] object-contain" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg" className="sr-only" id="quote-logo-file" onChange={(e) => void upload(e.target.files?.[0])} />
            <Button asChild variant="outline" disabled={busy}>
              <label htmlFor="quote-logo-file" className="cursor-pointer">{data.logo ? "Replace logo" : "Upload a logo"}</label>
            </Button>
            {data.logo && (
              <Button variant="ghost" disabled={busy} onClick={() => void saveLogo(null).then(refresh, (e) => toast.error(errText(e)))}>
                Use the built-in logo
              </Button>
            )}
          </div>
        </div>
        {!data.logo && <p className="mt-2 text-xs text-muted-foreground">No logo uploaded yet, so quotes use the built-in BMD logo.</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Company details</h2>
        <p className="mt-1 text-sm text-muted-foreground">Printed under the logo on every quote. Leave a box blank to leave that line off.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {text("Company name", "companyName")}
          {text("GST registration number", "gstNumber", { max: 100, placeholder: "e.g. 123456789 RT0001" })}
          {area("Office address", "officeAddress", { max: 500, rows: 2, placeholder: "Street, city, province, postal code" })}
          {area("Mailing address", "mailingAddress", { max: 500, rows: 2 })}
          {text("Phone", "phone", { max: 100, type: "tel" })}
          {text("Email", "email", { max: 320, type: "email" })}
          {text("Website", "website", { max: 200 })}
          {text("Business number (not printed)", "businessNumber", { max: 100, placeholder: "e.g. 123456789" })}
          {text("Hours (not printed)", "hours", { max: 400, placeholder: "e.g. Mon–Fri 7:30–4:30" })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">On the quote this reads: {companyLines(companyOf(current)).join("  |  ") || "nothing yet"}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Footer and notes</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {area("Footer (at the bottom of every page)", "footer", { max: 400, rows: 3, hint: "Up to two printed lines. The quote number and page number are always added underneath.", placeholder: "e.g. Thank you for the opportunity to quote." })}
          {area("Standard notes (the starting notes on each new quote)", "defaultNotes", { max: 4000, rows: 3, hint: "Each new quote starts with these. They can be changed or cleared on the quote itself." })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-semibold">Terms</h2>
        <label className="mt-3 block text-sm font-medium">
          Short terms (listed under the price on page one, one per line)
          <Textarea className="mt-1" rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">The quote adds its own first two lines: how long the price is valid, and the deposit.</span>
        </label>
        <div className="mt-4 grid gap-3">
          {text("Title of the terms and conditions page", "termsTitle", { max: 120 })}
          {area("Standard terms and conditions", "termsText", {
            max: 40000,
            rows: 16,
            hint: "Printed on its own page straight after the quote (page two of a one-page quote) and shown on the client's quote page. A short line in CAPITALS prints as a heading. Leave blank and no conditions page is printed.",
            placeholder: "Paste your standard terms and conditions here.",
          })}
        </div>
      </section>

      <div className="sticky bottom-24 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card p-3 shadow-sm md:bottom-2">
        <Button disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save quote settings"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">{dirty ? "You have changes that are not saved." : "All changes saved."} Quotes already sent keep the details they were sent with.</p>
      </div>

      <ClauseLibrary />
    </div>
  );
}

/** The wording offered as tick boxes on every quote. Ticked "on new quotes" means a new quote starts with it. */
function ClauseLibrary() {
  const qc = useQueryClient();
  const { data: clauses = [] } = useClauses();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["quote-clauses"] });
  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q;
    if (error) toast.error(error.message);
    else void refresh();
  };
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Inclusions, exclusions and clarifications</h2>
      <p className="mt-1 text-sm text-muted-foreground">The standard wording offered as tick boxes on each quote. Changing it here does not change quotes already prepared.</p>
      {KINDS.map(({ kind, label }) => (
        <fieldset key={kind} className="mt-4">
          <legend className="text-sm font-medium">{label}</legend>
          <ul className="mt-1 space-y-2">
            {clauses.filter((c) => c.kind === kind).map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-2">
                <Textarea aria-label={`${label}: wording`} className="min-h-10 flex-1 basis-64" rows={2} defaultValue={c.body} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.body && void run(db.from("quote_clauses").update({ body: e.target.value.trim() }).eq("id", c.id))} />
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={c.is_default} onChange={(e) => void run(db.from("quote_clauses").update({ is_default: e.target.checked }).eq("id", c.id))} />
                  On new quotes
                </label>
                <Button variant="ghost" size="sm" className="min-h-10" onClick={() => void run(db.from("quote_clauses").update({ active: false }).eq("id", c.id))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input aria-label={`Add to ${label.toLowerCase()}`} className="flex-1 basis-64" placeholder={`Add to ${label.toLowerCase()}…`} value={draft[kind] ?? ""} onChange={(e) => setDraft({ ...draft, [kind]: e.target.value })} />
            <Button
              variant="outline"
              disabled={!(draft[kind] ?? "").trim()}
              onClick={() => {
                const body = (draft[kind] ?? "").trim();
                setDraft({ ...draft, [kind]: "" });
                void run(db.from("quote_clauses").insert({ kind, body, is_default: false, sort_order: Math.max(0, ...clauses.map((c) => c.sort_order)) + 10 }));
              }}
            >
              Add
            </Button>
          </div>
        </fieldset>
      ))}
    </section>
  );
}
