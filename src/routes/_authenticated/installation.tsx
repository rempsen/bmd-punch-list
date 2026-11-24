import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Circle, Download, Minus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import { useInstallationRooms, useSetProgress, type AreaProgress, type InstallRoom, type ProgressPatch } from "@/lib/installation/data";
import {
  BLOCKER_KINDS,
  BLOCKER_LABEL,
  PROGRESS_LABEL,
  PROGRESS_STATUSES,
  READINESS_LABEL,
  tileCounts,
  type BlockerKind,
  type ProgressStatus,
  type Readiness,
} from "@/lib/installation/logic";
import { scopeLabel } from "@/lib/job-wizard";
import { toCsv } from "@/lib/projects/pipeline";
import { usePipelineProjects } from "@/lib/projects/data";
import { cn } from "@/lib/utils";
import { InstallTiles } from "@/components/installation/InstallTiles";

type Search = { job?: string | undefined; floor?: string | undefined };

export const Route = createFileRoute("/_authenticated/installation")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    job: typeof s["job"] === "string" && s["job"] ? s["job"] : undefined,
    floor: typeof s["floor"] === "string" && s["floor"] ? s["floor"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Installation Progress · BMD Materials" },
      { name: "description", content: "Per-room install status for every scope, with readiness and blockers." },
      { property: "og:title", content: "Installation Progress · BMD Materials" },
      { property: "og:description", content: "Per-room install status, readiness and blockers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InstallationPage,
});

function InstallationPage() {
  const { canAny } = useAuth();
  if (!canAny("view_dashboard") && !canAny("view_pipeline")) return <Navigate to="/" replace />;
  return <Installation />;
}

const STATUS_CHIP: Record<ProgressStatus, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-900",
  in_progress: "border-blue-200 bg-blue-50 text-blue-900",
  not_started: "border-border bg-muted text-muted-foreground",
  not_required: "border-dashed border-border bg-card text-muted-foreground",
};
const STATUS_ICON = { complete: Check, in_progress: RefreshCw, not_started: Circle, not_required: Minus } as const;
const READY_CHIP: Record<Readiness, string> = {
  installed: "bg-emerald-100 text-emerald-900",
  in_progress: "bg-blue-100 text-blue-900",
  blocked: "bg-destructive/10 text-destructive",
  not_ready: "bg-muted text-muted-foreground",
};

function Installation() {
  const { canAny, user, currentJob } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/installation" });
  const set = (patch: Partial<Search>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  const projects = usePipelineProjects();
  const jobs = useMemo(() => (projects.data ?? []).filter((p) => p.stage === "won" || p.stage === "in_progress"), [projects.data]);
  const jobId = search.job ?? (jobs.find((j) => j.id === currentJob?.id) ?? jobs[0])?.id ?? null;
  const data = useInstallationRooms(jobId);
  const canEdit = canAny("capture_items") || canAny("manage_projects");
  const setProgress = useSetProgress(jobId, user?.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [jobId]);

  const rooms = data.rooms.filter((r) => !search.floor || r.floorId === search.floor);
  const byFloor = useMemo(() => {
    const m = new Map<string, InstallRoom[]>();
    for (const r of rooms) (m.get(r.floorLabel) ?? m.set(r.floorLabel, []).get(r.floorLabel)!).push(r);
    return [...m];
  }, [rooms]);

  const save = (roomIds: string[], scope: string, patch: ProgressPatch) => {
    const current = new Map<string, AreaProgress | undefined>(roomIds.map((id) => [id, data.rooms.find((r) => r.id === id)?.rows[scope]]));
    setProgress.mutate(
      { rooms: roomIds, scope, patch, current },
      { onError: (e) => toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`) },
    );
  };
  const saveBlocker = (room: InstallRoom, text: string | null, kind: BlockerKind | null) => {
    if (text == null && kind == null) {
      for (const s of data.scopes) if (room.rows[s]?.blocker || room.rows[s]?.blocker_kind) save([room.id], s, { blocker: null, blocker_kind: null });
    } else save([room.id], data.scopes[0]!, { blocker: text, blocker_kind: kind });
  };

  const exportCsv = () => {
    const rows = [
      ["Floor", "Room", ...data.scopes.map(scopeLabel), "Readiness", "Blocker", "Open must-fix"],
      ...rooms.map((r) => [
        r.floorLabel, r.name,
        ...data.scopes.map((s) => PROGRESS_LABEL[r.rows[s]?.status ?? "not_started"]),
        READINESS_LABEL[r.ready.state], r.ready.blocker?.text ?? null, r.mustFix || null,
      ]),
    ];
    const url = URL.createObjectURL(new Blob([`\uFEFF${toCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `bmd-installation-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const field = "h-10 rounded-md border border-input bg-background px-2 text-sm";
  const allSel = rooms.length > 0 && rooms.every((r) => selected.has(r.id));

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        title="Installation Progress"
        subtitle="Per-area status for each scope, with readiness and blockers"
        actions={<Button size="sm" variant="outline" onClick={exportCsv} disabled={!rooms.length}><Download className="mr-1 h-4 w-4" />Export</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Job" className={field} value={jobId ?? ""} onChange={(e) => set({ job: e.target.value || undefined, floor: undefined })}>
          {!jobs.length && <option value="">No won or in-progress jobs</option>}
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.project_number ? `${j.project_number} · ` : ""}{j.name}</option>)}
        </select>
        <select aria-label="Floor" className={field} value={search.floor ?? ""} onChange={(e) => set({ floor: e.target.value || undefined })}>
          <option value="">All floors</option>
          {data.floors.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      <InstallTiles tiles={tileCounts(rooms.map((r) => r.ready.state))} />

      {canEdit && selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          {data.scopes.map((s) => (
            <Popover key={s}>
              <PopoverTrigger asChild><Button size="sm" variant="outline">Set {scopeLabel(s)}</Button></PopoverTrigger>
              <PopoverContent className="w-48 p-1">
                {PROGRESS_STATUSES.map((st) => (
                  <button key={st} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { save([...selected], s, { status: st }); setSelected(new Set()); }}>
                    {PROGRESS_LABEL[st]}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {data.error ? (
        <p className="text-sm text-destructive">{data.error instanceof Error ? data.error.message : String(data.error)}</p>
      ) : data.loading || projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rooms.length ? (
        <p className="rounded-md border bg-card p-6 text-center text-sm text-muted-foreground">No rooms set up for this job yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {canEdit && <th className="w-8 px-2 py-2"><input type="checkbox" aria-label="Select all" checked={allSel} onChange={() => setSelected(allSel ? new Set() : new Set(rooms.map((r) => r.id)))} /></th>}
                <th className="px-3 py-2">Location / Area</th>
                {data.scopes.map((s) => <th key={s} className="px-3 py-2">{scopeLabel(s)}</th>)}
                <th className="px-3 py-2">Readiness</th>
                <th className="px-3 py-2">Blocker</th>
                <th className="px-3 py-2">Deficiencies</th>
              </tr>
            </thead>
            <tbody>
              {byFloor.map(([floor, list]) => (
                <FloorRows key={floor} floor={floor} cols={data.scopes.length + 4 + (canEdit ? 1 : 0)}>
                  {list.map((r) => (
                    <tr key={r.id} className={cn("border-t", r.ready.state === "blocked" && "bg-destructive/5")}>
                      {canEdit && <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => setSelected((p) => { const n = new Set(p); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; })} /></td>}
                      <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.floorLabel}</div></td>
                      {data.scopes.map((s) => (
                        <td key={s} className="px-3 py-2">
                          <StatusChip status={r.rows[s]?.status ?? "not_started"} fromArrivePing={r.rows[s]?.source === "arriveping"} disabled={!canEdit} onPick={(st) => save([r.id], s, { status: st })} />
                        </td>
                      ))}
                      <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", READY_CHIP[r.ready.state])}>{READINESS_LABEL[r.ready.state]}</span></td>
                      <td className="px-3 py-2"><BlockerCell room={r} disabled={!canEdit} onSave={(t, k) => saveBlocker(r, t, k)} /></td>
                      <td className="px-3 py-2">{r.mustFix > 0 ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{r.mustFix} must fix</span> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  ))}
                </FloorRows>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


function FloorRows({ floor, cols, children }: { floor: string; cols: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-t bg-muted/30"><td colSpan={cols} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{floor}</td></tr>
      {children}
    </>
  );
}

function StatusChip({ status, fromArrivePing, disabled, onPick }: { status: ProgressStatus; fromArrivePing: boolean; disabled: boolean; onPick: (s: ProgressStatus) => void }) {
  const Icon = STATUS_ICON[status];
  const chip = (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_CHIP[status])} title={fromArrivePing ? "Set from ArrivePing" : undefined}>
      <Icon className="h-3 w-3" />{PROGRESS_LABEL[status]}
    </span>
  );
  if (disabled) return chip;
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={`Change status, now ${PROGRESS_LABEL[status]}`}>{chip}</button></PopoverTrigger>
      <PopoverContent className="w-44 p-1">
        {PROGRESS_STATUSES.map((s) => (
          <button key={s} className={cn("block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted", s === status && "font-semibold")} onClick={() => onPick(s)}>{PROGRESS_LABEL[s]}</button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function BlockerCell({ room, disabled, onSave }: { room: InstallRoom; disabled: boolean; onSave: (text: string | null, kind: BlockerKind | null) => void }) {
  const b = room.ready.blocker;
  const stored = b && !b.auto ? b : null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(stored?.text ?? "");
  const [kind, setKind] = useState<BlockerKind>(stored?.kind ?? "other");
  useEffect(() => { if (open) { setText(stored?.text ?? ""); setKind(stored?.kind ?? "other"); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = b ? (
    <span className="inline-flex items-center gap-1 text-left text-xs font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{b.text}</span>
  ) : <span className="text-muted-foreground">—</span>;
  if (disabled) return view;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><button type="button" aria-label={`Blocker for ${room.name}`}>{view}</button></PopoverTrigger>
      <PopoverContent className="w-64 space-y-2">
        {b?.auto && <p className="text-xs text-muted-foreground">"Awaiting material" shows until this job's material is on site.</p>}
        <select aria-label="Blocker kind" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as BlockerKind)}>
          {BLOCKER_KINDS.map((k) => <option key={k} value={k}>{BLOCKER_LABEL[k]}</option>)}
        </select>
        <Input placeholder="e.g. Room locked" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex justify-between">
          <Button size="sm" variant="ghost" disabled={!stored} onClick={() => { onSave(null, null); setOpen(false); }}>Clear</Button>
          <Button size="sm" onClick={() => { onSave(text.trim() || null, kind); setOpen(false); }}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
