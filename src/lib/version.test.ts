import { describe, expect, test } from "bun:test";
import { entryAsset, isNewerBuild } from "./version";

const page = (hash: string) => `<html><head><link rel="modulepreload" href="/assets/index-${hash}.js"><script type="module" src="/assets/index-${hash}.js"></script></head></html>`;

describe("noticing that a newer version has been published", () => {
  test("the build is identified by the app's entry file", () => {
    expect(entryAsset(page("CSmCU2PB"))).toBe("assets/index-CSmCU2PB.js");
    expect(entryAsset("<html></html>")).toBeNull();
  });
  test("a different entry file on the server means this tab is out of date", () => {
    expect(isNewerBuild(page("CSmCU2PB"), page("Zx_9-aQ1"))).toBe(true);
    expect(isNewerBuild(page("CSmCU2PB"), page("CSmCU2PB"))).toBe(false);
  });
  test("when either side cannot be read (local development, an error page) nothing is claimed", () => {
    expect(isNewerBuild("<html></html>", page("CSmCU2PB"))).toBe(false);
    expect(isNewerBuild(page("CSmCU2PB"), "Service unavailable")).toBe(false);
  });
});
