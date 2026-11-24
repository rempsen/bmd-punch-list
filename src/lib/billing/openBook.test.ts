import { describe, expect, test } from "bun:test";
import { billingPosition } from "./calc";
import {
  SNAPSHOT_FIELDS,
  buildOpenBookBill,
  checkLabourEntry,
  checkMaterialEntry,
  contractTypeLock,
  labourAmountCents,
  markupCents,
  materialLine,
  openBookPosition,
  parseHours,
  quickBooksLines,
  type LabourEntry,
  type MaterialEntry,
  type Terms,
} from "./openBook";

const terms: Terms = { markupPct: 15, labourRateCents: 8500, namedRates: [{ name: "Installer", rateCents: 8500 }, { name: "Helper", rateCents: 5500 }], holdbackApplies: true };
const lab = (p: Partial<LabourEntry> = {}): LabourEntry => ({ id: "l1", description: "Remove carpet, level 2 corridor", workDate: "2026-11-02", workDateEnd: "2026-11-06", hours: 32, rateCents: 8500, billId: null, ...p });
const mat = (p: Partial<MaterialEntry> = {}): MaterialEntry => ({ id: "m1", supplierName: "Prosol", invoiceNumber: "INV-1001", invoiceDate: "2026-11-03", amountCents: 240000, markupPct: null, markupNote: null, attachmentName: null, billId: null, ...p });

describe("open-book labour", () => {
  test("amount is hours times rate, to the cent", () => {
    expect(labourAmountCents(32, 8500)).toBe(272000);
    expect(labourAmountCents(7.25, 5500)).toBe(39875);
    expect(labourAmountCents(0.33, 8555)).toBe(2823); // 2,823.15
  });
  test("an exact half cent rounds up", () => {
    expect(labourAmountCents(0.5, 8555)).toBe(4278); // 4,277.5
    expect(labourAmountCents(0.25, 8502)).toBe(2126); // 2,125.5
    expect(labourAmountCents(1.15, 8530)).toBe(9810); // 9,809.5, which floating point alone would round down
  });
  test("hours are read to two decimals and must be above zero", () => {
    expect(parseHours("7.5")).toBe(7.5);
    expect(parseHours(" 12 ")).toBe(12);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("1.234")).toBeNull();
  });
  test("an entry needs a description, a date, hours and a rate", () => {
    expect(checkLabourEntry({ description: "Install LVT", workDate: "2026-11-02", workDateEnd: "", hours: "8", rate: "85" })).toBeNull();
    expect(checkLabourEntry({ description: " ", workDate: "2026-11-02", workDateEnd: "", hours: "8", rate: "85" })).toBe("Describe the work.");
    expect(checkLabourEntry({ description: "x", workDate: "", workDateEnd: "", hours: "8", rate: "85" })).toBe("Enter the date of the work.");
    expect(checkLabourEntry({ description: "x", workDate: "2026-11-06", workDateEnd: "2026-11-02", hours: "8", rate: "85" })).toBe("The last day cannot be before the first day.");
    expect(checkLabourEntry({ description: "x", workDate: "2026-11-02", workDateEnd: "", hours: "", rate: "85" })).toBe("Enter the hours, for example 7.5.");
    expect(checkLabourEntry({ description: "x", workDate: "2026-11-02", workDateEnd: "", hours: "8", rate: "" })).toBe("Enter the hourly rate.");
  });
});

describe("open-book materials", () => {
  test("markup is the job's rate on the invoice amount, rounded half up", () => {
    expect(markupCents(240000, 15)).toBe(36000);
    expect(markupCents(3330, 15)).toBe(500); // 499.5
    expect(markupCents(1004, 12.5)).toBe(126); // 125.5
    expect(markupCents(1001, 12.5)).toBe(125); // 125.125
    expect(materialLine(mat(), terms)).toEqual({ supplier: "Prosol", invoiceNumber: "INV-1001", invoiceDate: "2026-11-03", invoiceCents: 240000, markupPct: 15, markupCents: 36000, totalCents: 276000, attachmentName: null });
  });
  test("an invoice can carry its own markup, zero included, in place of the job's", () => {
    expect(materialLine(mat({ markupPct: 10, markupNote: "Agreed 10% on adhesive" }), terms)).toMatchObject({ markupPct: 10, markupCents: 24000, totalCents: 264000 });
    expect(materialLine(mat({ markupPct: 0 }), terms)).toMatchObject({ markupPct: 0, markupCents: 0, totalCents: 240000 });
  });
  test("a markup that has not been set is unknown, never zero", () => {
    expect(materialLine(mat(), { ...terms, markupPct: null })).toBeNull();
    expect(materialLine(mat({ markupPct: 10 }), { ...terms, markupPct: null })).toMatchObject({ markupCents: 24000 });
  });
  test("an invoice needs a supplier, a number, a date and an amount", () => {
    const ok = { supplierName: "Prosol", invoiceNumber: "INV-1", invoiceDate: "2026-11-03", amount: "2,400.00", markupPct: "" };
    expect(checkMaterialEntry(ok)).toBeNull();
    expect(checkMaterialEntry({ ...ok, supplierName: "" })).toBe("Choose or type the supplier.");
    expect(checkMaterialEntry({ ...ok, invoiceNumber: " " })).toBe("Enter the supplier's invoice number.");
    expect(checkMaterialEntry({ ...ok, invoiceDate: "" })).toBe("Enter the invoice date.");
    expect(checkMaterialEntry({ ...ok, amount: "0" })).toBe("Enter the invoice amount before GST.");
    expect(checkMaterialEntry({ ...ok, markupPct: "150" })).toBe("Markup must be between 0 and 100 percent.");
  });
});

describe("the open-book bill", () => {
  const labour = [lab(), lab({ id: "l2", description: "Helper", workDate: "2026-11-04", workDateEnd: null, hours: 7.25, rateCents: 5500 })];
  const materials = [mat(), mat({ id: "m2", supplierName: "Shnier", invoiceNumber: "88123", amountCents: 3330, markupPct: 10, markupNote: "Agreed 10%" })];
  test("labour, materials with markup, holdback and GST on what is billed", () => {
    const r = buildOpenBookBill(labour, materials, terms, { holdbackPct: 7.5, gstPct: 5 });
    if ("problem" in r) throw new Error(r.problem);
    // Labour 2,720.00 + 398.75 = 3,118.75; invoices 2,400.00 + 33.30 = 2,433.30; markup 360.00 + 3.33 = 363.33.
    expect(r.snapshot.labourCents).toBe(311875);
    expect(r.snapshot.materialsCents).toBe(243330);
    expect(r.snapshot.markupCents).toBe(36333);
    expect(r.totals.grossCents).toBe(591538);
    expect(r.totals.holdbackCents).toBe(44365); // 7.5% of 5,915.38 = 443.6535
    expect(r.totals.netCents).toBe(547173);
    expect(r.totals.gstCents).toBe(27359); // 5% of the 5,471.73 actually billed, markup included
    expect(r.totals.totalCents).toBe(574532);
  });
  test("GST is charged on labour and on materials with their markup, not on the invoice amounts alone", () => {
    const r = buildOpenBookBill([], [mat()], terms, { holdbackPct: 0, gstPct: 5 });
    if ("problem" in r) throw new Error(r.problem);
    expect(r.totals).toEqual({ grossCents: 276000, holdbackCents: 0, netCents: 276000, gstCents: 13800, totalCents: 289800 });
  });
  test("holdback is kept only when the job's terms say it applies", () => {
    const on = buildOpenBookBill(labour, [], terms, { holdbackPct: 7.5, gstPct: 5 });
    const off = buildOpenBookBill(labour, [], { ...terms, holdbackApplies: false }, { holdbackPct: 7.5, gstPct: 5 });
    if ("problem" in on || "problem" in off) throw new Error("unexpected");
    expect(on.totals).toEqual({ grossCents: 311875, holdbackCents: 23391, netCents: 288484, gstCents: 14424, totalCents: 302908 });
    expect(on.holdbackPct).toBe(7.5);
    expect(off.totals).toEqual({ grossCents: 311875, holdbackCents: 0, netCents: 311875, gstCents: 15594, totalCents: 327469 });
    expect(off.holdbackPct).toBe(0);
  });
  test("an entry that is already on a bill cannot go on another", () => {
    expect(buildOpenBookBill([lab({ billId: "b1" })], [], terms, { holdbackPct: 7.5, gstPct: 5 })).toEqual({ problem: "\"Remove carpet, level 2 corridor\" is already on a bill." });
    expect(buildOpenBookBill([], [mat({ billId: "b1" })], terms, { holdbackPct: 7.5, gstPct: 5 })).toEqual({ problem: "Prosol invoice INV-1001 is already on a bill." });
    expect(buildOpenBookBill([lab(), lab()], [], terms, { holdbackPct: 7.5, gstPct: 5 })).toEqual({ problem: "The same entry was picked twice." });
  });
  test("nothing ticked, or materials with no markup set, is not a bill", () => {
    expect(buildOpenBookBill([], [], terms, { holdbackPct: 7.5, gstPct: 5 })).toEqual({ problem: "Tick the labour and material invoices to put on this bill." });
    expect(buildOpenBookBill([], [mat()], { ...terms, markupPct: null }, { holdbackPct: 7.5, gstPct: 5 })).toEqual({ problem: "Set the materials markup for this job before billing materials." });
  });
  test("the bill keeps only the fields a client is meant to see", () => {
    // What reaches the database rows is wider than what a client sees: costs, margins and notes ride along here and must be dropped.
    const dirtyLabour = { ...lab(), costRateCents: 4200, marginPct: 50, internalNote: "Paid sub $42/h", rateName: "Installer", personId: "u1" } as LabourEntry;
    const dirtyMaterial = { ...mat({ markupPct: 10, markupNote: "Dan agreed 10% by phone", attachmentName: "Prosol INV-1001.pdf" }), catalogueCostCents: 180000, marginPct: 33, internalNote: "Rebate coming", supplierId: "s1" } as MaterialEntry;
    const r = buildOpenBookBill([dirtyLabour], [dirtyMaterial], terms, { holdbackPct: 7.5, gstPct: 5 });
    if ("problem" in r) throw new Error(r.problem);
    expect(Object.keys(r.snapshot).sort()).toEqual([...SNAPSHOT_FIELDS.bill].sort());
    expect(Object.keys(r.snapshot.labour[0]!).sort()).toEqual([...SNAPSHOT_FIELDS.labour].sort());
    expect(Object.keys(r.snapshot.materials[0]!).sort()).toEqual([...SNAPSHOT_FIELDS.material].sort());
    expect(SNAPSHOT_FIELDS).toEqual({
      bill: ["labour", "materials", "labourCents", "materialsCents", "markupCents"],
      labour: ["description", "dateFrom", "dateTo", "hours", "rateCents", "amountCents"],
      material: ["supplier", "invoiceNumber", "invoiceDate", "invoiceCents", "markupPct", "markupCents", "totalCents", "attachmentName"],
    });
    const text = JSON.stringify(r);
    for (const s of ["4200", "180000", "margin", "Paid sub", "Rebate", "by phone", "internalNote", "costRate", "catalogue", "personId", "supplierId"]) expect(text).not.toContain(s);
    expect(r.snapshot.materials[0]!.attachmentName).toBe("Prosol INV-1001.pdf");
  });
  test("the lines for entering the bill in QuickBooks by hand", () => {
    const r = buildOpenBookBill(labour, materials, terms, { holdbackPct: 7.5, gstPct: 5 });
    if ("problem" in r) throw new Error(r.problem);
    expect(r.lines).toEqual([
      { description: "Labour", amountCents: 311875 },
      { description: "Materials", amountCents: 243330 },
      { description: "Markup on materials", amountCents: 36333 },
    ]);
    expect(quickBooksLines(r.snapshot)).toEqual(r.lines);
    const labourOnly = buildOpenBookBill(labour, [], terms, { holdbackPct: 7.5, gstPct: 5 });
    if ("problem" in labourOnly) throw new Error("unexpected");
    expect(labourOnly.lines).toEqual([{ description: "Labour", amountCents: 311875 }]);
  });
});

describe("where an open-book job stands", () => {
  const bills = [
    { kind: "progress" as const, status: "issued" as const, gross_cents: 500000, holdback_cents: 37500 },
    { kind: "progress" as const, status: "draft" as const, gross_cents: 100000, holdback_cents: 7500 },
    { kind: "progress" as const, status: "void" as const, gross_cents: 900000, holdback_cents: 67500 },
    { kind: "holdback_release" as const, status: "issued" as const, gross_cents: 10000, holdback_cents: 0 },
  ];
  test("billed to date, unbilled labour, unbilled materials with markup, and holdback held", () => {
    const pos = openBookPosition(bills, [lab(), lab({ id: "l2", billId: "b1" })], [mat(), mat({ id: "m2", billId: "b1" })], terms);
    expect(pos).toEqual({ billedCents: 600000, unbilledLabourCents: 272000, unbilledMaterialsCents: 276000, markupUnknown: false, heldCents: 37500, releasedCents: 10000, holdbackOwingCents: 27500 });
    // Holdback is counted the same way as on a fixed-price job.
    expect(pos.holdbackOwingCents).toBe(billingPosition(0, bills).holdbackOwingCents);
  });
  test("with no markup set, unbilled materials show the invoice amounts and say the markup is missing", () => {
    expect(openBookPosition([], [], [mat()], { ...terms, markupPct: null })).toMatchObject({ unbilledMaterialsCents: 240000, markupUnknown: true });
  });
});

describe("changing a job's contract type", () => {
  test("allowed until a bill has been issued", () => {
    expect(contractTypeLock([])).toBeNull();
    expect(contractTypeLock([{ status: "issued" }])).toBe("This job has issued bills, so its contract type can no longer be changed.");
    expect(contractTypeLock([{ status: "void" }])).toBe("This job has issued bills, so its contract type can no longer be changed.");
    expect(contractTypeLock([{ status: "draft" }])).toBe("Delete the draft bills on this job before changing its contract type.");
  });
});
