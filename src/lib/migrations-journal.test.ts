import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Several sessions add migrations at once; this keeps the journal and the files in step.
const dir = join(import.meta.dir, "../../drizzle/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -4));
const entries = (JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] }).entries;

describe("migration journal", () => {
  test("every migration file is in the journal, once", () => {
    const tags = entries.map((e) => e.tag);
    expect(files.filter((f) => !tags.includes(f))).toEqual([]);
    expect(tags.filter((t, i) => tags.indexOf(t) !== i)).toEqual([]);
  });
  test("every journal entry has its file", () => {
    expect(entries.map((e) => e.tag).filter((t) => !files.includes(t))).toEqual([]);
  });
  test("entries are numbered 0, 1, 2… in order, with no repeats or gaps", () => {
    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i));
  });
});
