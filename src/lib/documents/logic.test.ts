import { describe, expect, test } from "bun:test";
import { MAX_BYTES, SECTIONS, checkFile, formatBytes, groupVersions, guessSection, previewKind, safeFileName, storagePath, type DocRow } from "./logic";

describe("sections", () => {
  test("are the seven filing sections in order", () => {
    expect(SECTIONS.map((s) => s.value)).toEqual(["plans", "specifications", "vendor", "quotes_sent", "contract", "photos", "other"]);
  });
});

describe("safeFileName", () => {
  test("keeps ordinary names", () => expect(safeFileName("A-101 Floor Plan.pdf")).toBe("A-101 Floor Plan.pdf"));
  test("strips path separators and characters storage keys reject", () => {
    expect(safeFileName("..\\specs/09 65 00: Resilient #2 [rev].pdf")).toBe("specs_09 65 00_ Resilient _2 _rev_.pdf");
  });
  test("flattens accents so the key is plain ASCII", () => expect(safeFileName("Devis révisé – étage 3.pdf")).toBe("Devis revise _ etage 3.pdf"));
  test("a name with nothing usable still yields a key", () => expect(safeFileName("///")).toBe("file"));
  test("keeps the extension when trimming a very long name", () => {
    const out = safeFileName(`${"x".repeat(300)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("storagePath", () => {
  test("is project / section / document / file", () => {
    expect(storagePath("p1", "plans", "d1", "A/101.pdf")).toBe("p1/plans/d1/A_101.pdf");
  });
});

describe("checkFile", () => {
  test("accepts a file at the limit", () => expect(checkFile({ name: "a.pdf", size: MAX_BYTES })).toBeNull());
  test("rejects a file over 250 MB with its size", () => {
    expect(checkFile({ name: "big.pdf", size: MAX_BYTES + 1 })).toBe("big.pdf is 250.0 MB — the limit is 250 MB per file.");
  });
  test("rejects an empty file", () => expect(checkFile({ name: "empty.pdf", size: 0 })).toBe("empty.pdf is empty."));
});

describe("formatBytes", () => {
  test("picks a readable unit", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("previewKind", () => {
  test("pdf by mime or by extension", () => {
    expect(previewKind("application/pdf", "x")).toBe("pdf");
    expect(previewKind("application/octet-stream", "Plan.PDF")).toBe("pdf");
  });
  test("browser-displayable images", () => {
    expect(previewKind("image/jpeg", "a.jpg")).toBe("image");
    expect(previewKind("", "a.webp")).toBe("image");
  });
  test("everything else has no preview", () => {
    expect(previewKind("application/vnd.ms-excel", "a.xls")).toBeNull();
    expect(previewKind("image/tiff", "scan.tiff")).toBeNull();
    expect(previewKind("image/svg+xml", "logo.svg")).toBeNull();
  });
});

describe("guessSection", () => {
  test("spec-like names go to specifications, drawings to plans", () => {
    expect(guessSection("Section 09 65 00 Resilient Flooring.pdf")).toBe("specifications");
    expect(guessSection("Project Manual - Specifications.pdf")).toBe("specifications");
    expect(guessSection("A-101 Level 1 Finish Plan.pdf")).toBe("plans");
  });
  test("photos by type", () => expect(guessSection("IMG_2041.jpg", "image/jpeg")).toBe("photos"));
});

describe("groupVersions", () => {
  const d = (o: Partial<DocRow>): DocRow => ({
    id: "x", project_id: "p", section: "plans", file_name: "A-101.pdf", storage_path: "s", size_bytes: 1, mime: "application/pdf",
    version: 1, uploaded_by: null, note: null, mirror_status: "pending", mirror_error: null, created_at: "2026-11-01T00:00:00Z", ...o,
  });
  test("same name in the same section becomes one entry with the newest first", () => {
    const g = groupVersions([d({ id: "1", version: 1 }), d({ id: "2", version: 2 }), d({ id: "3", file_name: "A-102.pdf" })]);
    expect(g.plans.map((e) => [e.latest.id, e.older.map((o) => o.id)])).toEqual([["2", ["1"]], ["3", []]]);
  });
  test("name matching ignores case; sections stay separate", () => {
    const g = groupVersions([d({ id: "1" }), d({ id: "2", file_name: "a-101.PDF", version: 2 }), d({ id: "3", section: "contract" })]);
    expect(g.plans).toHaveLength(1);
    expect(g.contract).toHaveLength(1);
    expect(g.vendor).toEqual([]);
  });
});
