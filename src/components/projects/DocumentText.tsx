import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, errText } from "@/lib/platform/db";
import { BUCKET, sectionLabel, type DocRow, type DocSection } from "@/lib/documents/logic";
import { highlightSnippet, indexDocumentFile, type DocSearchHit, type TextBacklogRow } from "@/lib/documents/text";
import { supabase } from "@/integrations/supabase/client";

/** Search inside the text of this project's documents. Results open the document like the list does. */
export function DocumentSearch({ projectId, docs, onOpen }: { projectId: string; docs: DocRow[]; onOpen: (d: DocRow) => void }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const { data: hits = [], isFetching, error } = useQuery({
    queryKey: ["document-search", projectId, asked],
    enabled: asked.trim().length >= 2,
    queryFn: async () => {
      const { data, error: e } = await db.rpc("search_document_pages", { _project: projectId, _q: asked, _limit: 30 });
      if (e) throw e;
      return (data ?? []) as DocSearchHit[];
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));
  return (
    <section aria-label="Search inside documents" className="rounded-lg border border-border bg-card p-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAsked(q);
        }}
      >
        <Input className="h-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inside documents — e.g. rubber base, 09 65 19, Ceratech" aria-label="Search inside documents" />
        <Button type="submit" variant="outline" className="h-11" disabled={q.trim().length < 2 || isFetching}>
          <Search className="mr-2 h-4 w-4" /> {isFetching ? "Searching…" : "Search"}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">Search failed: {errText(error)}</p>}
      {asked.trim().length >= 2 && !isFetching && !error && (
        <ul className="mt-3 divide-y divide-border">
          {hits.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nothing found for “{asked}”. Only documents whose text has been read are searched.</li>}
          {hits.map((h) => {
            const doc = byId.get(h.document_id);
            return (
              <li key={`${h.document_id}-${h.page}`} className="py-2">
                <button
                  type="button"
                  className="text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => doc && onOpen(doc)}
                  disabled={!doc}
                >
                  {h.file_name} <span className="font-normal text-muted-foreground">· {sectionLabel(h.section as DocSection)} · page {h.page}</span>
                </button>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {highlightSnippet(h.snippet).map((part, i) => (part.mark ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-foreground">{part.text}</mark> : <span key={i}>{part.text}</span>))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** How much of this project's text has been read, and a button to read the rest in this browser. */
export function TextIndexStatus({ projectId, docs, onChanged }: { projectId: string; docs: DocRow[]; onChanged: () => void }) {
  const total = docs.length;
  const indexed = docs.filter((d) => d.text_status && d.text_status !== "pending").length;
  const pending = docs.filter((d) => !d.text_status || d.text_status === "pending").length;
  const [progress, setProgress] = useState<{ done: number; of: number; current: string } | null>(null);

  const run = async () => {
    const { data, error } = await db.rpc("document_text_backlog", { _project: projectId });
    if (error) return void setProgress({ done: 0, of: 0, current: `Could not list documents: ${errText(error)}` });
    const rows = (data ?? []) as TextBacklogRow[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      setProgress({ done: i, of: rows.length, current: r.file_name });
      try {
        const { data: blob, error: dl } = await supabase.storage.from(BUCKET).download(r.storage_path);
        if (dl || !blob) throw new Error(dl?.message ?? "download failed");
        await indexDocumentFile(r.id, blob, r.mime, r.file_name);
      } catch (e) {
        console.error(`[documents] ${r.file_name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      onChanged();
    }
    setProgress({ done: rows.length, of: rows.length, current: "" });
    onChanged();
  };

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        Text index: {indexed} of {total} document{total === 1 ? "" : "s"} read for search.
      </span>
      {progress && progress.of > 0 && progress.done < progress.of && (
        <span>
          Reading {progress.done + 1} of {progress.of}: {progress.current}
        </span>
      )}
      {progress && progress.of === 0 && progress.current && <span className="text-destructive">{progress.current}</span>}
      {pending > 0 && (!progress || progress.done >= progress.of) && (
        <Button variant="link" className="h-auto p-0 text-xs" onClick={() => void run()}>
          Index remaining ({pending})
        </Button>
      )}
    </p>
  );
}
