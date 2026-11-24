import { describe, expect, test } from "bun:test";
import { accessSummary, canAct, filterUsers, levelsFor, userStatus, validateInvite, type AdminUser, defaultAllJobs } from "./logic";

const user = (o: Partial<AdminUser> = {}): AdminUser => ({
  kind: "user",
  id: "u1",
  email: "jane@client.test",
  full_name: "Jane Doe",
  company: "Client Co",
  level: "client",
  all_jobs: false,
  status: "active",
  is_super: false,
  last_sign_in_at: "2026-11-01T00:00:00Z",
  job_count: 1,
  jobs: null,
  invite_id: null,
  invite_token: null,
  invite_sent_at: null,
  invite_error: null,
  has_records: false,
  created_at: "2026-10-01T00:00:00Z",
  ...o,
});
const dan = { id: "dan", isSuper: true };
const mia = { id: "mia", isSuper: false };

describe("what a person can reach, in one line", () => {
  test("selected jobs following the level", () => {
    expect(accessSummary("client", false, [{ name: "Hyatt Centric", role: null }, { name: "Test Take Off", role: null }])).toBe("Client on Hyatt Centric and Test Take Off");
  });
  test("all jobs", () => {
    expect(accessSummary("bmd_manager", true, [])).toBe("BMD manager on all jobs");
  });
  test("several jobs with an exception", () => {
    expect(accessSummary("trade", false, [{ name: "A", role: null }, { name: "B", role: null }, { name: "Hyatt Centric", role: "viewer" }])).toBe("Tradesperson on 3 jobs (Viewer on Hyatt Centric)");
  });
  test("all jobs with an exception", () => {
    expect(accessSummary("bmd_field", true, [{ name: "Hyatt Centric", role: "viewer" }])).toBe("BMD field on all jobs (Viewer on Hyatt Centric)");
  });
  test("no jobs yet", () => {
    expect(accessSummary("client", false, [])).toBe("Client, no jobs yet");
  });
  test("super admin is always everything", () => {
    expect(accessSummary("super_admin", false, [])).toBe("Super admin on all jobs");
  });
});

describe("status", () => {
  test("an invite with no account is invited", () => {
    expect(userStatus(user({ kind: "invite", status: "invited", last_sign_in_at: null }))).toBe("invited");
  });
  test("an expired invite", () => {
    expect(userStatus(user({ kind: "invite", status: "expired" }))).toBe("expired");
  });
  test("an account that never signed in is still invited", () => {
    expect(userStatus(user({ last_sign_in_at: null }))).toBe("invited");
  });
  test("deactivated wins", () => {
    expect(userStatus(user({ status: "deactivated" }))).toBe("deactivated");
  });
  test("active", () => {
    expect(userStatus(user())).toBe("active");
  });
});

describe("who may do what to whom", () => {
  test("nobody deactivates themselves", () => {
    expect(canAct(dan, user({ id: "dan", is_super: true, level: "super_admin" }), "deactivate", 2)).toEqual({ ok: false, why: "You can't deactivate yourself" });
  });
  test("the last active super admin stays", () => {
    expect(canAct(dan, user({ id: "brian", is_super: true, level: "super_admin" }), "deactivate", 1)).toEqual({ ok: false, why: "BMD needs at least one active super admin" });
  });
  test("only a super admin acts on a super admin", () => {
    expect(canAct(mia, user({ id: "dan", is_super: true }), "edit", 2)).toEqual({ ok: false, why: "Only a super admin can change a super admin" });
  });
  test("delete needs deactivation first", () => {
    expect(canAct(dan, user(), "delete", 2)).toEqual({ ok: false, why: "Deactivate first" });
  });
  test("delete refused when their name is on records", () => {
    expect(canAct(dan, user({ status: "deactivated", has_records: true }), "delete", 2)).toEqual({ ok: false, why: "Has records on jobs; keep them deactivated" });
  });
  test("a manager can deactivate field staff and delete a clean deactivated account", () => {
    expect(canAct(mia, user({ level: "bmd_field" }), "deactivate", 1)).toEqual({ ok: true });
    expect(canAct(mia, user({ status: "deactivated" }), "delete", 1)).toEqual({ ok: true });
  });
  test("reactivate only a deactivated person", () => {
    expect(canAct(dan, user(), "reactivate", 2)).toEqual({ ok: false, why: "Already active" });
    expect(canAct(dan, user({ status: "deactivated" }), "reactivate", 2)).toEqual({ ok: true });
  });
});

describe("finding people", () => {
  const list = [user(), user({ id: "u2", full_name: "Chuck Rempsen", email: "rempsen@gmail.com", company: "Rempsen Interiors", level: "trade" }), user({ id: "u3", full_name: "Old Hand", status: "deactivated", company: null })];
  test("search covers name, email and company, ignoring case", () => {
    expect(filterUsers(list, { q: "rempsen int", status: "", level: "" }).map((u) => u.id)).toEqual(["u2"]);
    expect(filterUsers(list, { q: "CLIENT.TEST", status: "", level: "" }).map((u) => u.id)).toEqual(["u1", "u3"]);
  });
  test("filters by status and level", () => {
    expect(filterUsers(list, { q: "", status: "deactivated", level: "" }).map((u) => u.id)).toEqual(["u3"]);
    expect(filterUsers(list, { q: "", status: "", level: "trade" }).map((u) => u.id)).toEqual(["u2"]);
  });
});

describe("levels offered", () => {
  test("only super admins can hand out super admin", () => {
    expect(levelsFor(true)[0]).toBe("super_admin");
    expect(levelsFor(false)).not.toContain("super_admin");
    expect(levelsFor(false)).toEqual(["bmd_manager", "bmd_field", "trade", "client", "viewer"]);
  });
});

describe("checking an invite before it is sent", () => {
  const ok = { email: " Jane@Client.test ", fullName: "Jane", company: "", level: "client" as const, allJobs: false, jobs: [{ projectId: "10000000-0000-0000-0000-000000000001", role: null }] };
  test("a good invite is cleaned up", () => {
    expect(validateInvite(ok)).toEqual({ ok: true, value: { ...ok, email: "jane@client.test", company: null } });
  });
  test("email must look like an email", () => {
    expect(validateInvite({ ...ok, email: "jane" })).toEqual({ ok: false, why: "Enter a valid email address" });
  });
  test("selected jobs needs at least one job", () => {
    expect(validateInvite({ ...ok, jobs: [] })).toEqual({ ok: false, why: "Choose at least one job, or give access to all jobs" });
    expect(validateInvite({ ...ok, jobs: [], allJobs: true }).ok).toBe(true);
  });
  test("job ids must be real ids and the level must exist", () => {
    expect(validateInvite({ ...ok, jobs: [{ projectId: "x", role: null }] })).toEqual({ ok: false, why: "Unknown job" });
    expect(validateInvite({ ...ok, level: "owner" as never })).toEqual({ ok: false, why: "Choose a level" });
  });
});

describe("the all-jobs default", () => {
  test("BMD staff start on every job; trades, clients and viewers start on selected jobs", () => {
    expect(defaultAllJobs("super_admin")).toBe(true);
    expect(defaultAllJobs("bmd_manager")).toBe(true);
    expect(defaultAllJobs("bmd_field")).toBe(true);
    expect(defaultAllJobs("trade")).toBe(false);
    expect(defaultAllJobs("client")).toBe(false);
    expect(defaultAllJobs("viewer")).toBe(false);
  });
});
