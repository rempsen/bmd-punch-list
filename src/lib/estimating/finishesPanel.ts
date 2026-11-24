/** Where the estimate remembers whether "Finishes on this job" is open, in this browser. */
export const FINISHES_PANEL_KEY = "bmd.finishesPanel";

/** The finishes panel starts closed and then stays the way the person left it. */
export const finishesPanelOpen = (stored: string | null): boolean => stored === "open";

export type FinishesSummary = { count: number; needMaterial: number; countText: string; materialText: string };

/** What the closed panel says, so the estimator knows whether it needs opening: how many finishes, and how many still have no material. */
export function finishesSummary(finishes: { catalogue_material_id: string | null }[]): FinishesSummary {
  const count = finishes.length;
  const needMaterial = finishes.filter((f) => !f.catalogue_material_id).length;
  if (count === 0) return { count, needMaterial, countText: "No finishes yet", materialText: "" };
  return {
    count,
    needMaterial,
    countText: `${count} ${count === 1 ? "finish" : "finishes"}`,
    materialText: needMaterial === 0 ? (count === 1 ? "it has a material" : "all have a material") : `${needMaterial} ${needMaterial === 1 ? "needs" : "need"} a material`,
  };
}
