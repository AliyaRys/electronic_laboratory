/**
 * ReportCreatePage (R03, API-08, SC-080–088): preview → codes → immutable save.
 *
 * The flow keeps the R02 contract strictly:
 * - the preview is the server's signed calculation shown verbatim (the client
 *   never recomputes);
 * - changing any parameter clears the preview AND the codes and shows the
 *   warning — the signed payload no longer matches the inputs;
 * - a failed save (network or 4xx) preserves both the parameters and the
 *   entered codes (nothing is cleared on failure);
 * - the save sends exactly the signed preview + the seven trimmed codes and
 *   navigates to the saved report.
 */
import "./../features/reports/reports.css";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { useCommand } from "../shared/api/command";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import { ReportParameters } from "../features/reports/ReportParameters";
import { ReportCodes, CODE_FIELDS } from "../features/reports/ReportCodes";
import { ReportMatrix } from "../features/reports/ReportMatrix";
import {
  previewReport,
  saveReport,
  reportsKey,
  type ReportPreviewParams,
  type SignedPreview,
} from "../features/reports/api";
import { useDirtyStore } from "../entities/session/context";
import { useDirtyGuard } from "../features/context/SwitchContext";

const CODE_KEYS = CODE_FIELDS.map((field) => field.key);

const EMPTY_CODES: Record<string, string> = {
  okud: "",
  okpo: "",
  okved: "",
  oktmo: "",
  okogu: "",
  okopf: "",
  okfs: "",
};

export function ReportCreatePage(): React.ReactElement {
  return (
    <RequireSession>
      <ReportCreateContent />
    </RequireSession>
  );
}

/** The seven codes are trimmed and must be non-blank (API-08 trim nonblank). */
function validateCodes(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of CODE_KEYS) {
    const trimmed = (values[key] ?? "").trim();
    if (trimmed === "") errors[key] = "Код обязателен и не может быть пустым.";
  }
  return errors;
}

function ReportCreateContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [half, setHalf] = useState<1 | 2>(1);
  const [preview, setPreview] = useState<SignedPreview | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({ ...EMPTY_CODES });
  const [codeErrors, setCodeErrors] = useState<Record<string, string>>({});
  const [paramWarning, setParamWarning] = useState(false);

  const previewCommand = useCommand<SignedPreview>();
  const saveCommand = useCommand<unknown>();

  const dirty = CODE_KEYS.some((key) => (codes[key] ?? "").trim() !== "");
  useDirtyGuard(dirty, "Создание отчёта");

  const previewPayload: Record<string, unknown> | null = (preview?.payload ?? null) as Record<
    string,
    unknown
  > | null;

  const clearPreview = (): void => {
    setPreview(null);
    setCodes({ ...EMPTY_CODES });
    setCodeErrors({});
    setParamWarning(true);
  };

  const changeYear = (next: number): void => {
    setYear(next);
    if (preview !== null) clearPreview();
  };
  const changeHalf = (next: 1 | 2): void => {
    setHalf(next);
    if (preview !== null) clearPreview();
  };

  const runPreview = (): void => {
    setParamWarning(false);
    void previewCommand.submit(
      async (ctx) => {
        const params: ReportPreviewParams = {
          report_type: "5VET_SECTION_III",
          laboratory_id: labId ?? "",
          year,
          half,
        };
        const result = await previewReport(params)(ctx);
        if (result.response.ok && result.data !== undefined) {
          setPreview(result.data);
          setCodeErrors({});
        }
        return result;
      },
      { queryKey: reportsKey(labId ?? "", 1) },
    );
  };

  const previewProblem = previewCommand.status === "error" ? previewCommand.error : null;
  const saveProblem = saveCommand.status === "error" ? saveCommand.error : null;

  const runSave = (): void => {
    if (preview === null) return;
    const errors = validateCodes(codes);
    setCodeErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const trimmed: Record<string, string> = {};
    for (const key of CODE_KEYS) trimmed[key] = (codes[key] ?? "").trim();
    const body = {
      okud: trimmed["okud"] ?? "",
      okpo: trimmed["okpo"] ?? "",
      okved: trimmed["okved"] ?? "",
      oktmo: trimmed["oktmo"] ?? "",
      okogu: trimmed["okogu"] ?? "",
      okopf: trimmed["okopf"] ?? "",
      okfs: trimmed["okfs"] ?? "",
    };
    void saveCommand.submit(
      async (ctx) => {
        const result = await saveReport(preview, body)(ctx);
        if (result.response.ok && result.data !== undefined) {
          const saved = result.data as { id?: string };
          if (typeof saved.id === "string") {
            useDirtyStore.getState().setDirty(false);
            void queryClient.invalidateQueries({ queryKey: reportsKey(labId ?? "", 1) });
            navigate(`/labs/${labId}/reports/${saved.id}`);
          }
        }
        return result;
      },
      { queryKey: reportsKey(labId ?? "", 1) },
    );
  };

  if (me.user !== null && (me.user.role === "VET" || me.user.role === "ADMIN")) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание отчёта</h1>
        <StatusView state="forbidden" title="Создание отчёта доступно только заведующему и аналитику." />
      </div>
    );
  }
  if (labId === undefined) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание отчёта</h1>
        <StatusView state="not-found" title="Лаборатория не указана." />
      </div>
    );
  }

  const sourceCount =
    previewPayload !== null && typeof previewPayload["source_count"] === "number"
      ? (previewPayload["source_count"] as number)
      : 0;

  return (
    <div className="vse-app vse-page">
      <nav className="vse-breadcrumb" aria-label="Навигация">
        <Link to={`/labs/${labId}/reports`}>← Отчёты</Link>
      </nav>
      <h1>Создание отчёта 5-вет (раздел III)</h1>

      <ReportParameters
        year={year}
        half={half}
        busy={previewCommand.status === "pending"}
        disabled={saveCommand.status === "pending"}
        stale={paramWarning}
        onYear={changeYear}
        onHalf={changeHalf}
        onPreview={runPreview}
      />

      {previewCommand.status === "pending" ? (
        <StatusView state="loading" title="Считаем предварительный просмотр…" />
      ) : null}
      {previewProblem !== null ? (
        <StatusView
          state={previewProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={
            previewProblem.code === "REPORT_NO_DATA"
              ? "За выбранное полугодие нет завершённых источников отчёта."
              : previewProblem.code === "REPORT_PERIOD_UNFINISHED"
                ? "Полугодие ещё не завершено — отчёт можно строить только за завершённое полугодие."
                : previewProblem.code === "REPORT_MAPPING_INVALID"
                  ? "Классификация продукции настроена неверно — отчёт не рассчитан."
                  : undefined
          }
          detail={previewProblem.detail}
          trace={previewProblem.trace_id}
          onRetry={() => void previewCommand.retry()}
        />
      ) : null}

      {previewPayload !== null ? (
        <>
          <ReportMatrix
            payload={previewPayload}
            sourceCount={sourceCount}
            official={false}
            caption="Предварительный просмотр матрицы"
          />
          <ReportCodes
            values={codes}
            onChange={(key, value) => setCodes((previous) => ({ ...previous, [key]: value }))}
            errors={codeErrors}
            disabled={saveCommand.status === "pending"}
          />
          <div className="vse-report-actions">
            <Button
              type="button"
              variant="primary"
              disabled={saveCommand.status === "pending"}
              busy={saveCommand.status === "pending"}
              busyLabel="Сохраняем…"
              onClick={runSave}
            >
              Сохранить отчёт
            </Button>
          </div>
          {saveProblem !== null ? (
            <StatusView
              state="network-error"
              title={
                saveProblem.code === "REPORT_PERIOD_EXISTS"
                  ? "Отчёт этого периода уже сохранён."
                  : saveProblem.code === "REPORT_PREVIEW_INVALID"
                    ? "Подписанный просмотр больше не действителен — сформируйте его заново."
                    : "Не удалось сохранить отчёт. Введённые параметры и коды сохранены."
              }
              detail={saveProblem.detail}
              trace={saveProblem.trace_id}
              onRetry={() => void saveCommand.retry()}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
