/**
 * ReconciliationFeedback (A02): the save feedback of the composed screen —
 * the field-level error banner and the server problem statuses (network
 * error with retry, revision/state conflict with the safe refresh, server
 * validation). The same component renders the real save result on the page
 * and the storybook error states.
 */
import "./reconciliation.css";
import { StatusView } from "../../shared/ui/StatusView";
import { configurationMissingText } from "./api";
import type { Problem } from "../../shared/api/problem";

export interface ReconciliationFeedbackProps {
  problem: Problem | null;
  /** Client-side form error (e.g. invalid decimals). */
  formError?: string;
  /** The decision field error, when the server points at CHK-F34. */
  decisionError?: string;
  onRefresh: () => void;
  onRetry: () => void;
}

export function ReconciliationFeedback({
  problem,
  formError = "",
  decisionError = "",
  onRefresh,
  onRetry,
}: ReconciliationFeedbackProps): React.ReactElement | null {
  if (formError !== "") {
    return <StatusView state="forbidden" title={formError} />;
  }
  if (problem === null) {
    return null;
  }
  if (problem.code !== "VALIDATION_ERROR") {
    if (problem.code === "CONFIGURATION_MISSING") {
      // ТЗ DR11 §7: the missing service/rule is named — never an empty
      // invoice block and never a silent zero.
      return (
        <StatusView
          state="no-scope"
          title="Стоимость услуг не рассчитана."
          detail={configurationMissingText(problem)}
          trace={problem.trace_id !== "" ? `${problem.code}: ${problem.detail}` : undefined}
        />
      );
    }
    const conflict = problem.code === "REVISION_CONFLICT" || problem.code === "STATE_CONFLICT";
    return (
      <StatusView
        state={conflict ? "not-found" : "network-error"}
        // ТЗ DR13: a revision conflict on an OPEN form means the SHOWN state
        // was stale — the actual state is re-read automatically and the
        // wording says what really happened, not «другой пользователь».
        title={
          problem.code === "REVISION_CONFLICT"
            ? "Данные обновлены, сверка перезагружена."
            : conflict
              ? "Сверка подтверждена внешним результатом и не меняется обычным сохранением."
              : "Не удалось сохранить сверку."
        }
        detail={problem.detail}
        trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
        onRetry={conflict ? onRefresh : onRetry}
      />
    );
  }
  if (decisionError === "") {
    return (
      <StatusView
        state="forbidden"
        title="Сервер вернул ошибки проверки."
        detail={problem.detail}
        trace={problem.trace_id !== "" ? `trace_id: ${problem.trace_id}` : undefined}
      />
    );
  }
  return null;
}
