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
import { buildRows, exportCsv, exportExcel, exportPdf } from "@/lib/exporting";

export const Route = createFileRoute("/_authenticated/exports")({
  component: ExportsPage,
});

function ExportsPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const { data: floors = [] } = useFloors(project?.id);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const { data: photos = [] } = usePhotos(ids);

  const [floor, setFloor] = useState("all");
  const [assessment, setAssessment] = useState("all");
  const [status, setStatus] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = items.filter((d) => {
    if (floor !== "all" && String(d.locations?.floors?.number ?? "") !== floor) return false;
    if (assessment !== "all" && d.assessment !== assessment) return false;
    if (status !== "all" && d.status !== status) return false;
    if (openOnly && isClosed(d.status)) return false;
    return true;
  });

  const rows = buildRows(filtered, photos);

  const run = async (kind: "pdf" | "xlsx" | "csv") => {
    if (!project) return;
    setBusy(kind);
    try {
      if (kind === "pdf") await exportPdf(rows, project);
      if (kind === "xlsx") await exportExcel(rows, project.name);
      if (kind === "csv") await exportCsv(rows, project.name);
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
                ...floors.map((f) => ({ value: String(f.number), label: `Floor ${f.number}` })),
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
              Open items only
            </label>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Button className="h-14 text-base" disabled={busy !== null} onClick={() => void run("pdf")}>
            <FileText className="mr-2 h-5 w-5" /> {busy === "pdf" ? "Building…" : "PDF report"}
          </Button>
          <Button
            variant="secondary"
            className="h-14 text-base"
            disabled={busy !== null}
            onClick={() => void run("xlsx")}
          >
            <FileSpreadsheet className="mr-2 h-5 w-5" /> Excel (.xlsx)
          </Button>
          <Button
            variant="outline"
            className="h-14 text-base"
            disabled={busy !== null}
            onClick={() => void run("csv")}
          >
            <FileDown className="mr-2 h-5 w-5" /> CSV
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
