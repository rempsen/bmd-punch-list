import { describe, expect, test } from "bun:test";
import { gateState, latestPdfs, parseConflict, safeFileName, savedMessage } from "./bmdApi.js";

describe("reading BMD's answers", () => {
  test("a conflict names the version and who saved", () => {
    expect(parseConflict("TAKEOFF_CONFLICT:5:Brian Chornoboy")).toEqual({ version: 5, by: "Brian Chornoboy" });
    expect(parseConflict("ERROR: TAKEOFF_CONFLICT:12:someone else\nCONTEXT: x")).toEqual({ version: 12, by: "someone else" });
    expect(parseConflict("Not allowed to save this takeoff")).toBeNull();
    expect(parseConflict(undefined)).toBeNull();
  });
  test("who may do what", () => {
    expect(gateState({ projectId: "", session: true, project: true, canSave: true })).toBe("noproject");
    expect(gateState({ projectId: "p", session: false, project: false, canSave: false })).toBe("signin");
    expect(gateState({ projectId: "p", session: true, project: false, canSave: false })).toBe("noaccess");
    expect(gateState({ projectId: "p", session: true, project: true, canSave: false })).toBe("readonly");
    expect(gateState({ projectId: "p", session: true, project: true, canSave: true })).toBe("ready");
  });
  test("only the newest version of each PDF is offered, plans and specifications only", () => {
    const rows = [
      { id: "1", section: "plans", file_name: "A-101.pdf", storage_path: "p/plans/1/A-101.pdf", version: 1, mime: "application/pdf" },
      { id: "2", section: "plans", file_name: "a-101.PDF", storage_path: "p/plans/2/a-101.PDF", version: 2, mime: "application/pdf" },
      { id: "3", section: "plans", file_name: "photo.jpg", storage_path: "x", version: 1, mime: "image/jpeg" },
      { id: "4", section: "specifications", file_name: "Spec.pdf", storage_path: "s", version: 1, mime: null },
      { id: "5", section: "vendor", file_name: "Quote.pdf", storage_path: "v", version: 1, mime: "application/pdf" },
    ];
    expect(latestPdfs(rows)).toEqual([
      { id: "plans/a-101.pdf", name: "a-101.PDF", section: "plans", versionId: "2", path: "p/plans/2/a-101.PDF" },
      { id: "specifications/spec.pdf", name: "Spec.pdf", section: "specifications", versionId: "4", path: "s" },
    ]);
  });
  test("storage names are made safe the way BMD Documents makes them", () => {
    expect(safeFileName("Level 2 – Finish Plan (rev B).pdf")).toBe("Level 2 _ Finish Plan (rev B).pdf");
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("???")).toBe("file");
  });
  test("the saved notice names the project and version and nothing else", () => {
    expect(savedMessage("p1", 7)).toEqual({ type: "bmd-takeoff-saved", projectId: "p1", version: 7 });
  });
});
