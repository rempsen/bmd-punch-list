import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { itemNo } from "@/lib/bmd";
import { useSignedUrls } from "@/lib/photos";
import { ccProjectPhotos } from "@/lib/companycam.functions";

export const Route = createFileRoute("/_authenticated/photos")({
  head: () => ({
    meta: [
      { title: "Job photos — BMD Projects" },
      { name: "description", content: "Every photo on the job: CompanyCam jobsite photos next to deficiency photos uploaded in the tracker." },
      { property: "og:title", content: "Job photos — BMD Projects" },
      { property: "og:description", content: "CompanyCam and tracker photos side by side for each job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PhotosPage,
});

type Viewing = { src: string; title: string; sub: string; link?: { id: string } | undefined; external?: string | undefined };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

function PhotosPage() {
  const { projectId } = useAuth();
  const [view, setView] = useState<Viewing | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Job photos" subtitle="CompanyCam photos and our own uploads, side by side." actions={<Button asChild className="h-11 px-5 text-base font-semibold shadow-md ring-2 ring-accent"><Link to="/companycam" search={{ tab: "inbox" }}><ScanSearch className="mr-2 h-5 w-5" />Review photos for deficiencies</Link></Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OurPhotos projectId={projectId} onOpen={setView} />
        <CcPhotos projectId={projectId} onOpen={setView} />
      </div>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>{view?.title}</DialogTitle></DialogHeader>
          {view && <img src={view.src} alt={view.title} className="max-h-[70vh] w-full rounded-md object-contain" />}
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{view?.sub}</span>
            {view?.link && <Button asChild size="sm"><Link to="/item/$id" params={{ id: view.link.id }}>Open item</Link></Button>}
            {view?.external && <Button asChild size="sm" variant="outline"><a href={view.external} target="_blank" rel="noreferrer">Open in CompanyCam <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {children}
    </section>
  );
}
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{children}</div>;

function Tile({ src, label, onClick }: { src?: string | null | undefined; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!src} className="group relative aspect-square overflow-hidden rounded-md bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {src && <img src={src} alt={label} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />}
      <span className="absolute inset-x-0 bottom-0 truncate bg-primary/80 px-1.5 py-0.5 text-left text-[10px] font-medium text-primary-foreground">{label}</span>
    </button>
  );
}

function OurPhotos({ projectId, onOpen }: { projectId: string | null; onOpen: (v: Viewing) => void }) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["job-photos", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deficiency_photos")
        .select("id,storage_path,kind,taken_at,deficiency_id,deficiencies!inner(item_number,project_id,material,issue_type,locations(name))")
        .eq("deficiencies.project_id", projectId!)
        .order("taken_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as unknown as { id: string; storage_path: string; kind: string; taken_at: string; deficiency_id: string; deficiencies: { item_number: number; material: string; issue_type: string; locations: { name: string } | null } }[];
    },
  });
  const paths = useMemo(() => data.map((p) => p.storage_path), [data]);
  const { data: urls } = useSignedUrls(paths);
  return (
    <Column title="Our photos" count={`${data.length} photo${data.length === 1 ? "" : "s"}`}>
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
        : !data.length ? <p className="text-sm text-muted-foreground">No photos uploaded on this job yet.</p>
        : <Grid>
            {data.map((p) => {
              const d = p.deficiencies;
              const label = `${itemNo(d.item_number)} · ${p.kind === "after" ? "After" : "Before"}`;
              return <Tile key={p.id} src={urls?.[p.storage_path]} label={label}
                onClick={() => urls?.[p.storage_path] && onOpen({ src: urls[p.storage_path]!, title: `${label} · ${d.locations?.name ?? ""}`, sub: `${d.material} · ${d.issue_type} · ${fmt(p.taken_at)}`, link: { id: p.deficiency_id } })} />;
            })}
          </Grid>}
    </Column>
  );
}

function CcPhotos({ projectId, onOpen }: { projectId: string | null; onOpen: (v: Viewing) => void }) {
  const fetchPage = useServerFn(ccProjectPhotos);
  const q = useInfiniteQuery({
    queryKey: ["cc-photos", projectId],
    enabled: !!projectId,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPage({ data: { projectId: projectId!, page: pageParam } }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
  });
  const first = q.data?.pages[0];
  const photos = q.data?.pages.flatMap((p) => p.photos) ?? [];
  return (
    <Column title="CompanyCam" count={first?.state === "ok" ? `${photos.length}${q.hasNextPage ? "+" : ""} shown` : ""}>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading from CompanyCam…</p>
        : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
        : first?.state === "not_connected" ? <p className="text-sm text-muted-foreground">CompanyCam isn't connected yet.</p>
        : first?.state === "not_linked" ? <p className="text-sm text-muted-foreground">This job isn't linked to a CompanyCam project. <Link to="/companycam" className="underline">Link it</Link>.</p>
        : !photos.length ? <p className="text-sm text-muted-foreground">No CompanyCam photos on this job yet.</p>
        : <>
            <Grid>
              {photos.map((p) => (
                <Tile key={p.id} src={p.thumb} label={p.creator ?? "CompanyCam"}
                  onClick={() => onOpen({ src: p.web ?? p.thumb ?? "", title: p.description || "CompanyCam photo", sub: [p.creator, fmt(p.takenAt)].filter(Boolean).join(" · "), external: first?.url ?? undefined })} />
              ))}
            </Grid>
            {q.hasNextPage && (
              <Button variant="outline" className="mt-3 w-full" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                {q.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            )}
          </>}
    </Column>
  );
}
