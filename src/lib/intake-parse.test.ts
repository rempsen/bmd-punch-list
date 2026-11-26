import { describe, expect, test } from "bun:test";
import { parseIntakeReply } from "./intake-parse";

const full = { job: "Hyatt Centric", floor: "Floor 5", location: "512", area: "Suites", material: "LVT", issue_type: "Scratch", assessment: "must_fix", description: "Deep scratch.", due_date: null, urgency: null, confidence: { job: 0.9, location: 0.8, material: 0.7, issue_type: 0.6 } };

describe("the model's reply to an intake email", () => {
  test("JSON inside prose or a code fence is read", () => {
    expect(parseIntakeReply("Here you go:\n```json\n" + JSON.stringify(full) + "\n```")).toEqual(full);
  });
  test("missing fields become null, missing confidence becomes 0", () => {
    const r = parseIntakeReply('{"job":"Hyatt Centric","confidence":{"job":1}}');
    expect(r.floor).toBeNull();
    expect(r.confidence).toEqual({ job: 1, location: 0, material: 0, issue_type: 0 });
  });
  test("a non-string value is not trusted", () => {
    expect(parseIntakeReply('{"job":42,"floor":["5"]}').job).toBeNull();
  });
  test("no JSON at all is an error, not an empty record", () => {
    expect(() => parseIntakeReply("Sorry, I can't help with that.")).toThrow();
  });
});
