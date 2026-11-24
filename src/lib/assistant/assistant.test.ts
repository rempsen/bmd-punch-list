import { describe, expect, test } from "bun:test";
import type { ToolReply, Turn } from "@/lib/ai/tools";
import { conversationTitle, LOOKUPS, memoryTitle, rememberRequest, RESULT_CHARS, resultText, sourcesFrom, systemPrompt } from "./prompt";
import { runConversation } from "./run";

describe("the assistant's instructions", () => {
  test("name the open job so 'this job' needs no project id, and hold the pricing line for people without it", () => {
    const withJob = systemPrompt({ askerName: "Dan", today: "24 Nov 2026", project: { id: "p1", name: "Tuxedo Towers", number: "26-014" }, canPrice: true, canRemember: true });
    expect(withJob).toContain('26-014 "Tuxedo Towers"');
    expect(withJob).toContain("project_id p1");
    expect(withJob).toContain("may see costs");
    const noPrice = systemPrompt({ askerName: "Sam", today: "24 Nov 2026", project: null, canPrice: false, canRemember: false });
    expect(noPrice).toContain("No job is open");
    expect(noPrice).toContain("does not have pricing access");
    expect(noPrice).toContain("only managers can add to Knowledge");
  });
  test("every lookup has a JSON schema the gateway accepts", () => {
    for (const t of LOOKUPS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.parameters).toMatchObject({ type: "object" });
    }
    expect(LOOKUPS.map((t) => t.name)).toContain("search_document_pages".replace("_pages", "s"));
  });
});

describe("remember that…", () => {
  test("recognises the request and keeps the wording", () => {
    expect(rememberRequest("Remember that Ceratech lead time is six weeks.")).toBe("Ceratech lead time is six weeks.");
    expect(rememberRequest("please remember: we never install over gypsum topping without a moisture test")).toBe("we never install over gypsum topping without a moisture test");
    expect(rememberRequest("Do you remember the ABC quote?")).toBeNull();
    expect(rememberRequest("remember")).toBeNull();
  });
  test("a memory's title is its first clause", () => {
    expect(memoryTitle("Ceratech lead time is six weeks. Order early in spring.")).toBe("Ceratech lead time is six weeks");
    expect(memoryTitle("x".repeat(120)).length).toBeLessThanOrEqual(90);
  });
});

describe("results and sources", () => {
  test("long results are cut with a note so the model narrows the search", () => {
    const s = resultText("a".repeat(RESULT_CHARS + 50));
    expect(s.length).toBeLessThan(RESULT_CHARS + 100);
    expect(s).toContain("narrow the search");
  });
  test("sources list each document page and knowledge item once, and name the records used", () => {
    const sources = sourcesFrom([
      { name: "search_documents", value: [{ document_id: "d1", file_name: "Spec.pdf", page: 4 }, { document_id: "d1", file_name: "Spec.pdf", page: 4 }, { document_id: "d2", file_name: "Plan.pdf", page: 1 }] },
      { name: "read_document_page", value: { document_id: "d1", file_name: "Spec.pdf", page: 4, text: "…" } },
      { name: "search_knowledge", value: [{ item_id: "k1", kind: "memory", title: "Ceratech lead time", file_name: null, page: null }, { item_id: "k2", kind: "file", title: "Price list", file_name: "Ceratech 2026.pdf", page: 2 }] },
      { name: "company_details", value: { company_name: "BMD" } },
      { name: "search_clients", value: [] },
    ]);
    expect(sources.map((s) => s.label)).toEqual(["Spec.pdf, p. 4", "Plan.pdf, p. 1", "Memory: Ceratech lead time", "Ceratech 2026.pdf, p. 2", "Company settings", "Client records"]);
    expect(sources[0]).toMatchObject({ kind: "document", documentId: "d1", page: 4 });
  });
  test("conversation titles come from the first question", () => {
    expect(conversationTitle("  What is our GST number?  ")).toBe("What is our GST number?");
    expect(conversationTitle("w".repeat(100)).length).toBeLessThanOrEqual(80);
  });
});

describe("the conversation loop", () => {
  const tools = LOOKUPS;
  test("runs the lookups the model asks for, records them without results, and returns the answer with sources", async () => {
    const seen: Turn[][] = [];
    const replies: ToolReply[] = [
      { text: "", calls: [{ id: "c1", name: "search_documents", args: { q: "tile" } }] },
      { text: "Spec p. 4 calls for ABC tile.", calls: [] },
    ];
    const r = await runConversation({
      system: "s",
      history: [],
      message: "What tile?",
      tools,
      lookups: { search_documents: async (args) => [{ document_id: "d1", file_name: "Spec.pdf", page: 4, snippet: `found ${String(args["q"])}` }] },
      model: async (ask) => {
        seen.push(ask.turns);
        return { reply: replies.shift()!, model: "m" };
      },
    });
    expect(r.answer).toBe("Spec p. 4 calls for ABC tile.");
    expect(r.lookups).toEqual([{ name: "search_documents", args: { q: "tile" } }]);
    expect(r.sources).toEqual([{ kind: "document", label: "Spec.pdf, p. 4", documentId: "d1", page: 4 }]);
    expect(r.model).toBe("m");
    expect(r.rounds).toBe(2);
    // The second ask carried the tool result back to the model.
    const second = seen[1]!;
    expect(second[1]).toMatchObject({ role: "assistant", calls: [{ name: "search_documents" }] });
    expect(second[2]).toMatchObject({ role: "tool", results: [{ id: "c1", content: expect.stringContaining("found tile") }] });
  });
  test("a lookup that fails or does not exist is reported to the model, not thrown", async () => {
    let asked = 0;
    const r = await runConversation({
      system: "s",
      history: [],
      message: "?",
      tools,
      lookups: { search_clients: async () => { throw new Error("Not allowed"); } },
      model: async (ask) => {
        asked += 1;
        if (asked === 1) return { reply: { text: "", calls: [{ id: "a", name: "search_clients", args: {} }, { id: "b", name: "nope", args: {} }] }, model: "m" };
        const tool = ask.turns.at(-1)!;
        expect(tool.role === "tool" && tool.results.map((x) => x.content)).toEqual(["Error: Not allowed", 'Error: there is no lookup called "nope".']);
        return { reply: { text: "Sorry.", calls: [] }, model: "m" };
      },
    });
    expect(r.answer).toBe("Sorry.");
  });
  test("stops after the allowed rounds and says so", async () => {
    const r = await runConversation({
      system: "s",
      history: [],
      message: "?",
      tools,
      lookups: { search_projects: async () => [] },
      model: async () => ({ reply: { text: "", calls: [{ id: "x", name: "search_projects", args: {} }] }, model: "m" }),
      maxRounds: 2,
    });
    expect(r.rounds).toBe(2);
    expect(r.answer).toContain("2 times");
    expect(r.lookups).toHaveLength(2);
  });
});
