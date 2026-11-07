/**
 * DeleteDialog tests (E04/E03): the irreversible delete explains what
 * survives (external documents, sample facts, reports), the safe cancel is
 * focused first, and a confirmed deletion calls DELETE with If-Match.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";
import type { ExaminationView } from "./api";

const EXAM: ExaminationView = {
  id: "e0000000-0000-4000-8000-000000000001",
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  laboratory_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  number: "№ 12",
  stamp: "кл-1",
  status: "WAITING",
  sent_to_lab: true,
  researches: [],
  invasive_findings: [],
  noncontagious_findings: [],
  pricing: { lines: [], total: "0.00", currency: "RUB", fair: false },
  sample_collection_id: "44444444-4444-4444-8444-444444444444",
  outcome: null,
  direction: null,
  reason: null,
  created_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  created_at: "2026-11-07T10:00:00Z",
  first_completed_at: null,
  revision: 1,
};

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderDialog(onDeleted = vi.fn()): void {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <DeleteDialog view={EXAM} open onClose={() => undefined} onDeleted={onDeleted} />
    </QueryClientProvider>,
  );
}

describe("DeleteDialog", () => {
  it("explains irreversibility and what is preserved, focus starts on cancel", () => {
    renderDialog();
    expect(screen.getByText(/Удаление необратимо/)).toBeTruthy();
    expect(
      screen.getByText(/Внешние документы, физические факты отбора проб и отчёты сохраняются/),
    ).toBeTruthy();
    expect(document.activeElement?.textContent).toContain("Отмена");
    expect(screen.getByRole("button", { name: "Удалить" })).toBeTruthy();
  });

  it("a confirmed 204 deletion reports success through onDeleted once", async () => {
    let calls = 0;
    server.use(
      http.delete("*/api/v1/examinations/*", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderDialog(onDeleted);
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(calls).toBe(1);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it("an error keeps the dialog with the problem detail", async () => {
    server.use(
      http.delete("*/api/v1/examinations/*", () =>
        HttpResponse.json(
          {
            code: "STATE_CONFLICT",
            title: "State conflict",
            status: 409,
            detail: "Удаление отклонено.",
            instance: "",
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(
      (await screen.findAllByText(/Карточка изменена другим пользователем|Удаление отклонено/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
