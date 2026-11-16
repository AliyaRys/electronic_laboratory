/**
 * Capability predicates of the reporting directions (DR37 §Task 3): the role
 * never opens a direction by its name, only capabilities from GET /me do.
 */
import { describe, expect, it } from "vitest";
import { reportAccess } from "./reportCapabilities";

const ALL = [
  "arrivals:read",
  "sample:read",
  "report:operational",
  "report:5vet-list",
  "report:5vet-read",
  "report:5vet-preview",
  "report:5vet-save",
  "report:5vet-delete",
  "report:5vet-export",
];

describe("reportAccess", () => {
  it("an ANALYST-like capability set opens all directions including creation", () => {
    const access = reportAccess(ALL);
    expect(access).toMatchObject({
      samples: true,
      operational: true,
      list5vet: true,
      read5vet: true,
      create5vet: true,
      export5vet: true,
      delete5vet: true,
      any: true,
    });
  });

  it("a VET with sample:read gets only «Учёт проб» (O-05 over the old PDR-003)", () => {
    const access = reportAccess(["sample:read"]);
    expect(access.samples).toBe(true);
    expect(access.operational).toBe(false);
    expect(access.list5vet).toBe(false);
    expect(access.create5vet).toBe(false);
    expect(access.any).toBe(true);
  });

  it("creation needs BOTH preview and save capabilities", () => {
    expect(reportAccess(["report:5vet-preview"]).create5vet).toBe(false);
    expect(reportAccess(["report:5vet-save"]).create5vet).toBe(false);
    expect(reportAccess(["report:5vet-preview", "report:5vet-save"]).create5vet).toBe(true);
  });

  it("a user without any reporting capability has no direction (ADMIN)", () => {
    const access = reportAccess(["users:list", "catalog:read"]);
    expect(access.any).toBe(false);
    expect(access.samples).toBe(false);
  });

  it("an undefined capability list opens nothing", () => {
    expect(reportAccess(undefined).any).toBe(false);
  });
});
