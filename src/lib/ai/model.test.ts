import { describe, expect, test } from "bun:test";
import { chooseModel, meetsMinimum } from "./model";

describe("AI model standard", () => {
  test("the strongest available Claude model is chosen, never one below Opus 5.5", () => {
    expect(chooseModel(["openai/gpt-6-astra", "anthropic/claude-opus-5", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5"])).toBe("anthropic/claude-opus-5.5");
    expect(chooseModel(["anthropic/claude-opus-5-5", "anthropic/claude-fable-5.1", "anthropic/claude-haiku-4.5"])).toBe("anthropic/claude-fable-5.1");
    expect(chooseModel(["anthropic/claude-fable-5.1", "anthropic/claude-fable-5.2"])).toBe("anthropic/claude-fable-5.2");
    expect(chooseModel(["claude-opus-5-5-20260801", "claude-opus-6"])).toBe("claude-opus-6");
    expect(chooseModel(["anthropic/claude-opus-5.6", "anthropic/claude-opus-5.5"])).toBe("anthropic/claude-opus-5.6");
  });
  test("when nothing meets the standard, no model is chosen rather than a weaker one", () => {
    expect(chooseModel(["openai/gpt-6-astra", "anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "anthropic/claude-opus-4.5"])).toBeNull();
    expect(chooseModel([])).toBeNull();
  });
  test("what counts as meeting the standard", () => {
    expect(meetsMinimum("anthropic/claude-opus-5.5")).toBe(true);
    expect(meetsMinimum("anthropic/claude-opus-5")).toBe(false);
    expect(meetsMinimum("anthropic/claude-sonnet-5.5")).toBe(false);
    expect(meetsMinimum("anthropic/claude-fable-5.1")).toBe(true);
    expect(meetsMinimum("openai/gpt-6-astra")).toBe(false);
  });
});
