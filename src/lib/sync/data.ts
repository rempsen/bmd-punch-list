import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";

export type OutboxRow = { id: string; kind: string; bmd_id: string; label: string | null; op: "create" | "update" | "delete"; changes: Record<string, { from: unknown; to: unknown }>; status: "waiting" | "sent" | "failed" | "cancelled"; error: string | null; created_at: string; updated_at: string };
export type LogRow = { id: string; at: string; direction: "in" | "out"; system: string; kind: string; label: string | null; outcome: "applied" | "sent" | "bmd_kept" | "failed" | "skipped"; detail: Record<string, unknown>; reviewed_at: string | null };
export type SyncState = { outbox: OutboxRow[]; waiting: number; log: LogRow[]; links: Record<string, number> };

/** Everything the Sync screen shows: what is waiting to go out, what has moved, and how many records are linked. */
export function useSync(enabled = true) {
  return useQuery({
    queryKey: ["sync"],
    enabled,
    queryFn: async (): Promise<SyncState> => {
      const [outbox, count, log, links] = await Promise.all([
        db.from("sync_outbox").select("id,kind,bmd_id,label,op,changes,status,error,created_at,updated_at").in("status", ["waiting", "failed"]).order("updated_at", { ascending: false }).limit(200),
        db.from("sync_outbox").select("id", { count: "exact", head: true }).eq("status", "waiting"),
        db.from("sync_log").select("id,at,direction,system,kind,label,outcome,detail,reviewed_at").order("at", { ascending: false }).limit(100),
        db.from("sync_links").select("system"),
      ]);
      for (const r of [outbox, count, log, links]) if (r.error) throw r.error;
      const perSystem: Record<string, number> = {};
      for (const l of (links.data ?? []) as { system: string }[]) perSystem[l.system] = (perSystem[l.system] ?? 0) + 1;
      return { outbox: (outbox.data ?? []) as OutboxRow[], waiting: count.count ?? 0, log: (log.data ?? []) as LogRow[], links: perSystem };
    },
  });
}

export function useRefreshSync() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["sync"] });
}

export async function markReviewed(id: string) {
  const { error } = await db.rpc("sync_mark_reviewed", { _id: id });
  if (error) throw error;
}
