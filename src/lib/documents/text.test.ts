import { describe, expect, test } from "bun:test";
import { cleanPages, highlightSnippet, textKind } from "./text";

describe("what can be read for text", () => {
  test("PDF, text and Office formats are supported; images remain files", () => {
    expect(textKind("application/pdf", "A-101.PDF")).toBe("pdf");
    expect(textKind(null, "plans.pdf")).toBe("pdf");
    expect(textKind("text/plain", "notes.txt")).toBe("text");
    expect(textKind("text/markdown", "README.md")).toBe("text");
    expect(textKind(null, "quantities.csv")).toBe("csv");
    expect(textKind("image/jpeg", "site.jpg")).toBe("none");
    expect(textKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "spec.docx")).toBe("docx");
  });
});

describe("cleaning page text", () => {
  test("trims, drops control characters, and caps each page", () => {
    const r = cleanPages(["  hello\u0000 world \u0007 ", "x".repeat(25_000)]);
    expect(r.pages[0]).toBe("hello world");
    expect(r.pages[1]!.length).toBe(20_000);
    expect(r.status).toBe("done");
  });
  test("keeps page numbers even when a page is empty, and reports no text when every page is empty", () => {
    expect(cleanPages(["", "  ", "\u0000"])).toEqual({ pages: ["", "", ""], status: "no_text", truncated: false });
    expect(cleanPages(["", "second"]).pages).toEqual(["", "second"]);
  });
  test("stops adding pages once the total passes 3 MB", () => {
    const page = "y".repeat(20_000);
    const r = cleanPages(Array.from({ length: 200 }, () => page));
    expect(r.pages.length).toBeLessThan(200);
    expect(r.pages.join("").length).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(r.truncated).toBe(true);
  });
});

describe("rendering a search snippet safely", () => {
  test("keeps the search highlight and escapes everything else", () => {
    const parts = highlightSnippet("tile <b>ABC</b> & <script>x</script>");
    expect(parts).toEqual([
      { text: "tile ", mark: false },
      { text: "ABC", mark: true },
      { text: " & <script>x</script>", mark: false },
    ]);
  });
});
