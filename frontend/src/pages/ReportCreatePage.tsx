/**
 * ReportCreatePage (R03, API-08, DR51 §5/§6): parameters → preview → save.
 *
 * The flow keeps the R02 contract strictly (DR48 §3.4):
 * - the two date inputs and the primary «Применить» apply the range AND
 *   request the preview in one action;
 * - the preview is the server's signed calculation shown verbatim (the
 *   client never recomputes);
 * - changing an input marks the shown preview stale and blocks the save
 *   until a new «Применить»; a failed command never clears the inputs;
 * - the save sends exactly the signed preview (DR51 §6.2: the seven
 *   organizational codes are cancelled and never requested) and navigates
 *   to the saved report.
 */
import "./../features/reports/reports.css";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RequireSession } from "./RequireSession";
import { useMe } from "../shared/api/me";
import { useCommand } from "../shared/api/command";
import { StatusView } from "../shared/ui/StatusView";
import { Button } from "../shared/ui/Button";
import { ReportParameters, type AppliedDateRange } from "../features/reports/ReportParameters";
import { ReportHeader } from "../features/reports/ReportHeader";
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
import { reportAccess } from "../features/reports/reportCapabilities";

export function ReportCreatePage(): React.ReactElement {
  return (
    <RequireSession>
      <ReportCreateContent />
    </RequireSession>
  );
}

function ReportCreateContent(): React.ReactElement {
  const { labId } = useParams<{ labId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();

  const [applied, setApplied] = useState<AppliedDateRange>({ from: "", to: "" });
  const [preview, setPreview] = useState<SignedPreview | null>(null);
  const [stale, setStale] = useState(false);
  const [rangeError, setRangeError] = useState("");

  const previewCommand = useCommand<SignedPreview>();
  const saveCommand = useCommand<unknown>();

  useDirtyGuard(false, "Создание отчёта");

  const previewPayload: Record<string, unknown> | null = (preview?.payload ?? null) as Record<
    string,
    unknown
  > | null;

  /** One «Применить»: apply the range and request the preview together. */
  const applyAndPreview = (range: AppliedDateRange): void => {
    setRangeError("");
    setStale(false);
    void previewCommand.submit(
      async (ctx) => {
        const params: ReportPreviewParams = {
          report_type: "5VET_SECTION_III",
          laboratory_id: labId ?? "",
          date_from: range.from,
          date_to: range.to,
        };
        const result = await previewReport(params)(ctx);
        if (result.response.ok && result.data !== undefined) {
          setPreview(result.data);
          setApplied(range);
        }
        return result;
      },
      { queryKey: reportsKey(labId ?? "", 1) },
    );
  };

  const previewProblem = previewCommand.status === "error" ? previewCommand.error : null;
  const saveProblem = saveCommand.status === "error" ? saveCommand.error : null;

  const runSave = (): void => {
    if (preview === null || stale) return;
    void saveCommand.submit(
      async (ctx) => {
        const result = await saveReport(preview)(ctx);
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

  if (me.user !== null && !reportAccess(me.user?.capabilities).create5vet) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание отчёта</h1>
        <StatusView
          state="forbidden"
          title="Создание отчёта недоступно: у вас нет полномочий формирования и сохранения 5-вет."
        />
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

  const laboratoryName =
    previewPayload !== null && typeof previewPayload["laboratory"] === "object" && previewPayload["laboratory"] !== null
      ? String((previewPayload["laboratory"] as Record<string, unknown>)["name"] ?? "")
      : "";

  return (
    <div className="vse-app vse-page">
      <h1>Создание отчёта 5-вет (раздел III)</h1>

      <ReportParameters
        applied={applied}
        busy={previewCommand.status === "pending"}
        disabled={saveCommand.status === "pending"}
        stale={stale}
        error={rangeError}
        onChange={(range) => {
          setApplied(range);
          if (preview !== null) setStale(true);
        }}
        onApply={applyAndPreview}
      />

      {previewCommand.status === "pending" ? (
        <StatusView state="loading" title="Формируем предварительный просмотр…" />
      ) : null}
      {previewProblem !== null ? (
        <StatusView
          state={previewProblem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          title={
            previewProblem.code === "REPORT_NO_DATA"
              ? "За выбранный период нет завершённых источников отчёта."
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
          <ReportHeader
            createdLabel="Дата формирования"
            createdAt={String(previewPayload["generated_at"] ?? "")}
            dateFrom={String(previewPayload["date_from"] ?? "")}
            dateTo={String(previewPayload["date_to"] ?? "")}
            laboratory={laboratoryName}
          />
          <ReportMatrix payload={previewPayload} official={false} />
          <div className="vse-report-actions">
            <Button
              type="button"
              variant="primary"
              disabled={saveCommand.status === "pending" || stale}
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
                    : "Не удалось сохранить отчёт. Введённые параметры сохранены."
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
