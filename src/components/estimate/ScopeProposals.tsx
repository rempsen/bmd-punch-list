import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { pageRanges, selectPages } from "@/lib/ai/pages";
import { proposalToFinish, READ_LIMIT, type Proposal } from "@/lib/ai/scope";
import { proposeScope } from "@/lib/ai/scope.functions";
import { useProjectDocuments } from "@/lib/documents/data";
import { groupVersions } from "@/lib/documents/logic";
import { signedUrl } from "@/lib/documents/upload";
import { db, errText } from "@/lib/platform/db";

type Row = { id: string; payload: Proposal; source_note: string | null };
const MAX_PAGES_NOTE = "Long documents are searched page by page, and the pages that mention flooring, base, tile, window coverings or a finish schedule are the ones read. You are told which pages were read and if any did not fit.";

/** AI suggestions for the project's finishes, read from the specs. Each one waits here until someone accepts or rejects it. */
export function ScopeProposals({ projectId, finishCount, onAccepted }: { projectId: string; finishCount: number; onAccepted: () => void }) {
  const qc = useQueryClient();
  const run = useServerFn(proposeScope);
  const { data: docs = [] } = useProjectDocuments(projectId);
  const { data: rows = [] } = useQuery({
    queryKey: ["ai-proposals", projectId],
    queryFn: async () => {
      const { data, error } = await db.from("ai_proposals").select("id,payload,source_note").eq("project_id", projectId).eq("status", "proposed").order("created_at");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ai-proposals", projectId] });
  const groups = groupVersions(docs);
  const pdfs = [...groups.specifications, ...groups.plans].map((e) => e.latest).filter((d) => /\.pdf$/i.test(d.file_name));

  const read = async () => {
    setBusy("Reading the documents…");
    try {
      const { pdfTextPages } = await import("@/lib/estimating/pdf-text");
      const names: string[] = [];
      const notes: string[] = [];
      const chosen = pdfs.filter((x) => picked.has(x.id));
      let specText = pasted.trim().slice(0, Math.floor(READ_LIMIT / 3));
      // The allowance is shared out. What a short document does not use is passed on to the ones after it.
      let left = READ_LIMIT - 4_000 - specText.length;
      for (const [i, d] of chosen.entries()) {
        setBusy(`Reading ${d.file_name}…`);
        const buf = await (await fetch(await signedUrl(d.storage_path))).arrayBuffer();
        const pages = await pdfTextPages(buf);
        const share = Math.floor(left / (chosen.length - i));
        const pick = selectPages(pages, share - d.file_name.length - 20);
        if (pick.pages.length === 0) {
          toast.warning(`${d.file_name} has no readable text (it may be a scan), so it was skipped.`);
          continue;
        }
        if (pick.cut && pick.relevant === 0) notes.push(`${d.file_name}: nothing in its ${pick.total} pages mentions flooring, base, tile or window coverings, so only the first pages were read.`);
        else if (pick.cut) notes.push(`${d.file_name}: read the ${pick.pages.length} of ${pick.total} pages that mention flooring, base, tile, window coverings or a finish schedule (pages ${pageRanges(pick.pages)}).${pick.leftOut ? ` ${pick.leftOut} more such pages did not fit; run it again with this document on its own to read them.` : ""}`);
        const block = `\n\n--- ${d.file_name} ---\n${pick.text}`;
        specText += block;
        left -= block.length;
        names.push(d.file_name);
      }
      if (!specText.trim()) throw new Error("There was no readable text in what you chose. Tick a document that has text, or paste the spec text.");
      for (const n of notes) toast.message(n, { duration: 15_000 });
      setBusy("Asking AI what finishes they call for…");
      const res = await run({ data: { projectId, specText, scheduleText: "", sourceNote: names.join(", ") || "pasted text" } });
      toast.success(res.added ? `${res.added} suggested finishes to review${res.alreadyHad ? ` (${res.alreadyHad} more are already on this job)` : ""}. Read by ${res.model}.` : res.alreadyHad ? `It found ${res.alreadyHad} finishes, all already on this job.` : "No finishes were found in what was read.");
      refresh();
      setOpen(false);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const decide = async (r: Row, accept: boolean, index: number) => {
    try {
      if (accept) {
        const { error } = await db.from("project_finishes").insert(proposalToFinish(r.payload, projectId, finishCount + index + 1));
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? `A finish tagged ${r.payload.tag} already exists.` : error.message);
      }
      const { error: e2 } = await db.from("ai_proposals").update({ status: accept ? "accepted" : "rejected", decided_at: new Date().toISOString() }).eq("id", r.id);
      if (e2) throw new Error(e2.message);
      refresh();
      if (accept) onAccepted();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">{rows.length ? `${rows.length} finishes suggested by AI from the specs. Nothing is added until you accept it.` : "AI can read the specs and suggest the project's finishes for you to accept or reject."}</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Suggest finishes from the specs
        </Button>
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <strong>{r.payload.tag}</strong> · {[r.payload.manufacturer, r.payload.product].filter(Boolean).join(" ")}
                {r.payload.colour ? `, ${r.payload.colour}` : ""}
                <span className="block text-xs text-muted-foreground">
                  {[r.payload.appliesTo, r.payload.specRef && `spec ${r.payload.specRef}`, r.payload.confidence < 0.6 && "AI was unsure of this one", r.source_note && `from ${r.source_note}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <Button size="sm" onClick={() => void decide(r, true, i)}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void decide(r, false, i)}>
                Reject
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && !busy && setOpen(false)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Suggest finishes from the specs</DialogTitle>
              <DialogDescription>
                The text of the documents you tick is sent to an AI model, which lists the finishes they call for. No files, costs or prices are sent. Check each suggestion against the spec before accepting it. {MAX_PAGES_NOTE}
              </DialogDescription>
            </DialogHeader>
            {pdfs.length > 0 ? (
              <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {pdfs.map((d) => (
                  <li key={d.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={picked.has(d.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          setPicked(next);
                        }}
                      />
                      <span className="truncate">{d.file_name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{d.section === "plans" ? "Plans" : "Specifications"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No spec or plan PDFs are on this project yet. Upload them under Documents, or paste the text below.</p>
            )}
            <label className="block text-sm font-medium">
              Or paste spec or finish schedule text
              <Textarea className="mt-1" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} />
            </label>
            <DialogFooter>
              <Button variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!!busy || (picked.size === 0 && !pasted.trim())} onClick={() => void read()}>
                {busy ?? "Read and suggest"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
