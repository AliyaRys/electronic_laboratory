/**
 * Shared acceptance states (UI-03): loading / empty / no matches / not found /
 * forbidden / blocked / network error / unknown / no scope. Status is carried
 * by text + tone, never by color alone; errors expose their technical trace as
 * a collapsed detail for support.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusView } from "./StatusView";

describe("StatusView", () => {
  it("renders every significant state with its default text", () => {
    const cases: Array<[Parameters<typeof StatusView>[0]["state"], RegExp]> = [
      ["loading", /Загрузка/],
      ["empty", /Пока ничего нет/],
      ["no-match", /ичего не найдено/],
      ["not-found", /Запись не указана/],
      ["forbidden", /Нет доступа/],
      ["network-error", /Ошибка соединения/],
      ["no-scope", /Выберите лабораторию/],
      ["unknown", /Состояние .*неизвестно/],
    ];
    for (const [state, text] of cases) {
      const { unmount } = render(<StatusView state={state} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it("loading is announced politely and errors assertively", () => {
    const { container } = render(<StatusView state="loading" />);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
  });

  it("shows the problem detail and a retry action", async () => {
    const retry = vi.fn();
    const user = (await import("@testing-library/user-event")).default.setup();
    render(
      <StatusView
        state="network-error"
        title="Не удалось загрузить журнал"
        detail="503 DEPENDENCY_UNAVAILABLE"
        trace="trace_id: 8f3f…"
        onRetry={retry}
      />,
    );
    expect(screen.getByText("Не удалось загрузить журнал")).toBeInTheDocument();
    // Technical detail stays available for support, collapsed by default.
    expect(screen.getByText("503 DEPENDENCY_UNAVAILABLE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
