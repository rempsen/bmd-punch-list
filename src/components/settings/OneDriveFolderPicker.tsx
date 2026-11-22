import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { msListFolders } from "@/lib/ms/ms.functions";
import { errText } from "@/lib/platform/db";

type Crumb = { id: string | null; name: string };

/** Browse the library account's OneDrive folders and pick one. Read-only: nothing is created or changed. */
export function OneDriveFolderPicker({
  title,
  description,
  start,
  onPick,
  onClose,
}: {
  title: string;
  description: string;
  /** Where browsing starts; the top of OneDrive when omitted. */
  start?: Crumb | undefined;
  onPick: (id: string, path: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const listFn = useServerFn(msListFolders);
  const [trail, setTrail] = useState<Crumb[]>([start ?? { id: null, name: "OneDrive" }]);
  const here = trail[trail.length - 1]!;
  const [busy, setBusy] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ms-folders", here.id],
    queryFn: () => listFn({ data: { parentId: here.id } }),
  });
  const path = trail.map((c) => c.name).join(" › ");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
          {trail.map((c, i) => (
            <span key={`${c.id}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button type="button" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))} className="rounded px-1 py-0.5 font-medium enabled:text-primary enabled:hover:underline">
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="max-h-72 min-h-32 overflow-y-auto rounded-md border border-border">
          {isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="p-3 text-sm text-destructive">{errText(error)}</p>}
          {data && data.folders.length === 0 && <p className="p-3 text-sm text-muted-foreground">No folders in here.</p>}
          <ul className="divide-y divide-border">
            {data?.folders.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => setTrail([...trail, f])} className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-muted">
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!here.id || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPick(here.id!, path);
              } finally {
                setBusy(false);
              }
            }}
          >
            {here.id ? `Use "${here.name}"` : "Open a folder first"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
