/**
 * Date helpers (SPEC-05, API-01). Day boundaries are computed in
 * Europe/Moscow; identifiers are never converted to numbers here.
 */
import { describe, expect, it } from "vitest";
import { moscowDayRange, formatMoscowDate, formatMoscowDateTime } from "./dates";

describe("moscowDayRange", () => {
  it("builds the half-open day range [from 00:00, to+1day 00:00) Europe/Moscow", () => {
    expect(moscowDayRange("2026-11-01", "2026-11-01")).toEqual({
      from: "2026-11-01T00:00:00+03:00",
      to: "2026-11-02T00:00:00+03:00",
    });
  });

  it("crosses month boundaries", () => {
    expect(moscowDayRange("2026-10-31", "2026-10-31")).toEqual({
      from: "2026-10-31T00:00:00+03:00",
      to: "2026-11-01T00:00:00+03:00",
    });
  });
});

describe("formatting", () => {
  it("formats an instant as a Moscow date", () => {
    expect(formatMoscowDate("2026-11-01T10:30:00Z")).toBe("01.11.2026");
  });

  it("formats an instant as a Moscow date-time", () => {
    expect(formatMoscowDateTime("2026-11-01T10:30:00Z")).toBe("01.11.2026, 13:30");
  });
});
