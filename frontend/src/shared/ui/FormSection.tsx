/**
 * FormSection (DR30): the shared white section card of the examination card
 * screens, ported 1:1 from ``electronic-vse-journal.html`` (§.section /
 * .section-head). One shell for every large section — icon square from the
 * shared registry, h2 and a grey explanation; no page keeps a local copy of
 * this header markup.
 */
import "./ui.css";
import { Icon, type IconName } from "./Icon";

export interface FormSectionProps {
  icon: IconName;
  title: string;
  /** Short grey explanation under the title (mockup: .section-head p). */
  description: string;
  children: React.ReactNode;
}

export function FormSection({ icon, title, description, children }: FormSectionProps): React.ReactElement {
  return (
    <section className="app-section" aria-label={title}>
      <div className="app-section-head">
        <div className="app-section-title">
          <span className="app-section-icon">
            <Icon name={icon} />
          </span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}
