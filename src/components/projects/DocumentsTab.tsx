import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, FileText, Image as ImageIcon, Pause, Play, RotateCw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useProjectDocuments, useRefreshDocuments } from "@/lib/documents/data";
import { SECTIONS, checkFile, formatBytes, groupVersions, guessSection, previewKind, sectionLabel, type DocRow, type DocSection } from "@/lib/documents/logic";
import { signedUrl, uploadDocument, type UploadHandle } from "@/lib/documents/upload";
import { DocumentSearch, TextIndexStatus } from "@/components/projects/DocumentText";
import { errText } from "@/lib/platform/db";
import { shortDate, staffName, useBmdStaff } from "@/lib/projects/data";
import { cn } from "@/lib/utils";

type Job = {
  key: string;
  file: File;
  section: DocSection;
  sent: number;
  state: "uploading" | "paused" | "failed" | "done";
  error?: string | undefined;
  handle?: UploadHandle | undefined;
};

export function DocumentsTab({ projectId }: { projectId: string }) {
  const { canAny, isSuperAdmin } = useAuth();
  const canView = isSuperAdmin || canAny("view_documents");
  const canAdd = isSuperAdmin || canAny("manage_documents");
  const { data: docs = [], isLoading, error } = useProjectDocuments(canView ? projectId : null);
  const { data: staff = [] } = useBmdStaff(canAny("view_pipeline"));
  const refresh = useRefreshDocuments(projectId);
  const [target, setTarget] = useState<DocSection | "auto">("auto");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<DocRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const grouped = useMemo(() => groupVersions(docs), [docs]);

  const patch = (key: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...p } : j)));

  const run = (job: Job) => {
    const handle = uploadDocument({
      projectId,
      section: job.section,
      file: job.file,
      onProgress: (sent) => patch(job.key, { sent }),
    });
    patch(job.key, { handle, state: "uploading", error: undefined });
    handle.done
      .then(() => {
        patch(job.key, { state: "done", sent: job.file.size });
        refresh();
      })
      .catch((e) => patch(job.key, { state: "failed", error: errText(e) }));
  };

  const add = (files: FileList | File[]) => {
    const fresh: Job[] = [];
    for (const file of Array.from(files)) {
      const problem = checkFile(file);
      if (problem) {
        toast.error(problem);
        continue;
      }
      fresh.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        section: target === "auto" ? guessSection(file.name, file.type) : target,
        sent: 0,
        state: "uploading",
      });
    }
    if (fresh.length === 0) return;
    setJobs((js) => [...fresh, ...js]);
    fresh.forEach(run);
  };

  // When the connection comes back, pick up anything that gave up while offline.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onOnline = () => jobsRef.current.filter((j) => j.state === "failed").forEach((j) => runRef.current(j));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  if (!canView) return <p className="text-sm text-muted-foreground">You don't have access to this project's documents.</p>;

  const active = jobs.filter((j) => j.state !== "done");

  return (
    <div className="space-y-4">
      {canAdd && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) add(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-lg border-2 border-dashed bg-card p-5 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">Drop plans, specs and other files here</p>
          <p className="text-xs text-muted-foreground">Up to 250 MB each. A file with the same name in the same section is saved as a new version.</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              File under
              <select
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value as DocSection | "auto")}
              >
                <option value="auto">Choose for me</option>
                {SECTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button className="h-11" onClick={() => inputRef.current?.click()}>
              Choose files
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {jobs.length > 0 && (
        <section aria-label="Uploads" className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">{active.length > 0 ? `Uploading ${active.length} ${active.length === 1 ? "file" : "files"}` : "Uploads finished"}</h2>
            {active.length === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setJobs([])}>
                Clear
              </Button>
            )}
          </header>
          <ul className="divide-y divide-border">
            {jobs.map((j) => {
              const pct = Math.min(100, Math.round((j.sent / j.file.size) * 100));
              return (
                <li key={j.key} className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{j.file.name}</p>
                      <p className={cn("text-xs", j.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                        {j.state === "failed"
                          ? j.error
                          : j.state === "done"
                            ? `Saved to ${sectionLabel(j.section)}`
                            : `${sectionLabel(j.section)} · ${formatBytes(j.sent)} of ${formatBytes(j.file.size)}${j.state === "paused" ? " · paused" : ""}`}
                      </p>
                    </div>
                    {j.state === "uploading" && (
                      <IconButton
                        label={`Pause ${j.file.name}`}
                        onClick={() => {
                          j.handle?.pause();
                          patch(j.key, { state: "paused" });
                        }}
                      >
                        <Pause className="h-4 w-4" />
                      </IconButton>
                    )}
                    {j.state === "paused" && (
                      <IconButton
                        label={`Resume ${j.file.name}`}
                        onClick={() => {
                          j.handle?.resume();
                          patch(j.key, { state: "uploading" });
                        }}
                      >
                        <Play className="h-4 w-4" />
                      </IconButton>
                    )}
                    {j.state === "failed" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => run(j)}>
                          <RotateCw className="mr-1.5 h-4 w-4" /> Retry
                        </Button>
                        <IconButton label={`Dismiss ${j.file.name}`} onClick={() => setJobs((js) => js.filter((x) => x.key !== j.key))}>
                          <X className="h-4 w-4" />
                        </IconButton>
                      </>
                    )}
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${j.file.name} upload`}>
                    <div className={cn("h-full transition-[width]", j.state === "failed" ? "bg-destructive" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-destructive">Could not load documents: {errText(error)}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {canView && docs.length > 0 && (
        <>
          <DocumentSearch projectId={projectId} docs={docs} onOpen={(d) => (previewKind(d.mime, d.file_name) ? setPreview(d) : void download(d))} />
          <TextIndexStatus projectId={projectId} docs={docs} onChanged={refresh} />
        </>
      )}
      {!isLoading && !error && docs.length === 0 && jobs.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">No documents yet.</p>
      )}

      {SECTIONS.filter((s) => grouped[s.value].length > 0).map((s) => (
        <section key={s.value} className="rounded-lg border border-border bg-card">
          <header className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">{s.label}</h2>
            <span className="text-xs text-muted-foreground">{grouped[s.value].length}</span>
          </header>
          <ul className="divide-y divide-border">
            {grouped[s.value].map((e) => (
              <Entry key={e.latest.id} latest={e.latest} older={e.older} uploader={(id) => staffName(staff, id ?? undefined)} onOpen={setPreview} />
            ))}
          </ul>
        </section>
      ))}

      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

async function download(doc: DocRow) {
  try {
    window.location.assign(await signedUrl(doc.storage_path, doc.file_name));
  } catch (e) {
    toast.error(errText(e));
  }
}

function Entry({
  latest,
  older,
  uploader,
  onOpen,
}: {
  latest: DocRow;
  older: DocRow[];
  uploader: (id: string | null) => string | null;
  onOpen: (d: DocRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const row = (d: DocRow, current: boolean) => {
    const kind = previewKind(d.mime, d.file_name);
    const Icon = kind === "image" ? ImageIcon : FileText;
    return (
      <div className={cn("flex items-center gap-3 px-4 py-2.5", !current && "bg-muted/40 pl-11")}>
        {current && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => (kind ? onOpen(d) : void download(d))}
            className="max-w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current ? d.file_name : `Version ${d.version}`}
          </button>
          <p className="truncate text-xs text-muted-foreground">
            {[
              current && d.version > 1 ? `Version ${d.version}` : null,
              formatBytes(d.size_bytes),
              shortDate(d.created_at),
              uploader(d.uploaded_by),
              d.note,
              d.mirror_status === "done" ? "In OneDrive" : d.mirror_status === "failed" ? "OneDrive copy failed" : null,
              d.text_status === "no_text" ? "scanned — no text yet" : d.text_status === "failed" ? "text not read" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {current && older.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-10 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {older.length} earlier <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        )}
        <IconButton label={`Download ${d.file_name}${current ? "" : ` version ${d.version}`}`} onClick={() => void download(d)}>
          <Download className="h-4 w-4" />
        </IconButton>
      </div>
    );
  };
  return (
    <li>
      {row(latest, true)}
      {open && older.map((d) => <div key={d.id}>{row(d, false)}</div>)}
    </li>
  );
}

function PreviewDialog({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const kind = previewKind(doc.mime, doc.file_name);
  useEffect(() => {
    let live = true;
    signedUrl(doc.storage_path)
      .then((u) => live && setUrl(u))
      .catch((e) => live && setProblem(errText(e)));
    return () => {
      live = false;
    };
  }, [doc.storage_path]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{doc.file_name}</DialogTitle>
          <DialogDescription>
            {sectionLabel(doc.section)} · Version {doc.version} · {formatBytes(doc.size_bytes)}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted">
          {problem ? (
            <p className="p-6 text-sm text-destructive">Could not open the file: {problem}</p>
          ) : !url ? (
            <p className="p-6 text-sm text-muted-foreground">Opening…</p>
          ) : kind === "pdf" ? (
            <iframe title={doc.file_name} src={url} className="h-full w-full" />
          ) : (
            <img src={url} alt={doc.file_name} className="mx-auto max-h-full max-w-full object-contain" />
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => void download(doc)}>
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
