/**
 * Icon adapter test (UI-02): only the existing registry is exposed — no new
 * SVG may appear, and check-section keys come strictly from the canonical map.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CHECK_SECTION_KEYS, ICON_NAMES, Icon } from "./Icon";
import { getCheckSection } from "./legacy-icons";

describe("Icon", () => {
  it("renders registry icons decoratively by default", () => {
    const { container } = render(<Icon name="check-product" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg[data-vse-icon='check-product']")).not.toBeNull();
  });

  it("labeled icons become images with an accessible name", () => {
    render(<Icon name="admin-users" label="Управление пользователями" />);
    expect(screen.getByRole("img", { name: "Управление пользователями" })).toBeInTheDocument();
  });

  it("exposes exactly the registry names", () => {
    for (const name of [
      "check-document",
      "comparison-match",
      "arrivals",
      "journal-classic",
      "milk",
      "caret",
      "admin-delete",
      "directory-paid-services",
      "key",
      "camera",
    ] as const) {
      expect(ICON_NAMES).toContain(name);
    }
    // No invented names.
    expect(ICON_NAMES).not.toContain("check-milk-custom");
  });

  it("keeps check-section keys strictly from the icons README", () => {
    expect([...CHECK_SECTION_KEYS].sort()).toEqual(
      [
        "document",
        "participants",
        "priorVse",
        "product",
        "results",
        "transport",
        "invoice",
        "documents",
      ].sort(),
    );
    expect(getCheckSection("document")).toEqual({
      key: "document",
      icon: "check-document",
      label: "Документ",
    });
    expect(getCheckSection("milk" as never)).toBeUndefined();
  });
});
