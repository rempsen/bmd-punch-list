import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { useCostCodes } from "@/lib/catalogue/data";
import { drawingFiles, measuredSheets as sheetsMeasured, sheetLabel, sheetMarks, type TakeoffDoc } from "@/lib/takeoff/marked";
import { finishLinks, totalsByFinish, useTakeoffQuantities } from "@/lib/takeoff/quantities";
import { buildQboEstimate } from "@/lib/qbo/estimate";
import { signedUrl } from "@/lib/documents/upload";
import { createVersion, dollars, useEstimate } from "@/lib/estimating/data";
import { db, errText } from "@/lib/platform/db";
import { acceptQuote, createQuote, declineQuote, deleteQuote, reviseQuote, updateQuote, useClauses, useQuotes, useRefreshQuotes, type Clause, type QuotePatch } from "@/lib/quotes/data";
import { loadQuoteContext, snapshotFingerprint, type QuoteRow } from "@/lib/quotes/load";
import { contractValue, normalizeDisplay, type Presentation } from "@/lib/quotes/logic";
import { renderQuotePdf } from "@/lib/quotes/pdf";
import { createQuoteLink } from "@/lib/quotes/public.functions";
import { issueQuote } from "@/lib/quotes/quotes.functions";
import { loadLogo, useQuoteSettings } from "@/lib/quotes/settings";

const STATUS: Record<QuoteRow["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-900" },
  accepted: { label: "Accepted", cls: "bg-emerald-100 text-emerald-900" },
  declined: { label: "Declined", cls: "bg-red-100 text-red-900" },
  superseded: { label: "Superseded", cls: "bg-muted text-muted-foreground" },
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "");
const field = "h-10 rounded-md border border-input bg-background px-2 text-sm";

function usePreparer() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["preparer", user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await db.from("profiles").select("full_name,email").eq("id", user!.id).maybeSingle();
      const p = data as { full_name: string | null; email: string | null } | null;
      return { name: p?.full_name || p?.email || user!.email || "BMD Materials", email: p?.email ?? user!.email ?? "" };
    },
  });
}

/** Quotes and change orders for one project, with the contract value they add up to. */
export function QuotesTab({ projectId }: { projectId: string }) {
  const { canAny } = useAuth();
  const canSee = canAny("view_pricing");
  const canSend = canAny("send_quotes");
  const canEstimate = canAny("manage_estimates");
  const { data: quotes = [], isLoading, error } = useQuotes(projectId, canSee);
  const { data: versions = [] } = useEstimate(projectId, canSee);
  const refresh = useRefreshQuotes(projectId);
  const [picking, setPicking] = useState<"quote" | "change_order" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ quote: QuoteRow; action: "accept" | "decline" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ number: string; url: string } | null>(null);
  const [rolling, setRolling] = useState<QuoteRow | null>(null);
  const makeLink = useServerFn(createQuoteLink);

  if (!canSee) return <p className="text-sm text-muted-foreground">You don't have access to pricing on this project.</p>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Could not load quotes: {errText(error)}</p>;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast.success(done);
      refresh();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const value = contractValue(quotes);
  const hasContract = quotes.some((q) => q.kind === "quote" && q.status === "accepted");
  const choices = versions.filter((v) => (picking === "change_order" ? v.kind === "change_order" : v.kind === "estimate") && v.status !== "accepted" && v.lines.length > 0);
  const draft = quotes.find((q) => q.id === editing && q.status === "draft") ?? null;
  const openPdf = (q: QuoteRow) =>
    run(async () => {
      const { data } = await db.from("project_documents").select("storage_path").eq("id", q.document_id!).maybeSingle();
      const path = (data as { storage_path: string } | null)?.storage_path;
      if (!path) throw new Error("The filed PDF is no longer there.");
      window.open(await signedUrl(path), "_blank", "noopener");
    });

  return (
    <div className="space-y-4">
      {hasContract && (
        <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-4">
          {[
            ["Original contract", value.originalCents],
            ["Accepted change orders", value.changeOrdersCents],
            ["Current contract", value.currentCents],
            ["Change orders awaiting reply", value.pendingCents],
          ].map(([label, cents]) => (
            <div key={label as string}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{dollars(cents as number)}</dd>
            </div>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">Before GST.</p>
        </dl>
      )}

      {canSend && (
        <div className="flex flex-wrap gap-2">
          {!hasContract && (
            <Button
              disabled={busy}
              onClick={() => {
                setPicked(new Set(versions.filter((v) => v.kind === "estimate" && v.lines.length > 0).map((v) => v.id)));
                setPicking("quote");
              }}
            >
              New quote
            </Button>
          )}
          {hasContract && canEstimate && (
            <Button disabled={busy} onClick={() => void run(() => createVersion(projectId, "", "change_order"), "Change order added. Price it on the Estimate tab, then quote it here.")}>
              New change order
            </Button>
          )}
          {hasContract && versions.some((v) => v.kind === "change_order" && v.status === "draft" && v.lines.length > 0) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPicked(new Set());
                setPicking("change_order");
              }}
            >
              Quote a change order
            </Button>
          )}
        </div>
      )}

      {quotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="font-medium">No quotes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Price the job on the{" "}
            <Link to="/projects/$id" params={{ id: projectId }} search={{ tab: "estimate" }} className="underline">
              Estimate tab
            </Link>
            , then start a quote here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {[...quotes].reverse().map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {q.number}
                  <span className={`ml-2 rounded px-1.5 py-0.5 text-xs font-normal ${STATUS[q.status].cls}`}>{STATUS[q.status].label}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {q.status === "draft" ? `Started ${day(q.created_at)}` : `Sent ${day(q.sent_at)}${q.recipients.length ? ` to ${q.recipients.join(", ")}` : " (no email)"}`}
                  {q.status === "accepted" && ` · accepted ${day(q.accepted_at)}`}
                  {q.decision_note && ` · ${q.decision_note}`}
                </p>
              </div>
              <p className="tabular-nums">{q.status === "accepted" ? dollars(q.accepted_value_cents ?? 0) : q.value_cents != null ? dollars(q.value_cents) : ""}</p>
              <div className="flex flex-wrap gap-2">
                {q.document_id && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void openPdf(q)}>
                    Open PDF
                  </Button>
                )}
                {canSend && q.status === "draft" && (
                  <>
                    <Button size="sm" onClick={() => setEditing(q.id)}>
                      Prepare and send
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Delete draft ${q.number}?`) && void run(() => deleteQuote(q.id))}>
                      Delete
                    </Button>
                  </>
                )}
                {canSend && q.status === "sent" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const { data: live } = await db.from("quote_share_links").select("id").eq("quote_id", q.id).is("revoked_at", null).limit(1);
                          if ((live ?? []).length > 0 && !window.confirm(`${q.number} already has a client link. Making a new one switches the old link off, so anyone you sent it to will see "not available". Make a new link?`)) return;
                          const { token } = await makeLink({ data: { quoteId: q.id } });
                          setShared({ number: q.number, url: `${window.location.origin}/q/${token}` });
                        })
                      }
                    >
                      Client link
                    </Button>
                    <Button size="sm" onClick={() => setDeciding({ quote: q, action: "accept" })}>
                      Mark accepted
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ quote: q, action: "decline" })}>
                      Declined
                    </Button>
                  </>
                )}
                {q.rollup && q.snapshot && (q.status === "sent" || q.status === "accepted") && (
                  <Button size="sm" variant="outline" onClick={() => setRolling(q)}>
                    QuickBooks roll-up
                  </Button>
                )}
                {q.status === "accepted" && q.snapshot && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const { data } = await db.from("quote_acceptances").select("name,email,accepted_at,version_id,choices,total_cents").eq("quote_id", q.id).order("accepted_at", { ascending: false }).limit(1).maybeSingle();
                        const a = data as { name: string; email: string; accepted_at: string; version_id: string; choices: Record<string, string>; total_cents: number } | null;
                        if (!a) throw new Error("This quote was marked accepted by staff, so there is no online acceptance record.");
                        renderQuotePdf(q.snapshot!, { logo: await loadLogo(), acceptance: { name: a.name, email: a.email, at: a.accepted_at, versionId: a.version_id, choices: a.choices, totalCents: a.total_cents } }).save(`${q.number} - accepted.pdf`);
                      })
                    }
                  >
                    Acceptance record
                  </Button>
                )}
                {canSend && (q.status === "sent" || q.status === "declined") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => window.confirm(`Revise ${q.number}? It is kept on record as superseded and its prices unlock for changes.`) && void run(() => reviseQuote(q.id), "Prices unlocked. Change the estimate, then send the new revision.")}
                  >
                    Revise
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && (
        <Dialog open onOpenChange={(o) => !o && setPicking(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{picking === "quote" ? "Which prices go on this quote?" : "Which change order?"}</DialogTitle>
              <DialogDescription>{picking === "quote" ? "More than one price is shown to the client as options to choose from." : "A change order is quoted on its own."}</DialogDescription>
            </DialogHeader>
            {choices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is priced yet. Add lines on the Estimate tab first.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {choices.map((v) => (
                  <li key={v.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type={picking === "quote" ? "checkbox" : "radio"}
                        name="quote-version"
                        className="h-4 w-4"
                        checked={picked.has(v.id)}
                        onChange={(e) => {
                          const next = new Set(picking === "quote" ? picked : []);
                          if (e.target.checked) next.add(v.id);
                          else next.delete(v.id);
                          setPicked(next);
                        }}
                      />
                      <span className="font-medium">{v.name}</span>
                      {v.description && <span className="truncate text-xs text-muted-foreground">{v.description}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPicking(null)}>
                Cancel
              </Button>
              <Button
                disabled={picked.size === 0 || busy}
                onClick={() =>
                  void run(async () => {
                    const id = await createQuote(projectId, versions.filter((v) => picked.has(v.id)).map((v) => v.id));
                    setPicking(null);
                    setEditing(id);
                  })
                }
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {shared && (
        <Dialog open onOpenChange={(o) => !o && setShared(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Private link for {shared.number}</DialogTitle>
              <DialogDescription>Anyone with this link can view the quote and accept it, without signing in. Send it only to your client. It is shown once: creating a new link switches this one off.</DialogDescription>
            </DialogHeader>
            <Input readOnly value={shared.url} onFocus={(e) => e.target.select()} aria-label="Client link" />
            <DialogFooter>
              <Button variant="ghost" onClick={() => void run(async () => { const { error } = await db.rpc("revoke_quote_link", { _quote: quotes.find((x) => x.number === shared.number)!.id }); if (error) throw new Error(error.message); setShared(null); }, "Link switched off.")}>
                Switch this link off
              </Button>
              <Button onClick={() => void navigator.clipboard.writeText(shared.url).then(() => toast.success("Link copied."), () => toast.error("Copy it from the box instead."))}>Copy link</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {rolling && <RollupDialog quote={rolling} projectId={projectId} onClose={() => setRolling(null)} />}
      {draft && <QuoteEditor quote={draft} onClose={() => setEditing(null)} onChanged={refresh} />}
      {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} onDone={refresh} />}
    </div>
  );
}

function DecisionDialog({ quote, action, onClose, onDone }: { quote: QuoteRow; action: "accept" | "decline"; onClose: () => void; onDone: () => void }) {
  const options = quote.snapshot?.versions ?? [];
  const [versionId, setVersionId] = useState(options.length === 1 ? options[0]!.id : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (action === "accept") await acceptQuote(quote.id, versionId, note.trim() || null);
      else await declineQuote(quote.id, note.trim() || null);
      toast.success(action === "accept" ? (quote.kind === "quote" ? "Accepted. The project is now Won." : "Change order accepted.") : "Recorded as declined.");
      onDone();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{action === "accept" ? `Client accepted ${quote.number}` : `Client declined ${quote.number}`}</DialogTitle>
          <DialogDescription>{action === "accept" ? "The accepted price becomes part of the contract value and stays locked." : "The quote is kept on record. Revise it to send a new price."}</DialogDescription>
        </DialogHeader>
        {action === "accept" && options.length > 1 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">Which price did they accept?</legend>
            {options.map((v) => (
              <label key={v.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                <input type="radio" name="accepted" className="h-4 w-4" checked={versionId === v.id} onChange={() => setVersionId(v.id)} />
                <span className="flex-1 font-medium">{v.name}</span>
                <span className="tabular-nums">{dollars(v.subtotalCents)} + GST</span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="block text-sm font-medium">
          Note (optional)
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === "accept" ? "e.g. signed copy received by email" : "e.g. went with another bidder"} />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || (action === "accept" && !versionId)} onClick={() => void go()}>
            {busy ? "Saving…" : action === "accept" ? "Mark accepted" : "Mark declined"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CLAUSE_KINDS = [
  { key: "inclusions", kind: "inclusion", label: "Inclusions" },
  { key: "exclusions", kind: "exclusion", label: "Exclusions" },
  { key: "clarifications", kind: "clarification", label: "Clarifications" },
] as const;

function QuoteEditor({ quote, onClose, onChanged }: { quote: QuoteRow; onClose: () => void; onChanged: () => void }) {
  const { data: preparer } = usePreparer();
  const { data: library = [] } = useClauses();
  const send = useServerFn(issueQuote);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadQuoteContext>> | null>(null);
  const [pdf, setPdf] = useState<{ url: string; base64: string; blob: Blob } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<"edit" | "send">("edit");
  const [mail, setMail] = useState({ to: "", cc: "", subject: "", message: "" });
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const display = normalizeDisplay(quote.display, quote.presentation);
  const { data: settings } = useQuoteSettings();
  const stamp = JSON.stringify([settings?.branding, settings?.logo?.dataUrl.length, quote.attention, quote.client_notes, quote.display, quote.drawing_sheets, quote.validity_days, quote.presentation, quote.inclusions, quote.exclusions, quote.clarifications, quote.deposit, quote.version_ids]);

  useEffect(() => {
    if (!preparer) return;
    let stale = false;
    let url: string | null = null;
    void (async () => {
      try {
        const c = await loadQuoteContext(db, quote.id, preparer);
        // Colour-coded drawings are drawn here from the plans and this project's takeoff, then added as pages.
        const drawings = [];
        if (c.drawingSheets.length) {
          const [{ renderTakeoffSheet }, { openPdf }, { signedUrl: sign }] = await Promise.all([import("@/lib/takeoff/markedRender"), import("@/lib/takeoff/pdf"), import("@/lib/documents/upload")]);
          const [{ data: docRows }, { data: tk }] = await Promise.all([
            db.from("project_documents").select("id,section,file_name,version,storage_path,mime").eq("project_id", quote.project_id).in("section", ["plans", "specifications"]),
            db.from("project_takeoffs").select("doc").eq("project_id", quote.project_id).maybeSingle(),
          ]);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const files = drawingFiles((docRows ?? []) as any);
          const takeoffDoc = (tk as { doc: TakeoffDoc } | null)?.doc;
          for (const sh of c.drawingSheets) {
            const file = files.get(sh.file);
            if (!file) throw new Error(`${sh.label} cannot be attached: ${sh.file} is no longer under this project's Plans. Untick it under Colour-coded drawings.`);
            const pdfDoc = await openPdf(file.id, await sign(file.path));
            const { marks, key } = sheetMarks(takeoffDoc, sh.key);
            drawings.push(await renderTakeoffSheet(pdfDoc, sh.page, marks, key, { title: sh.label, maxWidth: c.drawingSheets.length > 4 ? 1400 : 1800 }));
          }
        }
        const doc = renderQuotePdf(c.snapshot, { logo: await loadLogo(), drawings });
        const blob = doc.output("blob");
        const base64 = doc.output("datauristring").split(",")[1] ?? "";
        if (stale) return;
        if (base64.length > 3_900_000) throw new Error("With these drawings the PDF is too large to email (about 3 MB is the limit). Untick some drawings, or send the drawings separately.");
        url = URL.createObjectURL(blob);
        setCtx(c);
        setPdf({ url, base64, blob });
        setLoadError(null);
        setMail((m) => (m.subject ? m : { ...m, subject: `${quote.kind === "quote" ? "Quotation" : "Change order"} ${c.quote.number} – ${c.projectName}`, message: `Hello,\n\nPlease find attached our ${quote.kind === "quote" ? "quotation" : "change order"} ${c.quote.number} for ${c.projectName}.\n\nLet me know if you have any questions.\n\n${preparer.name}` }));
      } catch (e) {
        if (!stale) setLoadError(errText(e));
      }
    })();
    return () => {
      stale = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [quote.id, stamp, preparer]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (patch: QuotePatch) => {
    try {
      await updateQuote(quote.id, patch);
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const byKind = useMemo(() => (k: Clause["kind"]) => library.filter((c) => c.kind === k), [library]);
  // A takeoff that moved after pricing must be accepted or detached on the Estimate tab before the quote goes out.
  const { data: measuredQty } = useTakeoffQuantities(quote.project_id);
  const takeoffTotals = useMemo(() => totalsByFinish(measuredQty ?? []), [measuredQty]);
  const moved = ctx && measuredQty ? ctx.versions.flatMap((v) => finishLinks(v.lines, takeoffTotals).filter((l) => l.changed).map((l) => `${v.name}: ${v.lines.find((x) => x.id === l.lineId)?.description ?? "line"} (priced at ${l.pricedQty.toLocaleString("en-CA")}, takeoff now ${l.takeoffQty.toLocaleString("en-CA")})`)) : [];
  const blocked = !!ctx && (ctx.unknown.length > 0 || moved.length > 0);
  // Sheets of the takeoff that have something measured on them, named by their sheet number where the takeoff read one.
  const { data: measuredSheets = [] } = useQuery({
    queryKey: ["quote-sheets", quote.project_id],
    queryFn: async () => {
      const [{ data: tk }, { data: lab }] = await Promise.all([
        db.from("project_takeoffs").select("doc").eq("project_id", quote.project_id).maybeSingle(),
        db.from("takeoff_sheet_labels").select("sheet_key,label").eq("project_id", quote.project_id),
      ]);
      const labels = Object.fromEntries(((lab ?? []) as { sheet_key: string; label: string }[]).map((r) => [r.sheet_key, r.label]));
      return sheetsMeasured((tk as { doc: TakeoffDoc } | null)?.doc).map((x) => ({ id: x.key, label: sheetLabel(x.key, labels), shapes: x.shapes }));
    },
  });
  const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  const issue = async (withEmail: boolean) => {
    if (!ctx || !pdf) return;
    setBusy(true);
    try {
      const res = await send({ data: { quoteId: quote.id, pdfBase64: pdf.base64, fingerprint: snapshotFingerprint(ctx.snapshot), email: withEmail ? { to: list(mail.to), cc: list(mail.cc), subject: mail.subject, message: mail.message } : null } });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(withEmail ? `${quote.number} sent from your mailbox and filed under Quotes sent.` : `${quote.number} marked as sent and filed under Quotes sent.`);
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (!ctx || !pdf) return;
    const a = document.createElement("a");
    a.href = pdf.url;
    a.setAttribute("download", ctx.fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {quote.number}
            {ctx ? ` · ${ctx.clientName || "no client"}` : ""}
          </DialogTitle>
          <DialogDescription>The preview is exactly what the client receives. Costs, markups and suppliers are never on it.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto lg:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            {step === "edit" ? (
              <>
                <div className="flex gap-3">
                  <label className="text-sm font-medium">
                    Start from
                    <select className={`${field} mt-1 block w-44`} value={quote.presentation} onChange={(e) => void save({ presentation: e.target.value as Presentation, display: null })}>
                      <option value="lump_sum">One lump sum</option>
                      <option value="by_section">Subtotals, no line prices</option>
                      <option value="itemised">Everything priced</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Valid for (days)
                    <input type="number" min={1} max={365} className={`${field} mt-1 block w-24`} defaultValue={quote.validity_days} onBlur={(e) => Number(e.target.value) !== quote.validity_days && Number(e.target.value) >= 1 && void save({ validity_days: Math.min(365, Math.round(Number(e.target.value))) })} />
                  </label>
                </div>
                <fieldset className="rounded-md border border-border p-3">
                  <legend className="px-1 text-sm font-medium">What the client sees</legend>
                  <label className="block text-sm">
                    Group the scope by
                    <select className={`${field} ml-2`} value={display.groupBy} onChange={(e) => void save({ display: { ...display, groupBy: e.target.value as "section" | "material" } })}>
                      <option value="section">Section (floor or area)</option>
                      <option value="material">Material (carpet, tile, LVP…)</option>
                    </select>
                  </label>
                  <div className="mt-2 grid gap-1.5">
                    {(
                      [
                        ["showLines", "Each line's description"],
                        ["showQuantities", "Quantities"],
                        ["showUnitPrices", "Unit prices"],
                        ["showLineAmounts", "A price on each line"],
                        ["showGroupSubtotals", display.groupBy === "material" ? "A total for each material" : "A subtotal for each section"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4" checked={display[key]} onChange={(e) => void save({ display: { ...display, [key]: e.target.checked } })} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">These only hide or show. The total is always shown and never changes. Optional and choose-one items always show their own price.</p>
                </fieldset>
                {measuredSheets.length > 0 && (
                  <fieldset className="rounded-md border border-border p-3">
                    <legend className="px-1 text-sm font-medium">Colour-coded drawings</legend>
                    <p className="text-xs text-muted-foreground">Tick the sheets to attach. Each is added as a page showing the measured areas in colour with a key. Leave all unticked to send the quote without drawings.</p>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                      {measuredSheets.map((sh) => (
                        <li key={sh.id}>
                          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                            <input type="checkbox" className="h-4 w-4" checked={quote.drawing_sheets.includes(sh.id)} onChange={(e) => void save({ drawing_sheets: e.target.checked ? [...quote.drawing_sheets, sh.id] : quote.drawing_sheets.filter((x) => x !== sh.id) })} />
                            <span className="truncate">{sh.label}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{sh.shapes} measured</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )}
                <label className="block text-sm font-medium">
                  Attention (who at the client this is addressed to)
                  <Input className="mt-1" maxLength={200} defaultValue={quote.attention ?? ""} placeholder="e.g. Pat Lee, Project Manager" onBlur={(e) => (e.target.value.trim() || null) !== quote.attention && void save({ attention: e.target.value.trim() || null })} />
                </label>
                <label className="block text-sm font-medium">
                  Notes for the client (printed under the price)
                  <Textarea className="mt-1 min-h-24" maxLength={4000} defaultValue={quote.client_notes} onBlur={(e) => e.target.value.trim() !== quote.client_notes && void save({ client_notes: e.target.value.trim() })} />
                </label>
                <p className="text-xs text-muted-foreground">
                  The logo, company addresses, footer, short terms and the standard terms and conditions page are set once for every quote under{" "}
                  <Link to="/settings" search={{ tab: "quotes" }} className="underline">
                    Company settings → Quotes
                  </Link>
                  .
                </p>
                <label className="block text-sm font-medium">
                  Deposit (leave blank for none)
                  <Input className="mt-1" defaultValue={quote.deposit ?? ""} placeholder="e.g. 50% on order of materials" onBlur={(e) => (e.target.value.trim() || null) !== quote.deposit && void save({ deposit: e.target.value.trim() || null })} />
                </label>
                {CLAUSE_KINDS.map(({ key, kind, label }) => {
                  const current = quote[key];
                  const options = [...new Set([...byKind(kind).map((c) => c.body), ...current])];
                  return (
                    <fieldset key={key}>
                      <legend className="text-sm font-medium">{label}</legend>
                      <ul className="mt-1 space-y-1">
                        {options.map((body) => (
                          <li key={body}>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={current.includes(body)} onChange={(e) => void save({ [key]: e.target.checked ? [...current, body] : current.filter((x) => x !== body) })} />
                              <span>{body}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      <form
                        className="mt-1 flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const body = (extra[key] ?? "").trim();
                          if (!body || current.includes(body)) return;
                          setExtra({ ...extra, [key]: "" });
                          void save({ [key]: [...current, body] });
                        }}
                      >
                        <Input aria-label={`Add to ${label.toLowerCase()}`} placeholder="Add your own…" value={extra[key] ?? ""} onChange={(e) => setExtra({ ...extra, [key]: e.target.value })} />
                        <Button type="submit" variant="outline">
                          Add
                        </Button>
                      </form>
                    </fieldset>
                  );
                })}
              </>
            ) : (
              <>
                <label className="block text-sm font-medium">
                  To
                  <Input className="mt-1" type="text" inputMode="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="client@example.com" />
                </label>
                <label className="block text-sm font-medium">
                  Cc
                  <Input className="mt-1" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} />
                </label>
                <label className="block text-sm font-medium">
                  Subject
                  <Input className="mt-1" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
                </label>
                <label className="block text-sm font-medium">
                  Message
                  <Textarea className="mt-1" rows={9} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} />
                </label>
                <p className="text-xs text-muted-foreground">Sends from your own Outlook mailbox with the PDF attached, and shows in your Sent Items.</p>
              </>
            )}
            {moved.length > 0 && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">The takeoff changed after these lines were priced.</p>
                <ul className="mt-1 list-disc pl-5">
                  {moved.slice(0, 6).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <p className="mt-1">On the Estimate tab, accept the new quantity or stop the line following the takeoff, then come back.</p>
              </div>
            )}
            {ctx && ctx.unknown.length > 0 && (
              <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">This quote can't be sent yet: a cost or price is still missing.</p>
                <ul className="mt-1 list-disc pl-5">
                  {ctx.unknown.slice(0, 6).map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
                {ctx.unknown.length > 6 && <p className="mt-1">…and {ctx.unknown.length - 6} more.</p>}
                <p className="mt-1">Enter each cost on the Estimate tab, or mark it not needed.</p>
              </div>
            )}
          </div>
          <div className="min-h-[60vh] rounded-md border border-border bg-muted">
            {loadError ? <p className="p-4 text-sm text-destructive">Could not build the preview: {loadError}</p> : pdf ? <iframe title={`Preview of ${quote.number}`} src={pdf.url} className="h-full min-h-[60vh] w-full rounded-md" /> : <p className="p-4 text-sm text-muted-foreground">Building the preview…</p>}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={step === "send" ? () => setStep("edit") : onClose}>
            {step === "send" ? "Back" : "Close"}
          </Button>
          <Button variant="outline" disabled={!pdf || blocked} title={blocked ? "Fix the items listed before this quote can leave the building" : undefined} onClick={download}>
            Download PDF
          </Button>
          {step === "edit" ? (
            <>
              <Button variant="outline" disabled={!pdf || !!blocked || busy} onClick={() => window.confirm(`Mark ${quote.number} as sent without emailing it? Its prices lock and the PDF is filed under Quotes sent.`) && void issue(false)}>
                Mark as sent
              </Button>
              <Button disabled={!pdf || !!blocked} onClick={() => setStep("send")}>
                Email to client…
              </Button>
            </>
          ) : (
            <Button disabled={busy || list(mail.to).length === 0 || !mail.subject.trim()} onClick={() => void issue(true)}>
              {busy ? "Sending…" : "Send"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The estimate as it would be entered in QuickBooks: one line per cost code, adding up to the quote. Shown for manual entry until QuickBooks is connected. */
function RollupDialog({ quote, projectId, onClose }: { quote: QuoteRow; projectId: string; onClose: () => void }) {
  const { data: costCodes = [] } = useCostCodes();
  const { data: client } = useQuery({
    queryKey: ["quote-client-qbo", projectId],
    queryFn: async () => {
      const { data } = await db.from("projects").select("name,client:clients(name,qbo_customer_id)").eq("id", projectId).maybeSingle();
      return data as { name: string; client: { name: string; qbo_customer_id: string | null } | null } | null;
    },
  });
  const versionId = quote.accepted_version_id ?? quote.version_ids[0]!;
  const rollup = quote.rollup?.find((r) => r.versionId === versionId) ?? null;
  const version = quote.snapshot?.versions.find((v) => v.id === versionId) ?? null;
  if (!rollup || !version) return null;
  const built = buildQboEstimate({ number: quote.number, projectName: client?.name ?? "", customerQboId: client?.client?.qbo_customer_id ?? null, rollup, version, costCodes });
  const name = (code: string) => costCodes.find((c) => c.code === code)?.name ?? "";
  const copy = () => void navigator.clipboard.writeText(rollup.lines.map((l) => [l.costCode, name(l.costCode), (l.amountCents / 100).toFixed(2), l.taxCode].join("\t")).join("\n")).then(() => toast.success("Copied. Paste into a spreadsheet or straight into the estimate."), () => toast.error("Could not copy."));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>QuickBooks roll-up for {quote.number}</DialogTitle>
          <DialogDescription>
            {client?.client?.name ?? "No client"} · {version.name}
            {quote.status !== "accepted" && " (not yet accepted)"}. One line per cost code, markup included. QuickBooks is not connected yet, so enter these by hand; nothing is posted from here.
          </DialogDescription>
        </DialogHeader>
        {quote.accepted_value_cents != null && quote.accepted_value_cents !== rollup.subtotalCents && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            The client's choices set the accepted price at {dollars(quote.accepted_value_cents)} before GST, which differs from these lines. Adjust the optional items before entering the estimate.
          </p>
        )}
        {!built.ok && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{built.message}</p>}
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Cost code</th>
              <th>QuickBooks item</th>
              <th className="text-right">Amount</th>
              <th className="pl-3">Tax</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rollup.lines.map((l) => (
              <tr key={`${l.costCode}-${l.taxCode}`}>
                <td className="py-1.5">{l.costCode || <span className="text-amber-700">none</span>}</td>
                <td>{name(l.costCode) || <span className="text-amber-700">not linked</span>}</td>
                <td className="text-right tabular-nums">{dollars(l.amountCents)}</td>
                <td className="pl-3">{l.taxCode}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-medium">
            <tr><td colSpan={2} className="pt-2">Subtotal</td><td className="pt-2 text-right tabular-nums">{dollars(rollup.subtotalCents)}</td><td /></tr>
            <tr><td colSpan={2}>GST</td><td className="text-right tabular-nums">{dollars(rollup.taxCents)}</td><td /></tr>
            <tr><td colSpan={2}>Total</td><td className="text-right tabular-nums">{dollars(rollup.totalCents)}</td><td /></tr>
          </tfoot>
        </table>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={copy}>Copy lines</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
