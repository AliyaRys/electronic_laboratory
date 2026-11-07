/**
 * ConclusionPreview (D02, FT-DOC-05): the user-facing preview of the SAME
 * view-model the backend renders into the PDF. The client never invents a
 * requisite: every row comes from ``fields``, missing data stays an empty
 * place, and the «Предварительная форма» warning is shown honestly while
 * ``official`` is false.
 */
import { BASIS_LABELS, previewRows, type ConclusionView } from "./api";

export interface ConclusionPreviewProps {
  view: ConclusionView;
}

export function ConclusionPreview({ view }: ConclusionPreviewProps): React.ReactElement {
  return (
    <section className="vse-conclusion" data-basis={view.basis_kind}>
      <h2 className="vse-conclusion-title">Ветеринарное заключение</h2>
      <p className="vse-conclusion-subtitle">{BASIS_LABELS[view.basis_kind]}</p>
      {view.official ? null : (
        <p className="vse-conclusion-warning" role="status">
          {view.warnings.length > 0 ? view.warnings.join(" · ") : "Предварительная форма"}
        </p>
      )}
      <table className="vse-conclusion-table">
        <caption className="vse-visually-hidden">Реквизиты заключения</caption>
        <tbody>
          {previewRows(view).map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.value === "" ? "\u00A0" : row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vse-conclusion-note">
        Форма {view.form_id}, версия {view.form_version}. Печатается с текущего состояния партии.
      </p>
    </section>
  );
}
