import { describe, expect, test } from "bun:test";
import { CONTACT_KINDS, contactKindLabel, orderContacts, telHref } from "./contacts";

describe("site contact roles", () => {
  test("the customer's project manager and the site superintendent are roles of their own", () => {
    expect(contactKindLabel("pm")).toBe("Customer's project manager");
    expect(contactKindLabel("super")).toBe("Site superintendent");
    expect(CONTACT_KINDS.map((k) => k.value)).toEqual(["client", "pm", "super", "gc", "site", "other"]);
  });
  test("an unknown role is shown as written", () => expect(contactKindLabel("architect")).toBe("architect"));
  test("the project manager and superintendent are listed first, then the rest in their saved order", () => {
    const list = [
      { kind: "client", sort_order: 1, name: "C" },
      { kind: "super", sort_order: 5, name: "S" },
      { kind: "site", sort_order: 2, name: "X" },
      { kind: "pm", sort_order: 9, name: "P" },
    ];
    expect(orderContacts(list).map((c) => c.name)).toEqual(["P", "S", "C", "X"]);
  });
});

describe("tap to call", () => {
  test("a phone number becomes a tel link with only digits", () => {
    expect(telHref("(204) 555-0142")).toBe("tel:2045550142");
    expect(telHref("+1 204.555.0142")).toBe("tel:+12045550142");
  });
  test("an extension is kept as a pause", () => expect(telHref("204-555-0142 ext 12")).toBe("tel:2045550142,12"));
  test("nothing dialable gives no link", () => {
    expect(telHref("")).toBeNull();
    expect(telHref(null)).toBeNull();
    expect(telHref("ask Pat")).toBeNull();
  });
});
