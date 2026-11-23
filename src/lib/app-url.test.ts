import { describe, expect, test } from "bun:test";
import { appOrigin } from "./app-url";

describe("the address BMD Projects gives out in emails and to other systems", () => {
  test("is the address the person is using, when it is one of ours", () => {
    expect(appOrigin("https://projects.bmdmaterials.com/settings?tab=x")).toBe("https://projects.bmdmaterials.com");
    expect(appOrigin("https://bmd-punch-list.lovable.app/jobs")).toBe("https://bmd-punch-list.lovable.app");
  });
  test("a preview or unknown address is never given out; the live address is used", () => {
    expect(appOrigin("https://id-preview--abc.lovable.app/x")).toBe("https://bmd-punch-list.lovable.app");
    expect(appOrigin("https://evil.example.com/x")).toBe("https://bmd-punch-list.lovable.app");
    expect(appOrigin("http://projects.bmdmaterials.com/x")).toBe("https://bmd-punch-list.lovable.app");
    expect(appOrigin(undefined)).toBe("https://bmd-punch-list.lovable.app");
    expect(appOrigin("not a url")).toBe("https://bmd-punch-list.lovable.app");
  });
  test("a set primary address wins, whatever address the person is on", () => {
    expect(appOrigin("https://bmd-punch-list.lovable.app/jobs", "https://projects.bmdmaterials.com/")).toBe("https://projects.bmdmaterials.com");
    expect(appOrigin(undefined, "https://projects.bmdmaterials.com")).toBe("https://projects.bmdmaterials.com");
  });
  test("a primary address that is not one of ours is ignored", () => {
    expect(appOrigin("https://bmd-punch-list.lovable.app/jobs", "https://evil.example.com")).toBe("https://bmd-punch-list.lovable.app");
  });
});
