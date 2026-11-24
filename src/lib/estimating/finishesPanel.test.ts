import { describe, expect, test } from "bun:test";
import { finishesPanelOpen, finishesSummary } from "./finishesPanel";

const f = (catalogue_material_id: string | null) => ({ catalogue_material_id });

describe("the Finishes on this job panel", () => {
  test("starts closed", () => {
    expect(finishesPanelOpen(null)).toBe(false);
    expect(finishesPanelOpen("nonsense")).toBe(false);
  });
  test("stays the way the person left it", () => {
    expect(finishesPanelOpen("open")).toBe(true);
    expect(finishesPanelOpen("closed")).toBe(false);
  });
});

describe("the one-line summary shown while the panel is closed", () => {
  test("counts the finishes and the ones with no material chosen", () => {
    expect(finishesSummary([f("m1"), f(null), f(null)])).toEqual({ count: 3, needMaterial: 2, countText: "3 finishes", materialText: "2 need a material" });
  });
  test("reads properly for one", () => {
    expect(finishesSummary([f(null)])).toMatchObject({ countText: "1 finish", materialText: "1 needs a material" });
  });
  test("says so when every finish has a material", () => {
    expect(finishesSummary([f("m1"), f("m2")])).toMatchObject({ needMaterial: 0, materialText: "all have a material" });
    expect(finishesSummary([f("m1")])).toMatchObject({ materialText: "it has a material" });
  });
  test("a job with no finishes yet", () => {
    expect(finishesSummary([])).toEqual({ count: 0, needMaterial: 0, countText: "No finishes yet", materialText: "" });
  });
});
