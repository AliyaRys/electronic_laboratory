/**
 * Read-only information field (UI-02, components/app/InfoField contract):
 * a labelled value that is never editable, long values wrap.
 */
import "./ui.css";

export interface InfoFieldProps {
  label: string;
  value: string;
  wide?: boolean;
}

export function InfoField({ label, value, wide = false }: InfoFieldProps): React.ReactElement {
  return (
    <div className="app-info-field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <p className="app-info-label">{label}</p>
      <p className="app-info-value" style={{ overflowWrap: "anywhere" }}>
        {value === "" ? "—" : value}
      </p>
    </div>
  );
}
