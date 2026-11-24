import { describe, expect, test } from "bun:test";
import { latestQuote, listSummary, type ListQuote } from "./list";

const q = (o: Partial<ListQuote>): ListQuote => ({ id: "q", project_id: "p", number: "Q-1", status: "draft", value_cents: null, accepted_value_cents: null, sent_at: null, accepted_at: null, created_at: "2026-11-01T00:00:00Z", ...o });

describe("latest quote for a project", () => {
  test("skips superseded revisions", () => {
    expect(latestQuote([q({ id: "a", status: "sent", created_at: "2026-11-01" }), q({ id: "b", status: "superseded", created_at: "2026-11-05" })])?.id).toBe("a");
  });
});

describe("summary strip", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  test("counts estimates with no quote", () => {
    expect(listSummary([{ projectId: "1", hasEstimate: true, quote: null }], now).noQuote).toBe(1);
  });
  test("quotes out are sent quotes, with their total", () => {
    const s = listSummary([{ projectId: "1", hasEstimate: true, quote: q({ status: "sent", value_cents: 5000 }) }, { projectId: "2", hasEstimate: true, quote: q({ status: "declined", value_cents: 9000 }) }], now);
    expect([s.outCount, s.outCents]).toEqual([1, 5000]);
  });
  test("won this month only counts quotes accepted this month", () => {
    const s = listSummary([
      { projectId: "1", hasEstimate: true, quote: q({ status: "accepted", accepted_value_cents: 7000, accepted_at: "2026-11-03T00:00:00Z" }) },
      { projectId: "2", hasEstimate: true, quote: q({ status: "accepted", accepted_value_cents: 1000, accepted_at: "2026-10-30T00:00:00Z" }) },
    ], now);
    expect(s.wonCents).toBe(7000);
  });
});
