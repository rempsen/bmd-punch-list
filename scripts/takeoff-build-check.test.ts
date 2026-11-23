import { expect, test } from "bun:test";
import { checkBuild } from "./takeoff-build-check.mjs";

const html = '<script type="module" src="/takeoff/assets/index-a.js"></script><link href="/takeoff/assets/i.css">';
test("a good build passes", () => expect(checkBuild([{ path: "assets/index-a.js", bytes: 2_000_000 }], html)).toEqual([]));
test("a file over 24 MB is named", () => expect(checkBuild([{ path: "assets/ort.wasm", bytes: 24 * 1024 * 1024 + 1 }], html)[0]).toContain("assets/ort.wasm"));
test("assets not under /takeoff/ are named", () => expect(checkBuild([], '<script src="/assets/index-a.js"></script>')[0]).toContain("/assets/index-a.js"));
test("a build with no entry script fails", () => expect(checkBuild([], "<html></html>").length).toBe(1));
