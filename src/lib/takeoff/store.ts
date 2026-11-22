/** Where takeoff data lives. The screen talks to this, so it works the same against the database or in memory. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/platform/db";
import { countedShapes, measureShape, type Shape, type ShapeKind } from "./geometry";

export type Condition = { id: string; project_id: string; finish_id: string | null; label: string; kind: ShapeKind; colour: string; default_section: string | null; sort_order: number };
export type ScaleRow = { id: string; sheet_id: string; region: { x: number; y: number; width: number; height: number } | null; feet_per_point: number; provenance: "suggested" | "chosen" | "calibrated" };
/** `counted` is the subset of shapes on the newest version of each drawing file: the only ones that add to quantities. */
export type TakeoffData = { conditions: Condition[]; shapes: Shape[]; scales: ScaleRow[]; counted?: Shape[] };
export type TakeoffActions = {
  setScale: (sheetId: string, feetPerPoint: number, provenance: ScaleRow["provenance"]) => Promise<void>;
  addCondition: (c: Omit<Condition, "id" | "project_id" | "sort_order">) => Promise<string>;
  removeCondition: (id: string) => Promise<void>;
  /** Saves a new shape, or puts back one that was removed (same id). */
  putShape: (s: Shape) => Promise<void>;
  updateShape: (id: string, patch: Partial<Pick<Shape, "vertices" | "cutouts" | "openings_ft" | "multiplier" | "section" | "needs_checking">>) => Promise<void>;
  removeShape: (id: string) => Promise<void>;
};

export const COLOURS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#4d7c0f"];
const qty = (s: Shape) => {
  const m = measureShape(s);
  return s.kind === "area" ? m.sf : s.kind === "linear" ? m.lf : m.ea;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shapeFromRow = (r: any): Shape => ({ id: r.id, sheet_id: r.sheet_id, condition_id: r.condition_id, kind: r.kind, vertices: r.vertices, cutouts: r.cutouts ?? [], openings_ft: Number(r.openings_ft), multiplier: Number(r.multiplier), section: r.section, scale_feet_per_point: Number(r.scale_feet_per_point), needs_checking: !!r.needs_checking });

export function useTakeoff(projectId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["takeoff", projectId],
    enabled: !!projectId && enabled,
    queryFn: async (): Promise<TakeoffData> => {
      const [c, s, sc, sh, dc] = await Promise.all([
        db.from("takeoff_conditions").select("id,project_id,finish_id,label,kind,colour,default_section,sort_order").eq("project_id", projectId!).order("sort_order").order("created_at"),
        db.from("takeoff_shapes").select("id,sheet_id,condition_id,kind,vertices,cutouts,openings_ft,multiplier,section,scale_feet_per_point,needs_checking").eq("project_id", projectId!).order("created_at"),
        db.from("sheet_scales").select("id,sheet_id,region,feet_per_point,provenance").eq("project_id", projectId!),
        db.from("plan_sheets").select("id,document_id").eq("project_id", projectId!),
        db.from("project_documents").select("id,section,file_name,version").eq("project_id", projectId!).eq("section", "plans"),
      ]);
      const err = c.error ?? s.error ?? sc.error ?? sh.error ?? dc.error;
      if (err) throw err;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shapes = (s.data ?? []).map(shapeFromRow);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { conditions: (c.data ?? []) as Condition[], shapes, counted: countedShapes(shapes, (sh.data ?? []) as any, (dc.data ?? []) as any), scales: ((sc.data ?? []) as any[]).map((r) => ({ ...r, feet_per_point: Number(r.feet_per_point) })) };
    },
  });
}

export function useTakeoffActions(projectId: string, data: TakeoffData | undefined): TakeoffActions {
  const qc = useQueryClient();
  const done = <T,>(r: { data?: T | null; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    void qc.invalidateQueries({ queryKey: ["takeoff", projectId] });
    return r.data as T;
  };
  return {
    // One database call changes the sheet's scale and re-measures everything on it, so they cannot end up out of step.
    setScale: async (sheetId, feetPerPoint, provenance) => void done(await db.rpc("set_sheet_scale", { _sheet: sheetId, _feet_per_point: feetPerPoint, _provenance: provenance })),
    addCondition: async (c) => done<{ id: string }>(await db.from("takeoff_conditions").insert({ ...c, project_id: projectId, sort_order: (data?.conditions.length ?? 0) + 1 }).select("id").single()).id,
    removeCondition: async (id) => void done(await db.from("takeoff_conditions").delete().eq("id", id)),
    putShape: async (s) => void done(await db.from("takeoff_shapes").upsert({ id: s.id, project_id: projectId, sheet_id: s.sheet_id, condition_id: s.condition_id, kind: s.kind, vertices: s.vertices, cutouts: s.cutouts, openings_ft: s.openings_ft, multiplier: s.multiplier, section: s.section, qty: qty(s), scale_feet_per_point: s.scale_feet_per_point, needs_checking: !!s.needs_checking })),
    updateShape: async (id, patch) => {
      const cur = data?.shapes.find((x) => x.id === id);
      done(await db.from("takeoff_shapes").update({ ...patch, ...(cur ? { qty: qty({ ...cur, ...patch }) } : {}) }).eq("id", id));
    },
    removeShape: async (id) => void done(await db.from("takeoff_shapes").delete().eq("id", id)),
  };
}
