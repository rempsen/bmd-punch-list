import { describe, expect, test } from "bun:test";
import { COMPANY_TABS, JOB_TABS, settingsGroup, settingsHeading } from "./settings-tabs";

describe("settings are split into company-wide and this-job", () => {
  test("quotes, Microsoft 365, users and roles across the company, and the job lists are company settings", () => {
    for (const t of ["quotes", "microsoft", "sync", "allusers", "roles", "projects", "jobs"]) expect(settingsGroup(t)).toBe("company");
  });
  test("job details, floors and rooms, pick lists, this job's users and CompanyCam are job settings", () => {
    for (const t of ["project", "structure", "lists", "users", "companycam"]) expect(settingsGroup(t)).toBe("job");
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
    expect(needsJob("/settings", "microsoft")).toBe(false);
    expect(needsJob("/settings", undefined)).toBe(false);
  });
  test("job screens and job settings still ask for a job", () => {
    for (const p of ["/dashboard", "/board", "/floors", "/documents"]) expect(needsJob(p, undefined)).toBe(true);
    expect(needsJob("/settings", "structure")).toBe(true);
    expect(needsJob("/settings", "users")).toBe(true);
  });
});
