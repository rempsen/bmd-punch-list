import { expect, test } from "bun:test";
import { visibleKnowledgeHits } from "./knowledge-access";
import { sourcesFrom } from "./prompt";
import { lookupsFor, type Sb } from "./lookups";

test("pricing-only Knowledge never appears in non-pricing assistant search", async () => {
  const hits = [
    { item_id: "public", kind: "file", visibility: "all_staff", file_name: "schedule.xlsx", page: 1 },
    { item_id: "secret", kind: "file", visibility: "pricing_only", file_name: "pricing.docx", page: 1 },
  ];
  const chain = { select: () => chain, in: async () => ({ data: [], error: null }) };
  const sb = { rpc: async () => ({ data: hits, error: null }), from: () => chain } as unknown as Sb;
  const search = lookupsFor(sb, { canPrice: false })['search_knowledge'];
  if (!search) throw new Error("Missing search");
  const result = await search({ q: "flooring" }) as { item_id: string }[];
  expect(result.map((r) => r.item_id)).toEqual(["public"]);
  expect(visibleKnowledgeHits(hits, true).map((r) => r.item_id)).toEqual(["public", "secret"]);
});
test("Office citations carry filename and section or sheet label", () => {
  const sources = sourcesFrom([{ name: "search_knowledge", value: [
    { item_id: "word", kind: "file", file_name: "spec.docx", page: 3, page_label: "section 3 of 7" },
    { item_id: "excel", kind: "file", file_name: "schedule.xlsx", page: 2, page_label: "sheet Install" },
  ] }]);
  expect(sources.map((s) => s.label)).toEqual(["spec.docx, section 3 of 7", "schedule.xlsx, sheet Install"]);
});
