import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { db, errText } from "@/lib/platform/db";
import { SCOPE_GROUPS } from "@/lib/documents/scope-keywords";
import { useRefreshScope, useScopeKeywords } from "@/lib/documents/scope-data";
import { useQueryClient } from "@tanstack/react-query";

type Kw = { id: string; term: string; group_key: string; whole_word: boolean; active: boolean; sort: number };

/** Company settings → Scope keywords: the terms searched for in every plan and spec. */
export function ScopeKeywordsPanel() {
  const { data: keywords = [], isLoading, error } = useScopeKeywords();
  const qc = useQueryClient();
  const refreshHits = useRefreshScope();
  const reload = () => void qc.invalidateQueries({ queryKey: ["scope-keywords"] });
  const [term, setTerm] = useState("");
  const [group, setGroup] = useState("other");
  const [whole, setWhole] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [edit, setEdit] = useState<{ id: string; term: string } | null>(null);

  const save = async (id: string, patch: Partial<Kw>) => {
    const { error: e } = await db.from("scope_keywords").update(patch).eq("id", id);
    if (e) toast.error(`Could not save: ${errText(e)}`);
    reload();
  };
  const add = async () => {
    const t = term.trim();
    if (!t) return;
    const sort = Math.max(0, ...keywords.filter((k) => k.group_key === group).map((k) => k.sort)) + 1;
    const { error: e } = await db.from("scope_keywords").insert({ term: t, group_key: group, whole_word: whole, sort });
    if (e) return void toast.error(e.code === "23505" ? `“${t}” is already in the list` : `Could not add: ${errText(e)}`);
    setTerm("");
    setWhole(false);
    reload();
    toast.success(`Added “${t}”. Run “Scan existing documents” to search older files for it.`);
  };
  const scan = async () => {
    setScanning(true);
    const id = toast.loading("Scanning plans and specifications…");
    try {
      const { scanExistingDocuments } = await import("@/lib/documents/scope.functions");
      const r = await scanExistingDocuments();
      toast.success(`Scanned ${r.documents} document${r.documents === 1 ? "" : "s"}: ${r.hits} scope hit${r.hits === 1 ? "" : "s"}${r.failed ? `, ${r.failed} could not be scanned` : ""}.`, { id });
      refreshHits();
    } catch (e) {
      toast.error(`Scan failed: ${errText(e)}`, { id });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Scope keywords</h2>
            <p className="text-sm text-muted-foreground">Every plan and specification is searched for these terms and close variants (plurals, hyphens, spaces). Hits show in each job’s Documents for review.</p>
          </div>
          <Button onClick={() => void scan()} disabled={scanning}>{scanning ? "Scanning…" : "Scan existing documents"}</Button>
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Input className="h-10 w-56" placeholder="New term, e.g. cork flooring" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="New term" />
          <select className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group">
            {SCOPE_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <label className="flex h-10 items-center gap-2 text-sm"><Switch checked={whole} onCheckedChange={setWhole} /> Whole word</label>
          <Button type="submit" variant="outline" className="h-10" disabled={!term.trim()}>Add term</Button>
        </form>
      </section>
      {error && <p className="text-sm text-destructive">{errText(error)}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {SCOPE_GROUPS.map((g) => {
        const rows = keywords.filter((k) => k.group_key === g.key);
        if (!rows.length) return null;
        return (
          <section key={g.key} className="rounded-lg border border-border bg-card">
            <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">{g.label}</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-1.5 font-medium">Term</th><th className="px-2 font-medium">Group</th><th className="px-2 font-medium">Whole word</th><th className="px-2 font-medium">Active</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((k) => (
                  <tr key={k.id} className={k.active ? "" : "text-muted-foreground"}>
                    <td className="px-4 py-1.5">
                      {edit?.id === k.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); const t = edit.term.trim(); if (t) void save(k.id, { term: t }); setEdit(null); }}>
                          <Input autoFocus className="h-8" value={edit.term} onChange={(e) => setEdit({ id: k.id, term: e.target.value })} onBlur={() => setEdit(null)} aria-label="Term" />
                        </form>
                      ) : (
                        <button type="button" className="text-left hover:underline" onClick={() => setEdit({ id: k.id, term: k.term })}>{k.term}</button>
                      )}
                    </td>
                    <td className="px-2">
                      <select className="h-8 rounded-md border border-input bg-background px-1 text-xs" value={k.group_key} onChange={(e) => void save(k.id, { group_key: e.target.value })} aria-label={`Group for ${k.term}`}>
                        {SCOPE_GROUPS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2"><Switch checked={k.whole_word} onCheckedChange={(v) => void save(k.id, { whole_word: v })} aria-label={`Whole word for ${k.term}`} /></td>
                    <td className="px-2"><Switch checked={k.active} onCheckedChange={(v) => void save(k.id, { active: v })} aria-label={`Active: ${k.term}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
