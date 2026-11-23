import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { checkArrivePingNow } from "@/lib/arriveping/arriveping.functions";

/**
 * When a project's visits are on screen, asks the server to check open visits against ArrivePing. The server runs at most
 * one check every two minutes for everyone, so this is cheap to call; when something changed, the visits reload.
 */
export function useArrivePingCheck(projectId: string, enabled: boolean) {
  const checkFn = useServerFn(checkArrivePingNow);
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    checkFn({ data: {} })
      .then((r) => {
        if (!live || !r.updated) return;
        void qc.invalidateQueries({ queryKey: ["visits", projectId] });
        void qc.invalidateQueries({ queryKey: ["visit-events", projectId] });
      })
      // A check that fails is retried on the next page open; it never gets in the way of the page.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [checkFn, enabled, projectId, qc]);
}
