/**
 * React wrapper over the legacy SVG registry (UI-02). The SVG source stays
 * single: this component only renders ``legacy-icons.ts`` definitions, it never
 * draws a new path.
 */
import { createElement } from "react";
import "./Icon.css";
import {
  ICON_DEFINITIONS,
  type IconName,
  type IconPart,
  type LibraryIconData,
} from "./legacy-icons";

export { ICON_NAMES, CHECK_SECTION_KEYS, getCheckSection } from "./legacy-icons";
export type { IconName } from "./legacy-icons";

export interface IconProps {
  name: IconName;
  /** Accessible name; without it the icon stays decorative (aria-hidden). */
  label?: string;
  className?: string;
}

export function Icon({ name, label, className }: IconProps): React.ReactElement {
  const definition = ICON_DEFINITIONS[name];
  if (!definition) {
    throw new TypeError(`Неизвестная иконка: ${name}`);
  }
  // ТЗ DR50: generated library icons carry their own viewBox and solid fill;
  // every hand-written outline icon keeps the legacy 0 0 24 24 behaviour.
  const isLibrary = "parts" in definition;
  const library = definition as LibraryIconData;
  const viewBox = isLibrary ? `0 0 ${library.width} ${library.height}` : "0 0 24 24";
  const parts: IconPart[] = isLibrary
    ? library.parts.map((part): IconPart => ["path", { ...part }])
    : [...(definition as readonly IconPart[])];
  const accessible = label !== undefined && label !== "";
  return createElement(
    "svg",
    {
      viewBox,
      "data-vse-icon": name,
      ...(isLibrary && library.solid ? { "data-vse-solid": "true" } : {}),
      className: className === undefined ? "app-icon" : `app-icon ${className}`,
      role: accessible ? "img" : undefined,
      "aria-label": accessible ? label : undefined,
      "aria-hidden": accessible ? undefined : "true",
      focusable: "false",
    },
    parts.map(([tag, attributes], index) => {
      const solidAttributes =
        isLibrary && library.solid ? { fill: "currentColor", stroke: "none" } : undefined;
      return createElement(tag, {
        key: index,
        ...attributes,
        ...solidAttributes,
      });
    }),
  );
}
