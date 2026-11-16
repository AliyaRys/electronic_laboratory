/**
 * DR33 (ТЗ §12.1): contract tests for the capability label registry. Every
 * action of the actual PERMISSION_MATRIX (backend/src/modules/identity/
 * policies.py) must have a non-empty Russian label that is not the raw code;
 * unknown codes get the Russian fallback while keeping the code for
 * diagnostics only.
 */
import { describe, expect, it, vi } from "vitest";
import { CAPABILITY_LABELS, capabilityLabel, capabilityTooltip, isKnownCapability } from "./capabilityLabels";

/**
 * Mirror of PERMISSION_MATRIX actions (policies.py, permissions.md). A new
 * backend action without a label fails the first test consciously (ТЗ §7).
 */
const MATRIX_ACTIONS: readonly string[] = [
  "profile:read",
  "password:change",
  "context:list",
  "operation:read",
  "arrivals:list",
  "arrivals:read",
  "arrivals:search",
  "arrivals:count",
  "arrivals:hide",
  "reconciliation:save",
  "vetis:sync",
  "receipt:submit",
  "receipt:reconcile",
  "examination:list",
  "examination:read",
  "examination:search",
  "examination:count",
  "examination:create-wait",
  "examination:create-complete",
  "examination:update",
  "examination:complete-waiting",
  "examination:delete",
  "conclusion:preview",
  "conclusion:pdf",
  "conclusion:print",
  "sample:read",
  "sample:collect",
  "sample:reuse",
  "sample:edit",
  "sample:dispose",
  "catalog:read",
  "catalog:create",
  "catalog:update",
  "catalog:delete",
  "catalog:bulk-price",
  "catalog:retry",
  "report:operational",
  "report:5vet-list",
  "report:5vet-read",
  "report:5vet-export",
  "report:5vet-preview",
  "report:5vet-save",
  "report:5vet-delete",
  "users:list",
  "users:read",
  "users:history",
  "users:create",
  "users:update",
  "users:block",
  "users:unblock",
  "users:reset-password",
  "users:delete",
];

describe("capabilityLabels registry", () => {
  it("gives every PERMISSION_MATRIX action a non-empty Russian label", () => {
    for (const action of MATRIX_ACTIONS) {
      expect(CAPABILITY_LABELS[action], `missing label for ${action}`).toBeTruthy();
      expect(capabilityLabel(action).length).toBeGreaterThan(0);
    }
  });

  it("never returns a label equal to the technical code", () => {
    for (const action of MATRIX_ACTIONS) {
      expect(capabilityLabel(action)).not.toBe(action);
    }
  });

  it("keeps raw ':' and kebab-case codes out of the visible labels", () => {
    for (const label of Object.values(CAPABILITY_LABELS)) {
      expect(label).not.toMatch(/:/);
      expect(label).not.toMatch(/[a-z]+-[a-z]+/);
    }
  });

  it("falls back to Russian for an unknown code and keeps it only for diagnostics", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(capabilityLabel("future:right")).toBe("Неизвестное право доступа");
    expect(isKnownCapability("future:right")).toBe(false);
    expect(capabilityTooltip("future:right")).toBe("Неизвестное право доступа: future:right");
    expect(capabilityTooltip("arrivals:read")).toBe("Просмотр поступления");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("has no accidental duplicate Russian labels", () => {
    const labels = Object.values(CAPABILITY_LABELS);
    const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);
    // Conscious review checkpoint: the list must stay empty.
    expect(duplicates).toEqual([]);
  });
});
