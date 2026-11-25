import { describe, expect, test } from "bun:test";
import { billMatchesOrder, nextStatus, orderFromWorkOrder, orderTotal, poNumber, qboCents, rateFor, subcontractPoLines, uncostedLines, type LabourRate, type VisitLine } from "./logic";

const rates: LabourRate[] = [
  { id: "r1", name: "Install LVT", uom: "SF", unit_cost_cents: 125, cost_code: "01-26", active: true },
  { id: "r2", name: "Install LVT (SY)", uom: "SY", unit_cost_cents: 1100, cost_code: "01-26", active: true },
  { id: "r3", name: "Base", uom: "LF", unit_cost_cents: null, cost_code: "01-30", active: true },
  { id: "r4", name: "Old carpet", uom: "SY", unit_cost_cents: 500, cost_code: "01-10", active: false },
];
const lines: VisitLine[] = [
  { id: "l2", description: "Millwork base", quantity: 10, uom: "LF", cost_code: "01-30", sort_order: 2 },
  { id: "l1", description: "LVT-1", quantity: 500, uom: "SF", cost_code: "01-26", sort_order: 1 },
  { id: "l3", description: "Carpet", quantity: 40, uom: "SY", cost_code: "01-10", sort_order: 3 },
  { id: "l4", description: "Prep", quantity: 1, uom: "LS", cost_code: null, sort_order: 4 },
];

describe("rates", () => {
  test("same cost code and unit wins, then the cost code alone, never an inactive or blank rate", () => {
    expect(rateFor({ cost_code: "01-26", uom: "SF" }, rates)?.id).toBe("r1");
    expect(rateFor({ cost_code: "01-26", uom: "LF" }, rates)?.id).toBe("r1");
    expect(rateFor({ cost_code: "01-30", uom: "LF" }, rates)).toBeNull();
    expect(rateFor({ cost_code: "01-10", uom: "SY" }, rates)).toBeNull();
    expect(rateFor({ cost_code: null, uom: "LS" }, rates)).toBeNull();
  });
  test("a work order's lines become costed order lines in order; unknown rates stay null", () => {
    const out = orderFromWorkOrder(lines, rates);
    expect(out.map((l) => l.description)).toEqual(["LVT-1", "Millwork base", "Carpet", "Prep"]);
    expect(out[0]).toMatchObject({ visit_line_id: "l1", quantity: 500, uom: "SF", unit_cost_cents: 125, sort_order: 0 });
    expect(out[1]!.unit_cost_cents).toBeNull();
    expect(orderTotal(out)).toEqual({ subtotal_cents: 62500, uncosted: 3 });
    expect(uncostedLines(out)).toEqual(["Millwork base", "Carpet", "Prep"]);
  });
});

describe("numbers and statuses", () => {
  test("PO numbers follow the job", () => {
    expect(poNumber({ project_number: "26-002" }, 1)).toBe("26-002-SUB-01");
    expect(poNumber({ project_number: "26-002" }, 12)).toBe("26-002-SUB-12");
    expect(poNumber({ project_number: null, id: "2f64d344-9c0e" }, 1)).toBe("2F64D344-SUB-01");
  });
  test("a bill moves a sent order to billed, a settled bill to paid, and nothing moves back", () => {
    expect(nextStatus("sent", { bill: false, balanceCents: null })).toBe("sent");
    expect(nextStatus("sent", { bill: true, balanceCents: 62500 })).toBe("billed");
    expect(nextStatus("billed", { bill: true, balanceCents: 0 })).toBe("paid");
    expect(nextStatus("paid", { bill: true, balanceCents: 500 })).toBe("paid");
    expect(nextStatus("cancelled", { bill: true, balanceCents: 0 })).toBe("cancelled");
    expect(nextStatus("draft", { bill: true, balanceCents: 10 })).toBe("billed");
  });
});

describe("QuickBooks", () => {
  const order = { qbo_po_id: "77", po_number: "26-002-SUB-01" };
  test("a bill matches by its link to the purchase order, on the bill or a line, or by the PO number in its text", () => {
    expect(billMatchesOrder({ LinkedTxn: [{ TxnId: "77", TxnType: "PurchaseOrder" }] }, order)).toBe(true);
    expect(billMatchesOrder({ Line: [{ LinkedTxn: [{ TxnId: "77", TxnType: "PurchaseOrder" }] }] }, order)).toBe(true);
    expect(billMatchesOrder({ LinkedTxn: [{ TxnId: "78", TxnType: "PurchaseOrder" }] }, order)).toBe(false);
    expect(billMatchesOrder({ DocNumber: "26-002-sub-01" }, order)).toBe(true);
    expect(billMatchesOrder({ DocNumber: "inv 991 / 26-002-SUB-01" }, order)).toBe(false);
    expect(billMatchesOrder({ PrivateNote: "PO 26-002-SUB-01" }, { qbo_po_id: null, po_number: "26-002-SUB-01" })).toBe(true);
    expect(billMatchesOrder({ Memo: "Job 26-002 · PO 26-002-SUB-01, week 2" }, order)).toBe(true);
    expect(billMatchesOrder({ PrivateNote: "something else" }, order)).toBe(false);
  });
  test("the PO number in free text must stand on its own: -10 is not -100, -1 or 26-002-SUB-10A", () => {
    const ten = { qbo_po_id: null, po_number: "26-002-SUB-10" };
    expect(billMatchesOrder({ PrivateNote: "PO 26-002-SUB-10" }, ten)).toBe(true);
    expect(billMatchesOrder({ PrivateNote: "(26-002-SUB-10)" }, ten)).toBe(true);
    expect(billMatchesOrder({ PrivateNote: "PO 26-002-SUB-100" }, ten)).toBe(false);
    expect(billMatchesOrder({ PrivateNote: "PO 26-002-SUB-10A" }, ten)).toBe(false);
    expect(billMatchesOrder({ PrivateNote: "PO 26-002-SUB-1" }, ten)).toBe(false);
    expect(billMatchesOrder({ Memo: "PO X26-002-SUB-10" }, ten)).toBe(false);
    expect(billMatchesOrder({ DocNumber: "26-002-SUB-100" }, ten)).toBe(false);
  });
  test("amounts come back as cents and lines go out with the account and a real cost", () => {
    expect(qboCents("625.00")).toBe(62500);
    expect(qboCents(12.345)).toBe(1235);
    expect(qboCents(undefined)).toBeNull();
    const out = subcontractPoLines([{ visit_line_id: "l1", description: "LVT-1", quantity: 500, uom: "SF", unit_cost_cents: 125, cost_code: "01-26", sort_order: 0 }], "acct9");
    expect(out[0]).toEqual({ DetailType: "AccountBasedExpenseLineDetail", Amount: 625, Description: "LVT-1 (500 SF)", AccountBasedExpenseLineDetail: { AccountRef: { value: "acct9" } } });
  });
});
