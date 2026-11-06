/**
 * Legacy URL compatibility (UI-01): only a real UUID identity opens a canonical
 * route. Demo-specific names and missing identities never guess data — they
 * produce the honest «Запись не указана» outcome.
 */
import { describe, expect, it } from "vitest";
import { LEGACY_HTML_NAMES, LEGACY_NOT_SPECIFIED, isRealUuid, resolveLegacyRoute } from "./legacyRoutes";

const LAB = "11111111-2222-4333-8444-555555555555";
const PARTY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EXAM = "99999999-8888-4777-8666-555555555555";
const REPORT = "77777777-6666-4555-8444-333333333333";
const USER = "66666666-5555-4444-8333-222222222222";

describe("legacy route resolver", () => {
  it("accepts only real UUIDs as identity", () => {
    expect(isRealUuid(PARTY)).toBe(true);
    expect(isRealUuid("usmanov")).toBe(false);
    expect(isRealUuid("")).toBe(false);
    expect(isRealUuid("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeeg")).toBe(false);
    expect(isRealUuid("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE")).toBe(true);
  });

  it("maps legacy HTML names with a real UUID to canonical routes", () => {
    expect(resolveLegacyRoute("/evsd-check-usmanov.html", `party_id=${PARTY}`, LAB)).toEqual({
      outcome: "route",
      path: `/labs/${LAB}/arrivals/${PARTY}/reconciliation`,
    });
    expect(resolveLegacyRoute("/electronic-vse-journal-biektau.html", `party_id=${PARTY}`, LAB)).toEqual({
      outcome: "route",
      path: `/labs/${LAB}/arrivals/${PARTY}/examination/new`,
    });
    expect(resolveLegacyRoute("/journal.html", `examination_id=${EXAM}`, LAB)).toEqual({
      outcome: "route",
      path: `/labs/${LAB}/examinations/${EXAM}`,
    });
    expect(resolveLegacyRoute("/vse-view-bad.html", `examination_id=${EXAM}`, LAB)).toEqual({
      outcome: "route",
      path: `/labs/${LAB}/examinations/${EXAM}`,
    });
    expect(resolveLegacyRoute("/admin-reports.html", `report_id=${REPORT}`, LAB)).toEqual({
      outcome: "route",
      path: `/labs/${LAB}/reports/${REPORT}`,
    });
    expect(resolveLegacyRoute("/admin-users.html", `user_id=${USER}`, LAB)).toEqual({
      outcome: "route",
      path: `/users/${USER}/edit`,
    });
  });

  it("test_legacy_url_without_identity", () => {
    // No identity query at all.
    expect(resolveLegacyRoute("/journal.html", "", LAB)).toEqual({
      outcome: "not-specified",
      message: LEGACY_NOT_SPECIFIED,
    });
    // A demo-specific name is not an identity: no demo data in production.
    expect(resolveLegacyRoute("/evsd-check-usmanov.html", "party_id=usmanov", LAB)).toEqual({
      outcome: "not-specified",
      message: LEGACY_NOT_SPECIFIED,
    });
    expect(resolveLegacyRoute("/arrivals.html", "party_id=1", LAB)).toEqual({
      outcome: "not-specified",
      message: LEGACY_NOT_SPECIFIED,
    });
  });

  it("cannot resolve without a laboratory scope and never invents one", () => {
    expect(resolveLegacyRoute("/journal.html", `examination_id=${EXAM}`, null)).toEqual({
      outcome: "not-specified",
      message: LEGACY_NOT_SPECIFIED,
    });
  });

  it("ignores paths that are not part of the legacy HTML inventory", () => {
    expect(resolveLegacyRoute("/labs/x/arrivals", "", LAB)).toBeNull();
    expect(LEGACY_HTML_NAMES).not.toContain("/milk-norms-data.js");
  });
});
