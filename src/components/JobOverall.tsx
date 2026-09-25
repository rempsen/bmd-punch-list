import { useMemo, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ASSESSMENTS, STATUS_LABEL, isClosed, type Status } from "@/lib/bmd";
import { buildRows, exportPdf } from "@/lib/exporting";
import { clientLine, floorLabel, usePhotos, type DefRow } from "@/lib/data";
import { peopleMap, useProjectPeople } from "@/lib/assign";

const ORDER: Status[] = ["open", "awaiting_client", "fix_required", "in_progress", "fixed", "verified", "accepted_as_is"];

type Project = Parameters<typeof exportPdf>[1];

export function JobOverall({
  project,
  items,
  contacts,
}: {
  project: Project & { id: string };
  items: DefRow[];
  contacts: Parameters<typeof clientLine>[1];
}) {
  const [busy, setBusy] = useState(false);
  const { data: people = [] } = useProjectPeople(project.id);
  const ids = useMemo(() => items.map((d) => d.id), [items]);
  const { data: photos = [] } = usePhotos(ids);

  const total = items.length;
  const closed = items.filter((d) => isClosed(d.status)).length;
  const pct = total ? Math.round((closed / total) * 100) : 0;
  const byStatus = ORDER.map((s) => ({ s, n: items.filter((d) => d.status === s).length }));
  const byAssess = ASSESSMENTS.map((a) => ({ ...a, n: items.filter((d) => d.assessment === a.value).length }));
  const byFloor = useMemo(() => {
    const m = new Map<string, { label: string; sort: number; total: number; open: number }>();
    for (const d of items) {
      const f = d.locations?.floors;
      const key = String(f?.number ?? "?");
      const row = m.get(key) ?? { label: f ? floorLabel(f) : "Unknown", sort: f?.number ?? 999, total: 0, open: 0 };
      row.total++;
      if (!isClosed(d.status)) row.open++;
      m.set(key, row);
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort);
  }, [items]);

  const download = async () => {
    setBusy(true);
    try {
      await exportPdf(buildRows(items, photos), project, clientLine(project.client_name, contacts), {
        groupBy: "floor",
        people: peopleMap(people),
        contacts,
        title: "Overall job report",
      });
    } catch (err) {
      toast.error(`Could not create the PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase">Total items</p>
          <p className="text-3xl font-semibold">{total}</p>
          <p className="text-sm text-muted-foreground">
            {closed} closed · {total - closed} open · {pct}% complete
          </p>
        </div>
        <Button className="h-12" onClick={() => void download()} disabled={busy || total === 0}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
          Download PDF report
        </Button>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">By status</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {byStatus.map(({ s, n }) => (
            <div key={s} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</p>
              <p className="text-2xl font-semibold">{n}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">By assessment</h2>
          <ul className="space-y-1 text-sm">
            {byAssess.map((a) => (
              <li key={a.value} className="flex justify-between">
                <span>{a.label}</span>
                <span className="font-semibold">{a.n}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">By floor</h2>
          {byFloor.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1">Floor</th><th className="text-right">Open</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {byFloor.map((f) => (
                  <tr key={f.label} className="border-t border-border">
                    <td className="py-1">{f.label}</td>
                    <td className="text-right font-semibold">{f.open}</td>
                    <td className="text-right">{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
