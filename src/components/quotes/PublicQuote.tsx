import { useMemo, useState } from "react";
import { BMD, money, snapshotTotals, type SnapVersion } from "@/lib/quotes/logic";
import type { AcceptCheck, AcceptInput, Choices, PublicView } from "@/lib/quotes/public";

type Props = { view: PublicView; onSave: (choices: Choices) => void; onAccept: (input: AcceptInput) => Promise<AcceptCheck | { ok: true } | { ok: false; message: string; reload?: true }> };
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

/** The page a client sees from their private link. It is given only the client-safe quote, so there is nothing internal to hide. */
export function PublicQuote({ view, onSave, onAccept }: Props) {
  const snap = "snapshot" in view ? view.snapshot : null;
  const [choices, setChoices] = useState<Choices>("choices" in view ? view.choices : {});
  const [versionId, setVersionId] = useState(snap ? (view.state === "accepted" && "accepted" in view && view.accepted ? view.accepted.versionId : snap.versions.length === 1 ? snap.versions[0]!.id : "") : "");
  const [form, setForm] = useState({ name: "", email: "", agree: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rates = useMemo(() => ({ gstPct: snap?.gstPct ?? 5, hstPct: snap?.hstPct ?? 13 }), [snap]);

  if (!snap) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Quotation {view.number}</h1>
        <p className="mt-2 text-muted-foreground">
          {view.state === "replaced" ? "This quotation has been replaced by a newer one. Please use the latest link we sent you, or contact us." : "This quotation is no longer open. Please contact us if you have questions."}
        </p>
        <p className="mt-4 text-sm">{BMD.email}</p>
      </Shell>
    );
  }
  const locked = view.state === "accepted" || done;
  const choose = (next: Choices) => {
    setChoices(next);
    setMessage(null);
    onSave(next);
  };
  const revision = "revision" in view ? view.revision : 0;
  const version = snap.versions.find((v) => v.id === versionId) ?? null;
  // The first member of a choose-one group is shown selected until the client picks another, and is sent as their choice.
  const withDefaults = (v: SnapVersion): Choices => {
    const out = { ...choices };
    const seen = new Map<string, string[]>();
    for (const s of v.sections) for (const l of s.lines) if (l.selection === "choose_one") seen.set(l.group ?? l.id, [...(seen.get(l.group ?? l.id) ?? []), l.id]);
    for (const members of seen.values()) if (!members.some((m) => out[m] === "yes")) for (const m of members) out[m] = m === members[0] ? "yes" : "no";
    return out;
  };
  const totalsFor = (v: SnapVersion) => snapshotTotals(v, choices, rates);

  const accept = async () => {
    if (!version) return setMessage("Choose which option you are accepting.");
    if (!form.agree) return setMessage("Tick the box to confirm you accept the price, scope and terms.");
    setBusy(true);
    setMessage(null);
    try {
      const res = await onAccept({ versionId: version.id, choices: withDefaults(version), revision, expectedTotalCents: totalsFor(version).totalCents, name: form.name, email: form.email });
      if (res.ok) setDone(true);
      else setMessage(res.message);
    } catch {
      setMessage("Your acceptance could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <img src="/bmd-logo.png" alt="BMD Materials" className="h-10" />
          <p className="mt-2 text-xs text-muted-foreground">{BMD.mailing}</p>
          <p className="text-xs text-muted-foreground">{BMD.email}</p>
        </div>
        <div className="text-right">
          <h1 className="text-xl font-semibold">{snap.number.startsWith("CO-") ? "Change order" : "Quotation"} {snap.number}</h1>
          <p className="text-sm text-muted-foreground">{day(snap.date)} · valid {snap.validityDays} days</p>
          <p className="text-sm text-muted-foreground">Prepared by {snap.preparedBy.name}</p>
        </div>
      </header>
      <section className="grid gap-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Prepared for</p>
          <p className="font-medium">{snap.client.name}</p>
          {snap.client.address && <p className="text-sm text-muted-foreground">{snap.client.address}</p>}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Project</p>
          <p className="font-medium">{snap.project.name}</p>
          {snap.project.address && <p className="text-sm text-muted-foreground">{snap.project.address}</p>}
        </div>
      </section>

      {(view.state === "accepted" || done) && (
        <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {view.state === "accepted" && view.accepted ? `Accepted by ${view.accepted.name} on ${day(view.accepted.at)}. Total $${money(view.accepted.totalCents)}.` : "Thank you. Your acceptance has been recorded and we will be in touch to schedule the work."}
        </p>
      )}

      {snap.versions.map((v) => {
        const t = totalsFor(v);
        const many = snap.versions.length > 1;
        const groups = new Map<string, string[]>();
        for (const s of v.sections) for (const l of s.lines) if (l.selection === "choose_one") groups.set(l.group ?? l.id, [...(groups.get(l.group ?? l.id) ?? []), l.id]);
        return (
          <section key={v.id} className={`mb-6 rounded-lg border p-4 ${versionId === v.id && many ? "border-primary ring-1 ring-primary" : "border-border"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {many ? (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="radio" name="option" className="h-5 w-5" disabled={locked} checked={versionId === v.id} onChange={() => setVersionId(v.id)} />
                    {v.name}
                  </label>
                ) : (
                  "Scope of work"
                )}
              </h2>
              <p className="text-lg font-semibold tabular-nums">${money(t.totalCents)}</p>
            </div>
            {v.description && <p className="text-sm text-muted-foreground">{v.description}</p>}
            {v.sections.map((s) => (
              <div key={s.name} className="mt-3">
                <div className="flex justify-between border-b border-border pb-1 text-sm font-medium">
                  <h3>{s.name}</h3>
                  {snap.presentation !== "lump_sum" && <span className="tabular-nums">${money(t.sectionCents[s.name] ?? 0)}</span>}
                </div>
                <ul>
                  {s.lines.map((l) => {
                    const showPrice = snap.presentation === "itemised" || l.selection !== "required";
                    const members = l.selection === "choose_one" ? (groups.get(l.group ?? l.id) ?? []) : [];
                    const picked = l.selection === "choose_one" && withDefaults(v)[l.id] === "yes";
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 py-2 text-sm">
                        <span className="min-w-0 flex-1">
                          {l.description}
                          {l.uom !== "LS" && <span className="text-muted-foreground"> · {l.qty.toLocaleString("en-CA", { maximumFractionDigits: 2 })} {l.uom}</span>}
                          {l.allowance && <span className="text-muted-foreground"> · allowance</span>}
                          {l.subjectToMeasure && <span className="text-muted-foreground"> · subject to final measure</span>}
                        </span>
                        {l.selection === "optional" && (
                          <span role="group" aria-label={`${l.description}: include?`} className="flex overflow-hidden rounded-md border border-input">
                            {(["yes", "no", "maybe"] as const).map((c) => (
                              <button key={c} type="button" disabled={locked} aria-pressed={choices[l.id] === c} onClick={() => choose({ ...choices, [l.id]: c })} className={`min-h-10 px-3 text-sm capitalize ${choices[l.id] === c ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                                {c}
                              </button>
                            ))}
                          </span>
                        )}
                        {l.selection === "choose_one" && (
                          <label className="flex min-h-10 cursor-pointer items-center gap-2">
                            <input type="radio" name={`${v.id}-${l.group ?? l.id}`} className="h-5 w-5" disabled={locked} checked={picked} onChange={() => choose({ ...choices, ...Object.fromEntries(members.map((m) => [m, m === l.id ? "yes" : "no"])) })} />
                            <span className="text-muted-foreground">{l.group ?? "Choose one"}</span>
                          </label>
                        )}
                        {showPrice && <span className="w-28 text-right tabular-nums">${money(l.sellCents)}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <dl className="mt-3 ml-auto w-full max-w-xs text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">${money(t.subtotalCents)}</dd></div>
              <div className="flex justify-between"><dt>GST {snap.gstPct}%</dt><dd className="tabular-nums">${money(t.taxCents)}</dd></div>
              <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">${money(t.totalCents)}</dd></div>
              {t.maybeCents > 0 && <p className="mt-1 text-xs text-muted-foreground">Items marked Maybe (${money(t.maybeCents)} before GST) are not in this total.</p>}
            </dl>
          </section>
        );
      })}

      {[["Inclusions", snap.inclusions], ["Exclusions", snap.exclusions], ["Clarifications", snap.clarifications], ["Terms", snap.terms]].map(([title, items]) =>
        (items as string[]).length ? (
          <section key={title as string} className="mb-4">
            <h2 className="font-semibold">{title as string}</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {(items as string[]).map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      {!locked && (
        <section className="mt-6 rounded-lg border border-border p-4">
          <h2 className="font-semibold">Accept this quotation</h2>
          {version && <p className="mt-1 text-sm">You are accepting{snap.versions.length > 1 ? ` ${version.name}` : ""} for a total of <strong className="tabular-nums">${money(totalsFor(version).totalCents)}</strong> including GST.</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Full name
              <input className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="text-sm font-medium">
              Email
              <input type="email" className="mt-1 block h-11 w-full rounded-md border border-input bg-background px-3" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} />
            <span>I accept the price, scope and terms shown above. Typing my name here is my signature.</span>
          </label>
          {message && <p role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{message}</p>}
          <button type="button" disabled={busy} onClick={() => void accept()} className="mt-3 min-h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Sending…" : "Accept quotation"}
          </button>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl bg-background p-4 text-foreground sm:p-8">{children}</main>;
}
