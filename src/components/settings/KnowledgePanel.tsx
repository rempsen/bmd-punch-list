import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Pencil, Plus, StickyNote, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingsBox } from "@/components/settings/SettingsBox";
import { useAuth } from "@/lib/auth";
import { deleteKnowledge, knowledgeFileUrl, saveMemory, setKnowledgeFolder, setKnowledgeVisibility, uploadKnowledgeFile, useKnowledge, VISIBILITY, type KnowledgeItem, type Visibility } from "@/lib/assistant/data";
import { formatBytes } from "@/lib/documents/logic";
import { errText } from "@/lib/platform/db";
import { cn } from "@/lib/utils";

const NO_FOLDER = "(no folder)";

/** Company settings → Knowledge: what the assistant knows beyond the records — written memories and uploaded reference files. */
export function KnowledgePanel() {
  const { can, canAny, isSuperAdmin } = useAuth();
  const canWrite = isSuperAdmin || can("manage_settings");
  const canPrice = isSuperAdmin || canAny("view_pricing");
  const { data: items = [], isLoading, error } = useKnowledge();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["knowledge"] });
  const [editing, setEditing] = useState<KnowledgeItem | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadVisibility, setUploadVisibility] = useState<Visibility>("all_staff");
  const fileInput = useRef<HTMLInputElement>(null);

  const folders = useMemo(() => {
    const groups = new Map<string, KnowledgeItem[]>();
    for (const it of items) {
      const key = it.folder?.trim() || NO_FOLDER;
      groups.set(key, [...(groups.get(key) ?? []), it]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : a.localeCompare(b)));
  }, [items]);
  const folderNames = useMemo(() => [...new Set(items.map((i) => i.folder?.trim()).filter((f): f is string => !!f))].sort(), [items]);

  const run = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await work();
      await refresh();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const upload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      await run(`upload-${file.name}`, () => uploadKnowledgeFile(file, { folder: uploadFolder || null, visibility: uploadVisibility }), `${file.name} added to Knowledge`);
    }
  };

  return (
    <div className="space-y-4">
      <SettingsBox>
        <h2 className="text-base font-semibold">Knowledge</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the assistant knows beyond the job records: short memories (lead times, rules of thumb, who to call) and reference files such as vendor price lists. Every item is for all BMD staff or for pricing staff only. Staff can also add a memory by typing “remember that …” in Ask BMD.
        </p>
        {!canPrice && <p className="mt-2 text-xs text-muted-foreground">Items marked pricing-only are not shown to you.</p>}
        {canWrite && (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="mr-1 h-4 w-4" /> New memory
            </Button>
            <label className="text-xs text-muted-foreground">
              Folder for uploads
              <Input className="mt-1 h-9 w-44" list="knowledge-folders" placeholder="optional" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} maxLength={120} />
              <datalist id="knowledge-folders">
                {folderNames.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <label className="text-xs text-muted-foreground">
              Visibility for uploads
              <select className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm" value={uploadVisibility} onChange={(e) => setUploadVisibility(e.target.value as Visibility)}>
                {VISIBILITY.filter((v) => canPrice || v.value === "all_staff").map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="outline" disabled={busy?.startsWith("upload-") ?? false} onClick={() => fileInput.current?.click()}>
              <Upload className="mr-1 h-4 w-4" /> Upload files
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.doc,.docx,.xls,.xlsx"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </SettingsBox>

      {editing && (
        <MemoryEditor
          item={editing === "new" ? null : editing}
          canPrice={canPrice}
          folders={folderNames}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}

      {error && <p className="text-sm text-destructive">{errText(error)}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && items.length === 0 && <p className="text-sm text-muted-foreground">Nothing in Knowledge yet.</p>}

      {folders.map(([folder, list]) => (
        <section key={folder} aria-label={folder} className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2 text-sm font-medium">{folder}</header>
          <ul className="divide-y divide-border">
            {list.map((it) => (
              <li key={it.id} className="flex flex-wrap items-start gap-2 px-4 py-3 text-sm">
                {it.kind === "memory" ? <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{it.title}</div>
                  {it.kind === "memory" ? (
                    <p className="whitespace-pre-wrap text-muted-foreground">{it.body}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {it.file_name}
                      {it.size_bytes ? ` · ${formatBytes(it.size_bytes)}` : ""}
                      {it.text_status === "done" ? ` · ${it.text_pages ?? 0} page${it.text_pages === 1 ? "" : "s"} searchable` : it.text_status === "no_text" ? " · no text found" : it.text_status === "failed" ? " · text not read" : " · reading text…"}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Updated {new Date(it.updated_at).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {canWrite ? (
                    <select
                      aria-label="Visibility"
                      className={cn("h-8 rounded-md border border-input bg-background px-2 text-xs", it.visibility === "pricing_only" && "border-amber-500/60")}
                      value={it.visibility}
                      disabled={busy === it.id || !canPrice}
                      onChange={(e) => void run(it.id, () => setKnowledgeVisibility(it.id, e.target.value as Visibility))}
                    >
                      {VISIBILITY.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">{VISIBILITY.find((v) => v.value === it.visibility)?.label}</span>
                  )}
                  {it.kind === "file" && (
                    <Button size="sm" variant="ghost" aria-label="Open file" onClick={() => void knowledgeFileUrl(it).then((u) => window.open(u, "_blank", "noopener")).catch((e) => toast.error(errText(e)))}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  )}
                  {canWrite && it.kind === "memory" && (
                    <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(it)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canWrite && it.kind === "file" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === it.id}
                      onClick={() => {
                        const f = window.prompt("Folder for this file (blank for none)", it.folder ?? "");
                        if (f !== null) void run(it.id, () => setKnowledgeFolder(it.id, f));
                      }}
                    >
                      Folder
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Remove"
                      disabled={busy === it.id}
                      onClick={() => {
                        if (window.confirm(`Remove "${it.title}" from Knowledge?`)) void run(it.id, () => deleteKnowledge(it), "Removed");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MemoryEditor({ item, canPrice, folders, onClose, onSaved }: { item: KnowledgeItem | null; canPrice: boolean; folders: string[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [folder, setFolder] = useState(item?.folder ?? "");
  const [visibility, setVisibility] = useState<Visibility>(item?.visibility ?? "all_staff");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveMemory({ ...(item ? { id: item.id } : {}), title, body, folder: folder || null, visibility });
      toast.success(item ? "Memory updated" : "Memory added");
      await onSaved();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsBox aria-label={item ? "Edit memory" : "New memory"}>
      <h3 className="text-sm font-semibold">{item ? "Edit memory" : "New memory"}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">
          Title
          <Input className="mt-1" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Mohawk lead time" />
        </label>
        <label className="block text-sm font-medium sm:col-span-2">
          What to remember
          <Textarea className="mt-1 min-h-24" maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Mohawk carpet takes 2–3 weeks from order; call Dave at the mill for rush." />
        </label>
        <label className="block text-sm font-medium">
          Folder
          <Input className="mt-1" list="knowledge-folders-editor" maxLength={120} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="optional" />
          <datalist id="knowledge-folders-editor">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="block text-sm font-medium">
          Visibility
          <select className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
            {VISIBILITY.filter((v) => canPrice || v.value === "all_staff").map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={saving || !title.trim() || !body.trim()} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </SettingsBox>
  );
}
