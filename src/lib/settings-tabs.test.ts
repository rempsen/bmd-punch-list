import { describe, expect, test } from "bun:test";
import { COMPANY_TABS, JOB_TABS, settingsGroup, settingsHeading } from "./settings-tabs";

describe("settings are split into company-wide and this-job", () => {
  test("quotes, Microsoft 365, users and roles across the company, and the job lists are company settings", () => {
    for (const t of ["quotes", "microsoft", "allusers", "roles", "projects", "jobs"]) expect(settingsGroup(t)).toBe("company");
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
