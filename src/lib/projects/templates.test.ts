import { describe, expect, test } from "bun:test";
import { applyTemplate, blankTemplate, cleanTemplate, parseTasks, templateFromJob, templateStages, type JobForm, type JobTemplate } from "./templates";

const tpl: JobTemplate = {
  id: "t1", name: "Hotel refresh", kind: "client", default_stage: "won", job_type: "Hotel", scopes: ["carpet", "other"], other_scope: "Stair nosing",
  contact_roles: ["pm", "super"], visit_tasks: ["Check moisture", "Photos before"], notes: "Night work only",
};
const form: JobForm = { kind: "client", stage: "opportunity", job_type: "", scopes: [], other_scope: "", notes: "", contacts: [], tasks: [] };

describe("parseTasks", () => {
  test("one task per line, trimmed, blanks and repeats dropped", () => {
    expect(parseTasks(" Check moisture \n\n- Photos before\n• check MOISTURE\n")).toEqual(["Check moisture", "Photos before"]);
  });
  test("at most 50 tasks of 200 characters", () => {
    const many = Array.from({ length: 60 }, (_, i) => `Task ${i}`).join("\n");
    expect(parseTasks(many)).toHaveLength(50);
    expect(parseTasks("x".repeat(300))[0]).toHaveLength(200);
  });
});

describe("cleanTemplate", () => {
  test("a template needs a name", () => {
    expect(cleanTemplate({ ...blankTemplate(), name: "  " })).toEqual({ ok: false, error: "Give the template a name" });
  });
  test("tidies what was typed", () => {
    const r = cleanTemplate({ ...blankTemplate(), name: "  Shop time ", kind: "internal", default_stage: "opportunity", job_type: " ", contact_roles: ["pm", "pm", "nonsense" as never], visit_tasks: [" Sweep ", "", "sweep"], notes: "  " });
    expect(r).toEqual({
      ok: true,
      value: { name: "Shop time", kind: "internal", default_stage: "in_progress", job_type: null, scopes: [], other_scope: null, contact_roles: ["pm"], visit_tasks: ["Sweep"], notes: null },
    });
  });
  test("a client job can start in any stage up to In progress; an internal job is always In progress", () => {
    expect(templateStages("client")).toEqual(["opportunity", "estimating", "quote_out", "won", "in_progress"]);
    expect(templateStages("internal")).toEqual(["in_progress"]);
    const r = cleanTemplate({ ...blankTemplate(), name: "X", default_stage: "closed" as never });
    expect(r.ok && r.value.default_stage).toBe("opportunity");
  });
  test("the other-scope wording is kept only when Other is ticked", () => {
    const r = cleanTemplate({ ...blankTemplate(), name: "X", scopes: ["carpet"], other_scope: "Nosing" });
    expect(r.ok && r.value.other_scope).toBeNull();
  });
});

describe("applyTemplate", () => {
  test("fills kind, stage, job type, scope, tasks, notes and a blank contact for each role", () => {
    const f = applyTemplate(form, tpl);
    expect(f.kind).toBe("client");
    expect(f.stage).toBe("won");
    expect(f.job_type).toBe("Hotel");
    expect(f.scopes).toEqual(["carpet", "other"]);
    expect(f.other_scope).toBe("Stair nosing");
    expect(f.tasks).toEqual(["Check moisture", "Photos before"]);
    expect(f.notes).toBe("Night work only");
    expect(f.contacts.map((c) => c.kind)).toEqual(["pm", "super"]);
    expect(f.contacts.every((c) => c.name === "" && c.email === "")).toBe(true);
  });
  test("never overwrites notes or contacts the person already typed", () => {
    const typed = { ...form, notes: "Call first", contacts: [{ kind: "pm" as const, name: "Pat", phone: "204", email: "" }] };
    const f = applyTemplate(typed, tpl);
    expect(f.notes).toBe("Call first");
    expect(f.contacts).toEqual([{ kind: "pm", name: "Pat", phone: "204", email: "" }, { kind: "super", name: "", phone: "", email: "" }]);
  });
  test("carries no prices, estimates or documents", () => {
    expect(Object.keys(applyTemplate(form, tpl)).sort()).toEqual(["contacts", "job_type", "kind", "notes", "other_scope", "scopes", "stage", "tasks"]);
  });
});

describe("templateFromJob", () => {
  test("keeps the reusable parts of a job and none of its people or money", () => {
    const t = templateFromJob(
      { name: "Hyatt L4", kind: "client", stage: "closed", job_type: "Hotel", notes: "Night work", standard_tasks: ["Photos"] },
      [{ kind: "super" }, { kind: "client" }, { kind: "super" }],
      [{ scope: "carpet", other_text: null }, { scope: "other", other_text: "Nosing" }],
    );
    expect(t).toEqual({ name: "Hyatt L4", kind: "client", default_stage: "opportunity", job_type: "Hotel", scopes: ["carpet", "other"], other_scope: "Nosing", contact_roles: ["super"], visit_tasks: ["Photos"], notes: "Night work" });
  });
});
