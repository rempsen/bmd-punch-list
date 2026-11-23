import { describe, expect, test } from "bun:test";
import { changeSummary, decideInbound } from "./logic";

describe("a change arriving from QuickBooks, ArrivePing or CompanyCam", () => {
  test("is taken when BMD has not changed the value since the last sync", () => {
    expect(decideInbound({ bmd: 175, lastSynced: 175, incoming: 190 })).toBe("apply");
  });
  test("is ignored when it is what BMD already has", () => {
    expect(decideInbound({ bmd: 190, lastSynced: 175, incoming: 190 })).toBe("same");
    expect(decideInbound({ bmd: null, lastSynced: null, incoming: null })).toBe("same");
  });
  test("loses to BMD when both sides changed: BMD is the source of truth", () => {
    expect(decideInbound({ bmd: 200, lastSynced: 175, incoming: 190 })).toBe("bmd_wins");
  });
  test("on the first load BMD is the receiver: a value BMD does not have yet is taken", () => {
    expect(decideInbound({ bmd: null, lastSynced: undefined, incoming: 190 })).toBe("apply");
  });
  test("on the first load a value BMD already holds is kept", () => {
    expect(decideInbound({ bmd: 200, lastSynced: undefined, incoming: 190 })).toBe("bmd_wins");
  });
  test("an unknown price arriving never wipes a price BMD has", () => {
    expect(decideInbound({ bmd: 175, lastSynced: 175, incoming: null })).toBe("bmd_wins");
  });
});

describe("changeSummary", () => {
  test("says what changed in plain words, with money as dollars", () => {
    expect(changeSummary({ unit_cost_cents: { from: null, to: 235 }, name: { from: "LVT", to: "Install LVT" } })).toBe("Cost: $2.35 · Name: LVT → Install LVT");
    expect(changeSummary({ active: { from: true, to: false } })).toBe("Active: yes → no");
    expect(changeSummary({})).toBe("No field changes");
  });
  test("leaves out fields that did not really change, and reads a new record as its values", () => {
    expect(changeSummary({ cost_code: { from: null, to: null }, name: { from: null, to: "Install LVT" }, unit_cost_cents: { from: null, to: 310 } })).toBe("Name: Install LVT · Cost: $3.10");
  });
});
