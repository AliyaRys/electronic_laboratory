/**
 * Legacy HTML URL compatibility (UI-01).
 *
 * Old ``*.html`` links may carry identity query parameters (``party_id``,
 * ``examination_id``, ``report_id``, ``user_id``). The resolver only trusts a
 * real UUID: demo-specific names never become a production key, and a link
 * without identity produces the honest «Запись не указана» outcome — no data
 * is guessed from a file name or a row order.
 */

export const LEGACY_NOT_SPECIFIED = "Запись не указана";

export const LEGACY_HTML_NAMES: readonly string[] = Object.freeze([
  "/login.html",
  "/password-recovery.html",
  "/password-recovery-sent.html",
  "/profile.html",
  "/admin-profile.html",
  "/admin-users.html",
  "/admin-reports.html",
  "/journal.html",
  "/journal-milk.html",
  "/arrivals.html",
  "/arrivals-milk.html",
  "/arrivals-work.html",
  "/arrivals-work-milk.html",
  "/arrivals-accepted.html",
  "/arrivals-accepted-milk.html",
  "/directories.html",
  "/directory-price-edit.html",
  "/directory-norms-edit.html",
  "/evsd-check-usmanov.html",
  "/evsd-check-ak-bars.html",
  "/evsd-check-nur.html",
  "/evsd-check-sadykova.html",
  "/evsd-check-tan.html",
  "/electronic-vse-journal.html",
  "/electronic-vse-journal-biektau.html",
  "/electronic-vse-journal-kazan-bacon.html",
  "/electronic-vse-journal-milk.html",
  "/vse-view.html",
  "/vse-view-bad.html",
  "/additional-vet-inspection-create.html",
  "/sample-accounting.html",
  "/no-products.html",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only a real (versioned, RFC-compatible) UUID counts as identity. */
export function isRealUuid(value: string | null): boolean {
  return value !== null && UUID_PATTERN.test(value.trim());
}

export type LegacyOutcome =
  { outcome: "route"; path: string } | { outcome: "not-specified"; message: string };

/**
 * Resolve a legacy pathname + query string into a canonical SPA route.
 *
 * Returns ``null`` when the path is not part of the legacy HTML inventory
 * (the SPA router handles it). Without a real UUID identity — or without a
 * known laboratory scope — the outcome is «Запись не указана»: understandable,
 * accessible, and never a fabricated record.
 */
export function resolveLegacyRoute(
  pathname: string,
  search: string,
  labId: string | null,
): LegacyOutcome | null {
  if (!LEGACY_HTML_NAMES.includes(pathname)) {
    return null;
  }
  const params = new URLSearchParams(search);

  const partyId = params.get("party_id");
  if (isRealUuid(partyId)) {
    if (labId === null || !isRealUuid(labId)) return notSpecified();
    // evsd-check*.html — мясные и молочные сверки; electronic-vse-journal — создание ВСЭ.
    if (pathname.startsWith("/evsd-check-")) {
      return { outcome: "route", path: `/labs/${labId}/arrivals/${partyId}/reconciliation` };
    }
    if (pathname.startsWith("/electronic-vse-journal")) {
      return { outcome: "route", path: `/labs/${labId}/arrivals/${partyId}/examination/new` };
    }
    // Свёрточные страницы без собственного identity-параметра не угадывают партию.
    return notSpecified();
  }

  const examinationId = params.get("examination_id");
  if (isRealUuid(examinationId)) {
    if (labId === null || !isRealUuid(labId)) return notSpecified();
    if (pathname.startsWith("/journal") || pathname.startsWith("/vse-view")) {
      return { outcome: "route", path: `/labs/${labId}/examinations/${examinationId}` };
    }
    return notSpecified();
  }

  const reportId = params.get("report_id");
  if (isRealUuid(reportId)) {
    if (labId === null || !isRealUuid(labId)) return notSpecified();
    if (pathname.startsWith("/admin-reports")) {
      return { outcome: "route", path: `/labs/${labId}/reports/${reportId}` };
    }
    if (pathname.startsWith("/sample-accounting")) {
      return { outcome: "route", path: `/labs/${labId}/reports/samples` };
    }
    return notSpecified();
  }

  const userId = params.get("user_id");
  if (isRealUuid(userId)) {
    if (pathname.startsWith("/admin-users")) {
      return { outcome: "route", path: `/users/${userId}/edit` };
    }
    return notSpecified();
  }

  return notSpecified();
}

function notSpecified(): LegacyOutcome {
  return { outcome: "not-specified", message: LEGACY_NOT_SPECIFIED };
}
