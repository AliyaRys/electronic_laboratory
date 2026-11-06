/**
 * React wrapper over the legacy SVG registry (UI-02). The SVG source stays
 * single: this component only renders ``legacy-icons.ts`` definitions, it never
 * draws a new path.
 */
import { createElement } from "react";
import "./Icon.css";
import { ICON_DEFINITIONS, type IconName } from "./legacy-icons";

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
  const accessible = label !== undefined && label !== "";
  return createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      "data-vse-icon": name,
      className: className === undefined ? "app-icon" : `app-icon ${className}`,
      role: accessible ? "img" : undefined,
      "aria-label": accessible ? label : undefined,
      "aria-hidden": accessible ? undefined : "true",
      focusable: "false",
    },
    definition.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes })),
  );
}
