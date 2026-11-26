/** QuickBooks item body for one BMD catalogue material. Pure. */
export type ItemSource = { name: string; sku: string | null; unit: string; unit_cost_cents: number | null; description: string | null };

export function qboItemBody(m: ItemSource, accounts: { expenseId: string | null; incomeId: string | null }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    Name: m.name.replace(/[:\t\n]/g, " ").trim().slice(0, 100),
    Type: "NonInventory",
    PurchaseDesc: (m.description || `${m.name} (per ${m.unit})`).slice(0, 4000),
    Description: `${m.name} (per ${m.unit})`.slice(0, 4000),
  };
  if (m.sku) body["Sku"] = m.sku.slice(0, 100);
  if (m.unit_cost_cents != null) body["PurchaseCost"] = m.unit_cost_cents / 100;
  if (accounts.expenseId) body["ExpenseAccountRef"] = { value: accounts.expenseId };
  if (accounts.incomeId) body["IncomeAccountRef"] = { value: accounts.incomeId };
  return body;
}
