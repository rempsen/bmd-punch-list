import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";
import { OneDriveFolderPicker } from "@/components/settings/OneDriveFolderPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { msConfirmClientFolders, msMatchClientFolders, msSetRoot } from "@/lib/ms/ms.functions";
import { db, errText } from "@/lib/platform/db";

type Proposal = { clientId: string; clientName: string; folderId: string; folderName: string };
type QueueItem = { id: string; action: string; status: string; attempts: number; last_error: string | null; project: { name: string } | null; document: { file_name: string } | null };

/** Library folder, client folder matching and mirror health. Shown once the library account is connected. */
export function OneDriveMirrorPanel({ rootPath }: { rootPath: string | null }) {
  const qc = useQueryClient();
  const setRootFn = useServerFn(msSetRoot);
  const matchFn = useServerFn(msMatchClientFolders);
  const confirmFn = useServerFn(msConfirmClientFolders);
  const [picking, setPicking] = useState(false);
  const [match, setMatch] = useState<{ proposals: Proposal[]; folderCount: number; matched: number; clientCount: number } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const { data: queue = [] } = useQuery({
    queryKey: ["mirror-queue"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db
        .from("onedrive_mirror_queue")
        .select("id,action,status,attempts,last_error,project:projects(name),document:project_documents(file_name)")
        .neq("status", "done")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as QueueItem[];
    },
  });
  const failed = queue.filter((q) => q.status === "failed");
  const waiting = queue.filter((q) => q.status === "pending");

  const findMatches = async () => {
    setBusy("match");
    try {
      const res = await matchFn();
      setMatch(res);
      setTicked(new Set(res.proposals.map((p) => p.clientId)));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!match) return;
    setBusy("confirm");
    try {
      const { saved } = await confirmFn({ data: { pairs: match.proposals.filter((p) => ticked.has(p.clientId)).map((p) => ({ clientId: p.clientId, folderId: p.folderId })) } });
      toast.success(`${saved} client ${saved === 1 ? "folder" : "folders"} matched`);
      setMatch(null);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const retry = async (id: string) => {
    const { error } = await db.rpc("retry_mirror", { _id: id });
    if (error) toast.error(error.message);
    else {
      toast.success("Queued to try again");
      void qc.invalidateQueries({ queryKey: ["mirror-queue"] });
    }
  };

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div>
        <p className="text-sm font-medium">Library folder</p>
        <p className="text-sm text-muted-foreground">{rootPath ?? "Not chosen yet. Pick the folder that holds your client folders."}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button className="h-11" variant="outline" onClick={() => setPicking(true)}>
            {rootPath ? "Change folder" : "Choose folder"}
          </Button>
          <Button className="h-11" variant="outline" disabled={!rootPath || !!busy} onClick={() => void findMatches()}>
            {busy === "match" ? "Looking…" : "Match client folders"}
          </Button>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Mirror health</p>
        <p className="text-sm text-muted-foreground">
          {failed.length === 0 && waiting.length === 0
            ? "Everything is copied."
            : `${waiting.length} waiting to copy${failed.length ? `, ${failed.length} failed` : ""}.`}
          {!rootPath && waiting.length > 0 ? " Copying starts once a library folder is chosen." : ""}
        </p>
        {failed.length > 0 && (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {failed.map((q) => (
              <li key={q.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{q.document?.file_name ?? "Project folders"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {q.project?.name} · {q.last_error ?? "Failed"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void retry(q.id)}>
                  <RotateCw className="mr-1.5 h-4 w-4" /> Retry
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {picking && (
        <OneDriveFolderPicker
          title="Choose the library folder"
          description="Open the folder that holds one folder per client, then confirm. Nothing in OneDrive is changed by choosing."
          onClose={() => setPicking(false)}
          onPick={async (id, path) => {
            try {
              await setRootFn({ data: { itemId: id, path } });
              await qc.invalidateQueries({ queryKey: ["ms-status"] });
              toast.success("Library folder saved");
              setPicking(false);
            } catch (e) {
              toast.error(errText(e));
            }
          }}
        />
      )}

      {match && (
        <Dialog open onOpenChange={(o) => !o && setMatch(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Match client folders</DialogTitle>
              <DialogDescription>
                {match.folderCount} folders in the library, {match.matched} of {match.clientCount} clients already matched. Tick the pairs that are right.
                Clients left unmatched get a new folder when their first project is created.
              </DialogDescription>
            </DialogHeader>
            {match.proposals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new name matches found.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {match.proposals.map((p) => (
                  <li key={p.clientId}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={ticked.has(p.clientId)}
                        onChange={(e) => {
                          const next = new Set(ticked);
                          if (e.target.checked) next.add(p.clientId);
                          else next.delete(p.clientId);
                          setTicked(next);
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{p.clientName}</span>
                        <span className="block truncate text-xs text-muted-foreground">Folder: {p.folderName}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setMatch(null)}>
                Cancel
              </Button>
              <Button disabled={ticked.size === 0 || busy === "confirm"} onClick={() => void confirm()}>
                {busy === "confirm" ? "Saving…" : `Confirm ${ticked.size}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
