import { Link } from "@tanstack/react-router";
import { useInstallationRooms } from "@/lib/installation/data";
import { cn } from "@/lib/utils";

export function InstallTiles({ tiles }: { tiles: { ready: number; inProgress: number; blocked: number } }) {
  const t = [
    { label: "Ready to install", n: tiles.ready, cls: "border-emerald-200 bg-emerald-50 text-emerald-900" },
    { label: "In progress", n: tiles.inProgress, cls: "border-blue-200 bg-blue-50 text-blue-900" },
    { label: "Blocked", n: tiles.blocked, cls: "border-destructive/30 bg-destructive/5 text-destructive" },
  ];
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 md:gap-3">
      {t.map((x) => (
        <div key={x.label} className={cn("rounded-lg border p-3", x.cls)}>
          <div className="text-2xl font-semibold tabular-nums">{x.n}</div>
          <div className="text-xs font-medium">{x.label}</div>
        </div>
      ))}
    </div>
  );
}


/** Compact Installation panel for the job's Overview tab. */
export function InstallationPanel({ projectId }: { projectId: string }) {
  const data = useInstallationRooms(projectId);
  return (
    <section className="mt-4 rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Installation</h2>
        <Link to="/installation" search={{ job: projectId }} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          Open Installation Progress
        </Link>
      </div>
      {data.loading ? <p className="text-sm text-muted-foreground">Loading…</p> : <InstallTiles tiles={data.tiles} />}
    </section>
  );
}
