/**
 * ActPreview (A02, CHK-F44): the derived discrepancy-act plate. The rows come
 * from the server (field, source value, actual fact, reason); the client
 * never sets them. RETURN_ALL never promises this act (FT-ARR-08).
 */
import type { ActPreview as ActPreviewData, ReceiptProblemItem } from "./api";

export interface ActPreviewProps {
  act: ActPreviewData | null;
  decision: string | null;
  /** Field-level server validation problems (CHK ids included). */
  problemItems: ReceiptProblemItem[];
}

export function ActPreview({ act, decision, problemItems }: ActPreviewProps): React.ReactElement | null {
  if (problemItems.length > 0) {
    return (
      <div className="vse-act-preview vse-act-preview--error" role="alert">
        <p className="vse-act-title">Сервер вернул ошибки проверки:</p>
        <ul>
          {problemItems.map((item, index) => (
            <li key={`${item.path}-${index}`}>
              {item.field_id !== null && item.field_id !== undefined && item.field_id !== "" ? (
                <strong>{item.field_id}: </strong>
              ) : null}
              {item.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (act === null || act.items === undefined || act.items.length === 0) {
    return null;
  }
  const promised = decision !== "RETURN_ALL";
  return (
    <div className="vse-act-preview" role="status" data-required={promised ? "true" : "false"}>
      <p className="vse-act-title">
        {promised
          ? "Будет сформирован акт несоответствия"
          : "При возврате акт несоответствия этой ветки не формируется"}
      </p>
      <table className="vse-act-table">
        <caption className="vse-visually-hidden">Расхождения, включаемые в акт</caption>
        <thead>
          <tr>
            <th scope="col">Поле</th>
            <th scope="col">Исходное значение</th>
            <th scope="col">Факт</th>
            <th scope="col">Причина</th>
          </tr>
        </thead>
        <tbody>
          {(act.items ?? []).map((item) => (
            <tr key={item.field_id}>
              <th scope="row">{item.field_id}</th>
              <td>{item.source ?? "—"}</td>
              <td>{item.actual ?? "—"}</td>
              <td>{item.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
