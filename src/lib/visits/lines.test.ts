import { describe, expect, test } from "bun:test";
import {
  estimateWorkItems,
  groupWorkItems,
  lineFromItem,
  lineSummary,
  linesChanged,
  overRemaining,
  remainingFor,
  workBlock,
  type VisitLine,
  type WorkOrderItem,
} from "./lines";

const item = (o: Partial<WorkOrderItem>): WorkOrderItem => ({
  estimate_line_id: "l1",
  finish_id: null,
  finish_tag: null,
  section: null,
  kind: "assembly",
  description: "",
  quantity: 0,
  uom: "SF",
  cost_code: null,
  sort_order: 0,
  ...o,
});

const items: WorkOrderItem[] = [
  item({ estimate_line_id: "lvt", finish_tag: "LVT", description: "Luxury vinyl plank", quantity: "2500", sort_order: 2 }),
  item({ estimate_line_id: "cpt", finish_tag: "CPT", description: "Carpet tile", quantity: 1200, sort_order: 1 }),
  item({ estimate_line_id: "base", section: "Millwork", description: "4in rubber base", quantity: 300, uom: "LF", sort_order: 3 }),
  item({ estimate_line_id: "del", kind: "delivery", description: "Delivery", quantity: 0, uom: "EA", sort_order: 4 }),
  item({ estimate_line_id: "allow", kind: "allowance", description: "Transitions", quantity: 12, uom: "EA", sort_order: 5 }),
  item({ estimate_line_id: "ls", kind: "lump_sum", description: "Moisture mitigation", quantity: null, sort_order: 6 }),
];

describe("estimateWorkItems", () => {
  test("keeps work and quantified allowances, drops lump sums and deliveries with no quantity, sorted", () => {
    expect(estimateWorkItems(items).map((i) => i.estimate_line_id)).toEqual(["cpt", "lvt", "base", "allow"]);
  });
  test("groups by finish tag, then section", () => {
    expect(groupWorkItems(estimateWorkItems(items)).map((g) => [g.label, g.items.length])).toEqual([
      ["CPT", 1],
      ["LVT", 1],
      ["Millwork", 1],
      ["Other", 1],
    ]);
  });
});

describe("remainingFor", () => {
  const others: VisitLine[] = [
    { estimate_line_id: "lvt", description: "LVT", quantity: "1000", uom: "SF" },
    { estimate_line_id: "lvt", description: "LVT", quantity: 600, uom: "SF" },
    { estimate_line_id: "cpt", description: "CPT", quantity: 1200, uom: "SF" },
  ];
  test("subtracts what other work orders already carry", () => {
    expect(remainingFor(items[0], others)).toBe(900);
    expect(remainingFor(items[1], others)).toBe(0);
    expect(remainingFor(items[2], others)).toBe(300);
  });
  test("over-remaining is flagged, not blocked", () => {
    expect(overRemaining(items[0], 900, others)).toBe(false);
    expect(overRemaining(items[0], 901, others)).toBe(true);
    expect(overRemaining(items[1], 1, others)).toBe(true);
  });
  test("a drafted line defaults to the remainder, or the whole item when none is left", () => {
    expect(lineFromItem(items[0], others)).toMatchObject({ estimate_line_id: "lvt", description: "LVT Luxury vinyl plank", quantity: 900, uom: "SF" });
    expect(lineFromItem(items[1], others).quantity).toBe(1200);
    expect(lineFromItem(items[2], []).description).toBe("4in rubber base");
  });
});

describe("summary and Work block", () => {
  const lines: VisitLine[] = [
    { estimate_line_id: "lvt", description: "LVT", quantity: 500, uom: "SF" },
    { estimate_line_id: "base", description: "base", quantity: "10", uom: "LF" },
    { estimate_line_id: null, description: "", quantity: 0, uom: "EA" },
  ];
  test("lineSummary", () => {
    expect(lineSummary(lines)).toBe("500 SF LVT · 10 LF base");
    expect(lineSummary([])).toBe("");
  });
  test("workBlock lists one item per line", () => {
    expect(workBlock(lines)).toBe("Work:\n- 500 SF LVT\n- 10 LF base");
    expect(workBlock([])).toBe("");
  });
  test("linesChanged ignores order and ids, notices quantities", () => {
    const a: VisitLine[] = [
      { id: "1", estimate_line_id: "lvt", description: "LVT", quantity: 500, uom: "SF" },
      { id: "2", estimate_line_id: "base", description: "base", quantity: 10, uom: "LF" },
    ];
    expect(linesChanged(a, [{ ...a[1], id: "x" }, { ...a[0], id: "y", quantity: "500" }])).toBe(false);
    expect(linesChanged(a, [a[0], { ...a[1], quantity: 12 }])).toBe(true);
    expect(linesChanged(a, [a[0]])).toBe(true);
  });
});
