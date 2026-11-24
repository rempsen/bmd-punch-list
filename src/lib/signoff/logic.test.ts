import { describe, expect, it } from "bun:test";
import { buildChecklist, closeBlock, deriveOutcome, linkState, signoffEligibility } from "./logic";

describe("checklist", () => {
  it("one item per required room × scope", () => {
    const items = buildChecklist(
      [
        { id: "r1", name: "201", floorLabel: "Floor 2", status: { lvp: "complete", wall_base: "not_required" } },
        { id: "r2", name: "202", floorLabel: "Floor 2", status: {} },
      ],
      ["lvp", "wall_base"],
    );
    expect(items.map((i) => `${i.room_id}:${i.scope}`)).toEqual(["r1:lvp", "r2:lvp", "r2:wall_base"]);
    expect(items.map((i) => i.sort)).toEqual([0, 1, 2]);
  });
});

describe("outcome", () => {
  it("passed when nothing deficient", () => expect(deriveOutcome([{ result: "ok", deficiency_id: null }, { result: "not_inspected", deficiency_id: null }])).toBe("passed"));
  it("passed with items when every deficient item has a deficiency", () => expect(deriveOutcome([{ result: "deficient", deficiency_id: "d" }])).toBe("passed_with_items"));
  it("failed when picked or a deficient item is unrecorded", () => {
    expect(deriveOutcome([{ result: "ok", deficiency_id: null }], true)).toBe("failed");
    expect(deriveOutcome([{ result: "deficient", deficiency_id: null }])).toBe("failed");
  });
  it("blocks closing with unrecorded deficient items", () => {
    expect(closeBlock([{ result: "deficient", deficiency_id: null }], false)).toContain("1 deficient item");
    expect(closeBlock([{ result: "deficient", deficiency_id: null }], true)).toBeNull();
  });
});

describe("eligibility", () => {
  it("needs a closed inspection", () => expect(signoffEligibility([{ outcome: "pending", held_at: null, created_at: "2026-01-01" }]).ok).toBe(false));
  it("uses the latest closed inspection", () => {
    expect(signoffEligibility([{ outcome: "failed", held_at: "2026-01-01", created_at: "" }, { outcome: "passed_with_items", held_at: "2026-02-01", created_at: "" }]).ok).toBe(true);
    expect(signoffEligibility([{ outcome: "passed", held_at: "2026-01-01", created_at: "" }, { outcome: "failed", held_at: "2026-02-01", created_at: "" }]).ok).toBe(false);
  });
  it("link expiry", () => {
    const now = new Date("2026-01-10");
    expect(linkState({ signed_at: null, link_expires_at: "2026-01-20" }, now)).toBe("open");
    expect(linkState({ signed_at: null, link_expires_at: "2026-01-01" }, now)).toBe("expired");
    expect(linkState({ signed_at: "x", link_expires_at: null }, now)).toBe("signed");
  });
});
