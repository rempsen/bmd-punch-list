import { describe, expect, test } from "bun:test";
import { isSavedMessage, workspaceUrl } from "./workspace";

const id = "2f64d344-9c0e-4c66-a88f-c1d23ee6481a";
describe("opening the takeoff workspace", () => {
  test("the address carries the project and nothing else", () => {
    expect(workspaceUrl(id)).toBe(`/takeoff/index.html?project=${id}`);
  });
  test("anything that is not a project id is refused", () => {
    expect(() => workspaceUrl("abc")).toThrow();
    expect(() => workspaceUrl(`${id}&x=1`)).toThrow();
  });
  test("a saved notice counts only from this site, for this project", () => {
    const origin = "https://bmd-punch-list.lovable.app";
    const data = { type: "bmd-takeoff-saved", projectId: id, version: 3 };
    expect(isSavedMessage({ origin, data }, origin, id)).toBe(true);
    expect(isSavedMessage({ origin: "https://evil.example", data }, origin, id)).toBe(false);
    expect(isSavedMessage({ origin, data: { ...data, projectId: "other" } }, origin, id)).toBe(false);
    expect(isSavedMessage({ origin, data: { type: "something-else" } }, origin, id)).toBe(false);
    expect(isSavedMessage({ origin, data: null }, origin, id)).toBe(false);
  });
});
