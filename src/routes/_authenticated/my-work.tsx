import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Camera, CheckCircle2, Hammer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import {
  floorLabel,
  useDeficiencies,
  useInvalidateDeficiencies,
  usePhotos,
  useProject,
  useUpdateDeficiency,
  type DefRow,
} from "@/lib/data";
import { uploadDeficiencyPhoto, useSignedUrls } from "@/lib/photos";

export const Route = createFileRoute("/_authenticated/my-work")({
  head: () => ({
    meta: [
      { title: "My work — BMD Deficiency Tracker" },
      { name: "description", content: "Open must-fix work for tradespeople." },
      { property: "og:title", content: "My work — BMD Deficiency Tracker" },
      { property: "og:description", content: "Open must-fix work for tradespeople." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyWorkPage,
});

const WORK = ["fix_required", "in_progress", "fixed"];

function MyWorkPage() {
  const { data: project } = useProject();
  const { data: items = [] } = useDeficiencies(project?.id);
  const work = useMemo(
    () =>
      items
        .filter((i) => WORK.includes(i.status))
        .sort((a, b) => (a.locations?.name ?? "").localeCompare(b.locations?.name ?? "", undefined, { numeric: true })),
    [items],
  );
  const ids = useMemo(() => work.map((i) => i.id), [work]);
  const { data: photos = [] } = usePhotos(ids);
  const paths = useMemo(() => photos.map((p) => p.storage_path), [photos]);
  const { data: urls = {} } = useSignedUrls(paths);

  const groups = useMemo(() => {
    const m = new Map<number, { label: string; items: DefRow[] }>();
    for (const i of work) {
      const f = i.locations?.floors;
      const n = f?.number ?? -1;
      if (!m.has(n)) m.set(n, { label: floorLabel(f), items: [] });
      m.get(n)!.items.push(i);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }, [work]);

  return (
    <div>
      <PageHeader title="My work" subtitle={`${work.length} open must-fix items`} />
      <div className="space-y-6 p-4 md:p-6">
        {work.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing to fix right now.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground uppercase">{g.label}</h2>
            <ul className="space-y-3">
              {g.items.map((d) => {
                const before = photos.find((p) => p.deficiency_id === d.id && p.kind === "before");
                const hasAfter = photos.some((p) => p.deficiency_id === d.id && p.kind === "after");
                return (
                  <WorkCard
                    key={d.id}
                    item={d}
                    beforeUrl={before ? urls[before.storage_path] : undefined}
                    hasAfter={hasAfter}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function WorkCard({ item, beforeUrl, hasAfter }: { item: DefRow; beforeUrl?: string | undefined; hasAfter: boolean }) {
  const { user, can } = useAuth();
  const update = useUpdateDeficiency();
  const invalidate = useInvalidateDeficiencies();
  const [busy, setBusy] = useState(false);

  const move = (status: "in_progress" | "fixed") =>
    update.mutate(
      { id: item.id, patch: { status } },
      {
        onSuccess: () => toast.success(status === "fixed" ? "Marked fixed" : "Work started"),
        onError: (e) => toast.error(e.message),
      },
    );

  const addAfterAndFix = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) await uploadDeficiencyPhoto(item.id, f, "after", user?.id);
      invalidate();
      if (item.status !== "fixed") move("fixed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex gap-3">
        <Link to="/item/$id" params={{ id: item.id }} className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
          {beforeUrl ? (
            <img src={beforeUrl} alt="Before" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">No photo</div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/item/$id" params={{ id: item.id }} className="font-semibold">
              {itemNo(item.item_number)} · {item.locations?.name}
            </Link>
            <StatusBadge value={item.status} />
          </div>
          <p className="truncate text-sm">{item.material} — {item.issue_type}</p>
          <p className="truncate text-xs text-muted-foreground">{item.area}</p>
          {item.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {item.status === "fix_required" ? (
          <Button className="h-12" variant="secondary" onClick={() => move("in_progress")}>
            <Hammer className="mr-2 h-4 w-4" /> Start work
          </Button>
        ) : (
          <div />
        )}
        {item.status !== "fixed" && can("add_photos") && (
          hasAfter ? (
            <Button className="h-12" onClick={() => move("fixed")}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Mark fixed
            </Button>
          ) : (
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              <Camera className="mr-2 h-4 w-4" /> {busy ? "Uploading…" : "After photo & fix"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                disabled={busy}
                onChange={(e) => void addAfterAndFix(e.target.files)}
              />
            </label>
          )
        )}
        {item.status === "fixed" && (
          <p className="col-span-2 text-center text-sm text-muted-foreground">Fixed — waiting for verification</p>
        )}
      </div>
    </li>
  );
}
