import { describe, expect, test } from "bun:test";
import { buildQboEstimate, postEstimateFlow, type PostDeps } from "./estimate";

const codes = [
  { code: "01-05", name: "LVP supply and install", qbo_item_id: "41" },
  { code: "02-100", name: "Window coverings", qbo_item_id: "77" },
  { code: "03-000", name: "Miscellaneous", qbo_item_id: null },
];
// Three estimate lines on two cost codes were rolled up when the quote was sent.
const rollup = { versionId: "v1", lines: [{ costCode: "01-05", amountCents: 613224 + 120000, taxCode: "GST" as const }, { costCode: "02-100", amountCents: 2098980, taxCode: "GST" as const }], subtotalCents: 2832204, taxCents: 141610, totalCents: 2973814 };
const version = { id: "v1", name: "Base", subtotalCents: 2832204, taxCents: 141610, totalCents: 2973814 };
const input = { number: "Q-26-041-R0", projectName: "Hyatt Centric", customerQboId: "58", rollup, version, costCodes: codes };

describe("buildQboEstimate", () => {
  test("one QuickBooks line per cost code, adding up to the quote exactly", () => {
    const r = buildQboEstimate(input);
    expect(r).toEqual({
      ok: true,
      estimate: {
        customerRef: "58",
        docNumber: "Q-26-041-R0",
        lines: [
          { itemId: "41", costCode: "01-05", description: "LVP supply and install", amountCents: 733224, taxCode: "GST" },
          { itemId: "77", costCode: "02-100", description: "Window coverings", amountCents: 2098980, taxCode: "GST" },
        ],
        subtotalCents: 2832204,
        expectedTotalCents: 2973814,
      },
    });
  });
  test("posting is blocked when the roll-up does not add up to the quote the client was sent", () => {
    expect(buildQboEstimate({ ...input, version: { ...version, subtotalCents: 2832205 } })).toEqual({ ok: false, message: "The QuickBooks lines add up to $28,322.04 but the quote is $28,322.05. Nothing was posted." });
    expect(buildQboEstimate({ ...input, rollup: { ...rollup, totalCents: 1 } })).toMatchObject({ ok: false });
  });
  test("a client or cost code that is not linked to QuickBooks blocks posting and is named", () => {
    expect(buildQboEstimate({ ...input, customerQboId: null })).toEqual({ ok: false, message: "This client is not linked to a QuickBooks customer." });
    expect(buildQboEstimate({ ...input, rollup: { ...rollup, lines: [...rollup.lines.slice(0, 1), { costCode: "03-000", amountCents: 2098980, taxCode: "GST" }] } })).toEqual({ ok: false, message: "These cost codes are not linked to a QuickBooks item: 03-000." });
    expect(buildQboEstimate({ ...input, rollup: { ...rollup, lines: [...rollup.lines.slice(0, 1), { costCode: "", amountCents: 2098980, taxCode: "GST" }] } })).toEqual({ ok: false, message: "These cost codes are not linked to a QuickBooks item: (no cost code)." });
  });
});

describe("postEstimateFlow", () => {
  test("posting the same quote twice creates one estimate; the second call returns the stored one", async () => {
    let stored: string | null = null;
    let created = 0;
    const deps: PostDeps = { storedId: async () => stored, create: async () => (created++, "QBO-901"), store: async (_q, id) => void (stored = id) };
    const est = buildQboEstimate(input);
    if (!est.ok) throw new Error("fixture");
    expect(await postEstimateFlow(deps, "q1", est.estimate)).toEqual({ ok: true, qboEstimateId: "QBO-901", created: true });
    expect(await postEstimateFlow(deps, "q1", est.estimate)).toEqual({ ok: true, qboEstimateId: "QBO-901", created: false });
    expect(created).toBe(1);
  });
  test("a failed create stores nothing, so it can be tried again", async () => {
    let stored: string | null = null;
    const deps: PostDeps = { storedId: async () => stored, create: async () => { throw new Error("QuickBooks is unavailable"); }, store: async (_q, id) => void (stored = id) };
    const est = buildQboEstimate(input);
    if (!est.ok) throw new Error("fixture");
    expect(await postEstimateFlow(deps, "q1", est.estimate)).toEqual({ ok: false, message: "QuickBooks did not accept the estimate: QuickBooks is unavailable" });
    expect(stored).toBeNull();
  });
});
