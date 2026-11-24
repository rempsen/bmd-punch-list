import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAwaitingMaterial } from "@/lib/materials/data";
import { db } from "@/lib/platform/db";
import { useJobAreas } from "@/lib/scheduling/data";
import { readiness, tileCounts, type BlockerKind, type ProgressStatus, type RoomReadiness } from "./logic";
import { loadJobScopes } from "./scopes";

export type AreaProgress = {
  id: string;
  project_id: string;
  room_id: string;
  scope: string;
  status: ProgressStatus;
  blocker: string | null;
  blocker_kind: BlockerKind | null;
  source: "manual" | "arriveping";
  updated_at: string;
};

const KEY = ["area-progress"] as const;

export function useJobScopes(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["install-scopes", projectId],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: () => loadJobScopes(db, projectId!),
  });
}

export function useAreaProgress(projectId: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("area_progress").select("*").eq("project_id", projectId!);
      if (error) throw error;
      return (data ?? []) as AreaProgress[];
    },
  });
}

/** Open must-fix deficiencies per room. */
export function useMustFixByRoom(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ["install-mustfix", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await db
        .from("deficiencies")
        .select("location_id")
        .eq("project_id", projectId!)
        .eq("assessment", "must_fix")
        .not("status", "in", "(fixed,verified,accepted_as_is)");
      if (error) throw error;
      const m = new Map<string, number>();
      for (const d of (data ?? []) as { location_id: string }[]) m.set(d.location_id, (m.get(d.location_id) ?? 0) + 1);
      return m;
    },
  });
}

export type InstallRoom = {
  id: string;
  name: string;
  floorId: string;
  floorLabel: string;
  rows: Record<string, AreaProgress | undefined>;
  mustFix: number;
  ready: RoomReadiness;
};

/** Every room of the job with its progress and readiness, in floor then room order. */
export function useInstallationRooms(projectId: string | null | undefined) {
  const areas = useJobAreas(projectId);
  const scopes = useJobScopes(projectId);
  const progress = useAreaProgress(projectId);
  const awaiting = useAwaitingMaterial(projectId);
  const mustFix = useMustFixByRoom(projectId);
  const loading = areas.isLoading || scopes.isLoading || progress.isLoading || awaiting.isLoading;
  const error = areas.error || scopes.error || progress.error || awaiting.error || mustFix.error;
  const value = useMemo(() => {
    const sc = scopes.data ?? [];
    const by = new Map<string, Record<string, AreaProgress>>();
    for (const r of progress.data ?? []) (by.get(r.room_id) ?? by.set(r.room_id, {}).get(r.room_id)!)[r.scope] = r;
    const awaitingMaterial = (awaiting.data ?? []).length > 0;
    const rooms: InstallRoom[] = (areas.data ?? []).flatMap((f) =>
      f.rooms.map((room) => {
        const rows = by.get(room.id) ?? {};
        return {
          id: room.id,
          name: room.name,
          floorId: f.id,
          floorLabel: f.label,
          rows,
          mustFix: mustFix.data?.get(room.id) ?? 0,
          ready: readiness({
            scopes: sc,
            status: Object.fromEntries(sc.map((s) => [s, rows[s]?.status])),
            blockers: sc.flatMap((s) => (rows[s] ? [{ scope: s, text: rows[s]!.blocker, kind: rows[s]!.blocker_kind }] : [])),
            awaitingMaterial,
          }),
        };
      }),
    );
    return { scopes: sc, floors: areas.data ?? [], rooms, tiles: tileCounts(rooms.map((r) => r.ready.state)) };
  }, [areas.data, scopes.data, progress.data, awaiting.data, mustFix.data]);
  return { ...value, loading, error };
}

export type ProgressPatch = { status?: ProgressStatus; blocker?: string | null; blocker_kind?: BlockerKind | null };

/** Upserts manual changes for several rooms × one scope. */
export function useSetProgress(projectId: string | null | undefined, userId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { rooms: string[]; scope: string; patch: ProgressPatch; current: Map<string, AreaProgress | undefined> }) => {
      const now = new Date().toISOString();
      const rows = v.rooms.map((room_id) => {
        const c = v.current.get(room_id);
        return {
          project_id: projectId!,
          room_id,
          scope: v.scope,
          status: v.patch.status ?? c?.status ?? "not_started",
          blocker: "blocker" in v.patch ? v.patch.blocker ?? null : c?.blocker ?? null,
          blocker_kind: "blocker_kind" in v.patch ? v.patch.blocker_kind ?? null : c?.blocker_kind ?? null,
          source: "manual",
          updated_by: userId ?? null,
          updated_at: now,
        };
      });
      const { error } = await db.from("area_progress").upsert(rows, { onConflict: "project_id,room_id,scope" });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
