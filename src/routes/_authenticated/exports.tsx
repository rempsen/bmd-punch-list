import { useAuth } from "@/lib/auth";
import { floorLabel, floorShort } from "@/lib/data";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSESSMENTS, isClosed, STATUS_LABEL } from "@/lib/bmd";
import { useDeficiencies, useFloors, usePhotos, useProject } from "@/lib/data";
import { clientLine, useContacts } from "@/lib/data";
import { buildRows, exportCsv, exportExcel, exportPdf, type GroupBy } from "@/lib/exporting";
import { assignFilterOptions, matchesAssign, peopleMap, tradeOf, useProjectPeople } from "@/lib/assign";
import { AssignFilter } from "@/components/AssignFilter";
import { zipSync } from "fflate";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/exports")({
  component: ExportsPage,
});

function ExportsPage() {
  const { can } = useAuth();
  const pdfOk = can("export_pdf");
  const xlsOk = can("export_excel");
  const { data: project } = useProject();
  const { data: contacts = [] } = useContacts(project?.id);
  const { data: items = [] } = useDeficiencies(project?.id);
  const { data: floors = [] } = useFloors(project?.id);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const { data: photos = [] } = usePhotos(ids);

  const [floor, setFloor] = useState("all");
  const [assessment, setAssessment] = useState("all");
  const [status, setStatus] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("floor");
  const { data: people = [] } = useProjectPeople(project?.id);
  const pmap = useMemo(() => peopleMap(people), [people]);
  const assignOptions = useMemo(() => assignFilterOptions(items, pmap), [items, pmap]);

  const filtered = items.filter((d) => {
    if (floor !== "all" && String(d.locations?.floors?.number ?? "") !== floor) return false;
    if (assessment !== "all" && d.assessment !== assessment) return false;
    if (status !== "all" && d.status !== status) return false;
    if (openOnly && isClosed(d.status)) return false;
    if (!matchesAssign(d, assign, pmap)) return false;
    return true;
  });

  const rows = buildRows(filtered, photos);

  const run = async (kind: "pdf" | "xlsx" | "csv") => {
    if (!project) return;
    setBusy(kind);
    try {
      if (kind === "pdf")
        await exportPdf(rows, project, clientLine(project.client_name, contacts), { groupBy, people: pmap, contacts });
      if (kind === "xlsx") await exportExcel(rows, project.name, pmap);
      if (kind === "csv") await exportCsv(rows, project.name, pmap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const tradeRows = useMemo(() => {
    const m = new Map<string, { name: string; rows: typeof items }>();
    for (const d of items) {
      if (isClosed(d.status)) continue;
      const t = tradeOf(d, pmap);
      if (!t) continue;
      const k = t.toLowerCase();
      if (!m.has(k)) m.set(k, { name: t, rows: [] });
      m.get(k)!.rows.push(d);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items, pmap]);

  const exportByTrade = async () => {
    if (!project || tradeRows.length === 0) return;
    setBusy("trade");
    try {
      const safe = (t: string) => t.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const date = new Date().toISOString().slice(0, 10);
      const files: Record<string, Uint8Array> = {};
      for (const t of tradeRows) {
        const blob = (await exportPdf(buildRows(t.rows, photos), project, clientLine(project.client_name, contacts), {
          groupBy: "trade",
          people: pmap,
          contacts,
          title: `Open items for ${t.name}`,
          asBlob: true,
        })) as Blob;
        files[`${safe(project.name)}-${safe(t.name)}-${date}.pdf`] = new Uint8Array(await blob.arrayBuffer());
      }
      const names = Object.keys(files);
      const out =
        names.length === 1
          ? { blob: new Blob([files[names[0]!]! as BlobPart], { type: "application/pdf" }), name: names[0]! }
          : {
              blob: new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
              name: `${safe(project.name)}-by-trade-${date}.zip`,
            };
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = out.name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${names.length} trade report${names.length === 1 ? "" : "s"} ready`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Exports" subtitle={`${rows.length} items match your filters`} />
      <div className="space-y-6 p-4 md:p-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Filters</h2>
          <div className="flex flex-wrap gap-2">
            <Pick
              value={floor}
              onChange={setFloor}
              options={[
                { value: "all", label: "All floors" },
                ...floors.map((f) => ({ value: String(f.number), label: floorLabel(f) })),
              ]}
            />
            <Pick
              value={assessment}
              onChange={setAssessment}
              options={[
                { value: "all", label: "All assessments" },
                ...ASSESSMENTS.map((a) => ({ value: a.value, label: a.label })),
              ]}
            />
            <Pick
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All statuses" },
                ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
            <label className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <Checkbox checked={openOnly} onCheckedChange={(c) => setOpenOnly(!!c)} />
              Open only
            </label>
            <AssignFilter value={assign} options={assignOptions} onChange={setAssign} />
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-11 w-full sm:w-56">
                <span className="mr-1 text-muted-foreground">PDF group by:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="floor">Floor</SelectItem>
                <SelectItem value="person">Assigned person</SelectItem>
                <SelectItem value="trade">Trade / company</SelectItem>
                <SelectItem value="responsible">Responsible party</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Button className="h-14 text-base" disabled={busy !== null || !pdfOk} onClick={() => void run("pdf")}>
            <FileText className="mr-2 h-5 w-5" /> {busy === "pdf" ? "Building…" : "PDF report"}
          </Button>
          <Button
            variant="secondary"
            className="h-14 text-base"
            disabled={busy !== null || !xlsOk}
            onClick={() => void run("xlsx")}
          >
            <FileSpreadsheet className="mr-2 h-5 w-5" /> Excel (.xlsx)
          </Button>
          <Button
            variant="outline"
            className="h-14 text-base"
            disabled={busy !== null || !xlsOk}
            onClick={() => void run("csv")}
          >
            <FileDown className="mr-2 h-5 w-5" /> CSV
          </Button>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Export by trade</h2>
            <p className="text-sm text-muted-foreground">
              {tradeRows.length === 0
                ? "No open items are assigned to a trade or company yet."
                : `One PDF of open items per trade (${tradeRows.map((t) => `${t.name} ${t.rows.length}`).join(", ")}), ready to email to each sub.`}
            </p>
          </div>
          <Button
            className="h-12 shrink-0"
            variant="secondary"
            disabled={busy !== null || !pdfOk || tradeRows.length === 0}
            onClick={() => void exportByTrade()}
          >
            <Users className="mr-2 h-5 w-5" /> {busy === "trade" ? "Building…" : "Export by trade"}
          </Button>
        </section>

        <p className="text-sm text-muted-foreground">
          The PDF lists items floor by floor and room by room with photo thumbnails. The
          spreadsheet exports one row per item, including links to the photos.
        </p>
      </div>
    </div>
  );
}

function Pick({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-11 w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
