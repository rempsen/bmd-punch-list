import { describe, expect, test } from "bun:test";
import { accessInviteEmail } from "@/lib/invite-email.server";

describe("company invite email", () => {
  const msg = accessInviteEmail({
    requestUrl: "https://projects.bmdmaterials.com/settings",
    email: "jane@client.test",
    token: "tok 1",
    inviterName: "Dan Rosenblat",
    inviteeName: "Jane",
    accessLine: "Client on Hyatt Centric and Test Take Off",
  });
  test("names the access and links to sign-up with the token", () => {
    expect(msg.subject).toBe("You're invited to BMD Projects");
    expect(msg.text).toContain("Your access: Client on Hyatt Centric and Test Take Off");
    expect(msg.text).toContain("https://projects.bmdmaterials.com/auth?invite=tok%201&email=jane%40client.test");
    expect(msg.html).toContain("Dan Rosenblat");
  });
  test("escapes what people typed", () => {
    const m = accessInviteEmail({ requestUrl: "https://x.test", email: "a@b.c", token: "t", inviterName: "<b>", inviteeName: null, accessLine: "x" });
    expect(m.html).not.toContain("<b>");
  });
});
