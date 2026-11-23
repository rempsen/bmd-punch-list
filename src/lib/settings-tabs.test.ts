import { describe, expect, test } from "bun:test";
import { COMPANY_TABS, JOB_TABS, canonicalTab, settingsGroup, settingsHeading } from "./settings-tabs";

describe("settings are split into company-wide and this-job", () => {
  test("quotes, integrations, sync, AI, users and roles across the company, and the job lists are company settings", () => {
    for (const t of ["quotes", "integrations", "sync", "ai", "allusers", "roles", "projects", "jobs"]) expect(settingsGroup(t)).toBe("company");
  });
  test("job details, floors and rooms, pick lists, this job's users and CompanyCam are job settings", () => {
    for (const t of ["project", "structure", "lists", "users", "companycam"]) expect(settingsGroup(t)).toBe("job");
  });
  test("Integrations replaces the old Microsoft 365 tab, and AI has its own tab", () => {
    expect(COMPANY_TABS).toContain("integrations");
    expect(COMPANY_TABS).toContain("ai");
    expect(COMPANY_TABS).not.toContain("microsoft");
    expect(settingsGroup("integrations")).toBe("company");
  });
  test("old links to the Microsoft 365 tab land on Integrations; every other tab is left as it is", () => {
    expect(canonicalTab("microsoft")).toBe("integrations");
    expect(canonicalTab("ai")).toBe("ai");
    expect(canonicalTab("structure")).toBe("structure");
    expect(canonicalTab(undefined)).toBeUndefined();
  });
  test("every tab belongs to exactly one group", () => {
    expect(COMPANY_TABS.filter((t) => JOB_TABS.includes(t))).toEqual([]);
    expect(settingsGroup("nonsense")).toBe("company");
  });
  test("the page heading says which kind of settings is open, and names the job only for job settings", () => {
    expect(settingsHeading("quotes", "Hyatt Centric")).toEqual({ title: "Company settings", subtitle: "Apply to every job" });
    expect(settingsHeading("structure", "Hyatt Centric")).toEqual({ title: "Job settings", subtitle: "Hyatt Centric" });
    expect(settingsHeading("structure", null)).toEqual({ title: "Job settings", subtitle: "No job selected" });
  });
});

import { needsJob } from "./settings-tabs";
describe("which screens need a job chosen first", () => {
  test("company-wide screens, including company settings, open with no job chosen", () => {
    for (const p of ["/jobs", "/new-job", "/projects/abc", "/clients", "/pipeline", "/catalogue"]) expect(needsJob(p, undefined)).toBe(false);
    expect(needsJob("/settings", "quotes")).toBe(false);
    expect(needsJob("/settings", "integrations")).toBe(false);
    expect(needsJob("/settings", "microsoft")).toBe(false);
    expect(needsJob("/settings", undefined)).toBe(false);
  });
  test("job screens and job settings still ask for a job", () => {
    for (const p of ["/dashboard", "/board", "/floors", "/documents"]) expect(needsJob(p, undefined)).toBe(true);
    expect(needsJob("/settings", "structure")).toBe(true);
    expect(needsJob("/settings", "users")).toBe(true);
  });
});
