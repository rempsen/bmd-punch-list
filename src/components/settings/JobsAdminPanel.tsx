import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Floor = { id: string; label: string; number: number; sort_order: number };
type Loc = { id: string; floor_id: string; name: string; type: string; sort_order: number };
type Item = { id: string; item_number: number; location_id: string; status: string; material: string; issue_type: string };

const dNo = (n: number) => `D-${String(n).padStart(4, "0")}`;
const CLOSED = ["verified", "accepted_as_is"];

function parseRooms(input: string): string[] {
  const out: string[] = [];
  for (const c of input.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
    const r = c.match(/^(\d+)\s*-\s*(\d+)$/);
    if (r) {
      const a = Number(r[1]), b = Number(r[2]);
      if (b >= a && b - a < 500) { for (let n = a; n <= b; n++) out.push(String(n)); continue; }
    }
    out.push(c);
  }
  return [...new Set(out)];
}

function useJobStructure(projectId: string | null) {
  return useQuery({
    queryKey: ["admin-job", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data: floors, error: fe } = await supabase
        .from("floors").select("id,label,number,sort_order").eq("project_id", projectId!).order("sort_order");
      if (fe) throw fe;
      const ids = (floors ?? []).map((f) => f.id);
      const { data: locs, error: le } = ids.length
        ? await supabase.from("locations").select("id,floor_id,name,type,sort_order").in("floor_id", ids).order("sort_order").order("name")
        : { data: [], error: null };
      if (le) throw le;
      const { data: items, error: ie } = await supabase
        .from("deficiencies").select("id,item_number,location_id,status,material,issue_type")
        .eq("project_id", projectId!).order("item_number");
      if (ie) throw ie;
      return { floors: (floors ?? []) as Floor[], locs: (locs ?? []) as Loc[], items: (items ?? []) as Item[] };
    },
  });
}

export function JobsAdminPanel() {
  const { jobs, projectId, setProjectId, canCreateJobs } = useAuth();
  const [jobId, setJobId] = useState<string | null>(projectId);
  const [showArchived, setShowArchived] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, error } = useJobStructure(jobId);
  const [floorId, setFloorId] = useState<string>("");
  const [locId, setLocId] = useState<string>("");
  const [floorNum, setFloorNum] = useState("");
  const [floorLabel, setFloorLabel] = useState("");
  const [rooms, setRooms] = useState("");
  const [common, setCommon] = useState("");
  const [moving, setMoving] = useState<Item | null>(null);

  const job = jobs.find((j) => j.id === jobId) ?? null;
  const floors = data?.floors ?? [];
  const activeFloor = floors.find((f) => f.id === floorId) ?? floors[0];
  const floorLocs = (data?.locs ?? []).filter((l) => l.floor_id === activeFloor?.id);
  const counts = useMemo(() => {
    const m = new Map<string, { open: number; closed: number }>();
    for (const i of data?.items ?? []) {
      const c = m.get(i.location_id) ?? { open: 0, closed: 0 };
      if (CLOSED.includes(i.status)) c.closed++; else c.open++;
      m.set(i.location_id, c);
    }
    return m;
  }, [data]);
  const floorOpen = (fid: string) =>
    (data?.locs ?? []).filter((l) => l.floor_id === fid).reduce((s, l) => s + (counts.get(l.id)?.open ?? 0), 0);
  const shownItems = (data?.items ?? []).filter((i) =>
    locId ? i.location_id === locId : floorLocs.some((l) => l.id === i.location_id),
  );
  const locName = (id: string) => data?.locs.find((l) => l.id === id)?.name ?? "—";

  const refresh = () => void qc.invalidateQueries();
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await p;
    if (error) toast.error(error.message);
    else { toast.success(ok); refresh(); }
    return !error;
  };

  const addFloor = async () => {
    if (!jobId || floorNum === "") return;
    const n = Number(floorNum);
    if (Number.isNaN(n)) return toast.error("Floor number must be a number");
    if (await run(supabase.from("floors").insert({
      project_id: jobId, number: n, label: floorLabel.trim() || (n === 0 ? "Basement" : `Floor ${n}`), sort_order: n,
    }), "Floor added")) { setFloorNum(""); setFloorLabel(""); }
  };
  const addRooms = async () => {
    if (!activeFloor) return;
    const have = new Set(floorLocs.map((l) => l.name));
    const rows = parseRooms(rooms).filter((n) => !have.has(n))
      .map((name, i) => ({ floor_id: activeFloor.id, type: "room" as const, name, sort_order: i }));
    if (!rows.length) return toast.info("Those rooms already exist");
    if (await run(supabase.from("locations").insert(rows), `${rows.length} rooms added`)) setRooms("");
  };
  const addCommon = async () => {
    if (!activeFloor || !common.trim()) return;
    if (await run(supabase.from("locations").insert({
      floor_id: activeFloor.id, type: "common_area", name: common.trim(), sort_order: 50,
    }), "Area added")) setCommon("");
  };
  const removeLoc = async (l: Loc) => {
    if ((counts.get(l.id)?.open ?? 0) + (counts.get(l.id)?.closed ?? 0) > 0)
      return toast.error(`${l.name} has deficiencies. Move them first.`);
    await run(supabase.from("locations").delete().eq("id", l.id), `${l.name} removed`);
  };
  const addDeficiency = () => {
    if (!jobId) return;
    if (jobId !== projectId) {
      setProjectId(jobId);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "project" });
    }
    void navigate({ to: "/capture" });
  };

  const list = jobs.filter((j) => showArchived || !j.archived_at);

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Jobs</h2>
          {canCreateJobs && (
            <Button asChild size="sm" className="h-8">
              <Link to="/new-job"><Plus className="mr-1 h-3.5 w-3.5" /> New job</Link>
            </Button>
          )}
        </div>
        <ul className="space-y-1">
          {list.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => { setJobId(j.id); setFloorId(""); setLocId(""); }}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm",
                  j.id === jobId ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                <span className="block truncate font-medium">{j.name}</span>
                <span className={cn("text-xs", j.id === jobId ? "opacity-80" : "text-muted-foreground")}>
                  {j.archived_at ? "Archived · " : ""}{j.open_count} open
                </span>
              </button>
            </li>
          ))}
        </ul>
        <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived jobs
        </label>
      </aside>

      <div className="min-w-0 space-y-4">
        {!job ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Pick a job on the left.</p>
        ) : (
          <>
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">{job.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {[job.client_name, job.address].filter(Boolean).join(" · ") || "No client or address yet"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/settings" search={{ tab: "projects" }}>Edit or archive</Link>
                  </Button>
                  <Button size="sm" onClick={addDeficiency}><Plus className="mr-1 h-3.5 w-3.5" /> Add a deficiency</Button>
                </div>
              </div>
              {error && <p className="mt-2 text-sm text-destructive">{(error as Error).message}</p>}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">Floors</h3>
              <div className="flex flex-wrap gap-2">
                {floors.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { setFloorId(f.id); setLocId(""); }}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-semibold",
                      f.id === activeFloor?.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {f.label} <span className="font-normal opacity-80">· {floorOpen(f.id)} open</span>
                  </button>
                ))}
                {floors.length === 0 && <p className="text-sm text-muted-foreground">No floors yet.</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input value={floorNum} onChange={(e) => setFloorNum(e.target.value)} placeholder="Floor number (0 = basement)" className="h-10 w-56" />
                <Input value={floorLabel} onChange={(e) => setFloorLabel(e.target.value)} placeholder="Name (optional)" className="h-10 w-48" />
                <Button className="h-10" onClick={addFloor}><Plus className="mr-1 h-4 w-4" /> Add floor</Button>
              </div>
            </section>

            {activeFloor && (
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                  Rooms and areas on {activeFloor.label}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLocId("")}
                    className={cn("rounded-md border px-2 py-1 text-sm", !locId ? "border-primary bg-primary/10 font-semibold" : "border-border")}
                  >
                    All
                  </button>
                  {floorLocs.map((l) => {
                    const c = counts.get(l.id);
                    return (
                      <span
                        key={l.id}
                        className={cn(
                          "flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-sm",
                          locId === l.id ? "border-primary bg-primary/10 font-semibold" : "border-border",
                        )}
                      >
                        <button type="button" className="truncate" title={l.name} onClick={() => setLocId(l.id)}>
                          {l.name}
                          {c && <span className="ml-1 text-xs text-muted-foreground">{c.open} open{c.closed ? ` · ${c.closed} closed` : ""}</span>}
                        </button>
                        <button type="button" aria-label={`Remove ${l.name}`} onClick={() => removeLoc(l)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <Textarea value={rooms} onChange={(e) => setRooms(e.target.value)} placeholder="Room numbers, e.g. 201-228 or 201, 202, 205" className="min-h-[70px]" />
                    <Button className="mt-2 h-10" onClick={addRooms}>Add rooms</Button>
                  </div>
                  <div>
                    <Input value={common} onChange={(e) => setCommon(e.target.value)} placeholder="Common area, e.g. Corridor – North" className="h-10" />
                    <Button className="mt-2 h-10" variant="secondary" onClick={addCommon}>Add common area</Button>
                  </div>
                </div>
              </section>
            )}

            {activeFloor && (
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
                  Deficiencies {locId ? `in ${locName(locId)}` : `on ${activeFloor.label}`} ({shownItems.length})
                </h3>
                {shownItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None here.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {shownItems.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-16 font-semibold">{dNo(i.item_number)}</span>
                        <span className="w-32 truncate">{locName(i.location_id)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{i.material} · {i.issue_type}</span>
                        <span className="hidden text-xs capitalize text-muted-foreground sm:inline">{i.status.replace(/_/g, " ")}</span>
                        {jobId === projectId && (
                          <Link to="/item/$id" params={{ id: i.id }} className="text-xs text-primary underline">Open</Link>
                        )}
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setMoving(i)}>
                          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Move
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {moving && jobId && (
        <MoveDialog item={moving} fromJob={jobId} onClose={() => setMoving(null)} onDone={refresh} />
      )}
    </div>
  );
}

function MoveDialog({ item, fromJob, onClose, onDone }: { item: Item; fromJob: string; onClose: () => void; onDone: () => void }) {
  const { jobs } = useAuth();
  const [job, setJob] = useState(fromJob);
  const [floor, setFloor] = useState("");
  const [loc, setLoc] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useJobStructure(job);
  const locs = (data?.locs ?? []).filter((l) => l.floor_id === floor);

  const save = async () => {
    if (!loc) return;
    setBusy(true);
    const { data: n, error } = await supabase.rpc("move_deficiency", { _id: item.id, _location: loc });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(job === fromJob ? `${dNo(item.item_number)} moved` : `Moved to ${jobs.find((j) => j.id === job)?.name} as ${dNo(n as number)}`);
    onDone();
    onClose();
  };

  const sel = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Move {dNo(item.item_number)}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">Job
            <select className={sel} value={job} onChange={(e) => { setJob(e.target.value); setFloor(""); setLoc(""); }}>
              {jobs.filter((j) => !j.archived_at || j.id === fromJob).map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">Floor
            <select className={sel} value={floor} onChange={(e) => { setFloor(e.target.value); setLoc(""); }}>
              <option value="">Choose a floor</option>
              {(data?.floors ?? []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">Room or area
            <select className={sel} value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!floor}>
              <option value="">Choose a room or area</option>
              {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {job !== fromJob && (
            <p className="text-xs text-muted-foreground">
              Moving to another job gives the item a new D-number there. Photos and history move with it; the person assigned is kept only if they're on the new job.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!loc || busy}>{busy ? "Moving…" : "Move item"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
