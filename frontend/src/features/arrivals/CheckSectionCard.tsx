/**
 * CheckSectionCard (A02): the white section card of the reconciliation
 * screen — a 34×34 teal icon slot with the canonical registry icon (never a
 * local SVG), the section title and the short description. The heading id is
 * exposed for aria-labelledby wiring.
 */
import "./reconciliation.css";
import { useId } from "react";
import { Icon, getCheckSection, type IconName } from "../../shared/ui/Icon";

export interface CheckSectionCardProps {
  /** Canonical section key from the pinned check-section map. */
  sectionKey: string;
  /** User-facing title (mockup wording). */
  title: string;
  description: string;
  children: React.ReactNode;
  /** Optional right-side content of the section head (e.g. price). */
  aside?: React.ReactNode;
}

export function CheckSectionCard({
  sectionKey,
  title,
  description,
  children,
  aside,
}: CheckSectionCardProps): React.ReactElement {
  const headingId = `vse-rec-section-${useId()}`;
  const section = getCheckSection(sectionKey);
  if (section === undefined) {
    throw new TypeError(`Неизвестный раздел сверки: ${sectionKey}`);
  }
  return (
    <section className="vse-check-section" aria-labelledby={headingId}>
      <div className="vse-check-section-head">
        <div className="vse-check-section-title">
          <span className="vse-check-section-icon" aria-hidden="true">
            <Icon name={section.icon as IconName} />
          </span>
          <div>
            <h2 id={headingId}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
