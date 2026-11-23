import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSavedMessage, workspaceUrl } from "@/lib/takeoff/workspace";

const PreviousTakeoff = lazy(() => import("@/components/takeoff/TakeoffTab"));

/**
 * The project's takeoff: the OpenTakeoff workspace, shown full width and as tall as the window allows.
 * It can also fill the whole screen or open in a window of its own (handy on a second monitor).
 */
export function TakeoffWorkspace({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(200);
  const [previous, setPrevious] = useState(false);
  const url = workspaceUrl(projectId);

  // Fill the window from wherever the frame starts down to the bottom edge.
  useEffect(() => {
    const measure = () => box.current && setTop(Math.round(box.current.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [previous]);

  // The workspace says when it has saved; quantities elsewhere in the project are then re-read.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isSavedMessage(e, window.location.origin, projectId)) return;
      void qc.invalidateQueries({ queryKey: ["estimate", projectId] });
      void qc.invalidateQueries({ queryKey: ["takeoff", projectId] });
      void qc.invalidateQueries({ queryKey: ["documents", projectId] });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [projectId, qc]);

  if (previous) {
    return (
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <p className="mb-3 rounded-md border border-border bg-card p-3 text-sm">
          This is the previous takeoff screen, kept until its measurements are no longer needed. New takeoffs are done in the workspace.{" "}
          <button type="button" className="font-medium underline" onClick={() => setPrevious(false)}>
            Back to the takeoff workspace
          </button>
        </p>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <PreviousTakeoff projectId={projectId} />
        </Suspense>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">The project's plans load on their own. Everything you measure is saved to this project.</p>
        <Button size="sm" variant="outline" onClick={() => void box.current?.requestFullscreen?.()}>
          <Maximize2 className="mr-1.5 h-4 w-4" aria-hidden /> Full screen
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.open(url, `bmd-takeoff-${projectId}`, "popup,width=1600,height=1000")}>
          <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden /> Open in its own window
        </Button>
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setPrevious(true)}>
          Open the previous takeoff screen
        </button>
      </div>
      <div ref={box} className="bg-background" style={{ height: `max(480px, calc(100dvh - ${top}px))` }}>
        <iframe title="Takeoff workspace" src={url} className="block h-full w-full border-0" allow="fullscreen; clipboard-write" />
      </div>
    </div>
  );
}
