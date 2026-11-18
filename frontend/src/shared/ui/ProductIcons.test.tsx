/**
 * DR50 §2.3: the three product icons must be byte-faithful Font Awesome Free
 * Solid definitions — width/height/svgPathData compared against the pinned
 * package, a real (not forced 0 0 24 24) viewBox, solid fill via
 * currentColor, and both registries (legacy AppHeader.js and the React
 * adapter) stay equal because both come from one generated source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import { faEgg, faFish, faWheatAwn } from "@fortawesome/free-solid-svg-icons";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import { ICON_DEFINITIONS } from "./legacy-icons";
import { PRODUCT_ICON_DATA } from "./product-icons.generated";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MAPPING = {
  "product-eggs": faEgg,
  "product-fish": faFish,
  "product-plant": faWheatAwn,
} as const;

describe("DR50 product icons", () => {
  it("compares width/height/svgPathData of every key with the pinned package", () => {
    for (const [key, icon] of Object.entries(MAPPING)) {
      const [width, height, , , svgPathData] = icon.icon;
      const paths = Array.isArray(svgPathData) ? svgPathData : [svgPathData];
      const definition = PRODUCT_ICON_DATA[key];
      expect(definition).toBeDefined();
      expect(definition.width).toBe(width);
      expect(definition.height).toBe(height);
      expect(definition.solid).toBe(true);
      expect(definition.parts.map((part) => part.d)).toEqual(paths);
      // The React adapter registry carries the same definitions.
      const registry = ICON_DEFINITIONS[key] as unknown as Record<string, unknown>;
      expect(registry.parts.map((part: { d: string }) => part.d)).toEqual(paths);
    }
  });

  it("does not force viewBox 0 0 24 24 for library icons", () => {
    const { container, unmount } = render(<Icon name="product-eggs" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 384 512");
    unmount();
    const fish = render(<Icon name="product-fish" />);
    expect(fish.container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 576 512");
    fish.unmount();
    const plant = render(<Icon name="product-plant" />);
    expect(plant.container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 576 512");
    plant.unmount();
  });

  it("renders solid icons with fill=currentColor, stroke=none", () => {
    const { container } = render(<Icon name="product-eggs" />);
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute("fill")).toBe("currentColor");
      expect(path.getAttribute("stroke")).toBe("none");
    }
  });

  it("keeps outline icons (meat) unchanged", () => {
    const { container } = render(<Icon name="meat" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    for (const path of container.querySelectorAll("svg path")) {
      expect(path.getAttribute("fill")).toBeNull();
      expect(path.getAttribute("stroke")).toBeNull();
    }
  });

  it("legacy AppHeader.js registry carries the same generated data", () => {
    const source = readFileSync(join(root, "components", "shell", "AppHeader.js"), "utf8");
    for (const [key, icon] of Object.entries(MAPPING)) {
      const [, , , , svgPathData] = icon.icon;
      const paths = Array.isArray(svgPathData) ? svgPathData : [svgPathData];
      for (const d of paths) {
        expect(source).toContain(d);
      }
      // The legacy hand-written Lucide outline paths are gone.
      expect(source).not.toContain(`'${key}': [\n      ['path', { d: 'M12 22c3.5`);
    }
  });

  it("svgPathData as an array of strings renders every part in order", () => {
    // faEgg carries a single string; the contract must also accept arrays.
    const { container } = render(<Icon name="product-fish" />);
    const dAttributes = Array.from(container.querySelectorAll("svg path")).map((path) =>
      path.getAttribute("d"),
    );
    const expected = faFish.icon[4] as string;
    expect(dAttributes).toEqual([expected]);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
