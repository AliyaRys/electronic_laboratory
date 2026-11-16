import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
// DR32: the receipt-summary story reuses the real `.vse-receipt-*` classes of
// the feature instead of a copied second palette.
import "../../features/arrivals/reconciliation.css";

const meta: Meta<typeof Dialog> = {
  title: "F02/Dialog",
  component: Dialog,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

/** Composed harness: the dialog opens from a trigger like in the app. */
function DialogHarness(props: Partial<React.ComponentProps<typeof Dialog>>): React.ReactElement {
  const [open, setOpen] = useState(props.open === true);
  const triggerLabel = props.title === undefined ? "Открыть диалог" : props.title;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Открыть
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={triggerLabel}
        confirmLabel="Подтвердить"
        cancelLabel="Остаться"
        onConfirm={() => setOpen(false)}
        {...props}
      >
        Диалог подтверждает явное решение — скрытого автосохранения нет.
      </Dialog>
    </>
  );
}

export const Confirm: Story = {
  render: () => <DialogHarness title="Завершить сверку?" confirmLabel="Завершить" />,
};
export const Destructive: Story = {
  render: () => (
    <DialogHarness title="Удалить партию?" confirmLabel="Удалить" cancelLabel="Остаться" danger />
  ),
};
export const WithError: Story = {
  render: () => (
    <DialogHarness
      title="Удалить пользователя?"
      confirmLabel="Удалить"
      danger
      open
      error="Последний администратор лаборатории не может быть удалён."
    />
  ),
};
/** Named for the acceptance test: safe cancel focused first, Escape, focus return. */
export const FocusAndEscape: Story = {
  render: () => (
    <DialogHarness title="Удалить партию?" confirmLabel="Удалить" cancelLabel="Остаться" danger />
  ),
};
export const LongContent: Story = {
  render: () => (
    <DialogHarness open title="Полное удаление партии" confirmLabel="Удалить" cancelLabel="Остаться" danger>
      <div style={{ overflowWrap: "anywhere" }}>
        Партия «Общество с ограниченной ответственностью „Агрофирма Свободный Труд имени двадцатилетия
        Татарской Автономной Советской Социалистической Республики“», эВСД 41-201 от 06.11.2026. После
        удаления запись исчезнет из очереди «Ожидаемые», счётчик уменьшится, а повторная сверка потребует
        нового документа эВСД.
      </div>
    </DialogHarness>
  ),
};

/** DR32 §9.3: while the confirm action is in flight the safe cancel locks. */
export const Busy: Story = {
  render: () => (
    <DialogHarness
      open
      title="Удалить пользователя?"
      confirmLabel="Удалить"
      cancelLabel="Остаться"
      danger
      busy
      onConfirm={() => undefined}
    >
      Отправка выполняется — ожидайте завершения операции.
    </DialogHarness>
  ),
};

/**
 * DR32 §9.3: the receipt summary with a long fingerprint renders on the SAME
 * portal/theme contract (`.app-dialog-layer`); the fingerprint wraps inside
 * the card and never widens the dialog. The classes are the real ones of the
 * receipt summary (features/arrivals/reconciliation.css).
 */
export const ReceiptSummaryLongFingerprint: Story = {
  render: () => (
    <DialogHarness
      open
      title="Подтвердите гашение эВСД"
      confirmLabel="Погасить эВСД"
      cancelLabel="Вернуться к проверке"
      danger
    >
      <dl className="vse-receipt-summary">
        <div>
          <dt>эВСД</dt>
          <dd>RU016:260812-005102 от 12.08.2026 08:12</dd>
        </div>
        <div>
          <dt>Решение</dt>
          <dd>Принять партию полностью</dd>
        </div>
        <div>
          <dt>Отпечаток подготовленного запроса</dt>
          <dd className="vse-receipt-fingerprint">
            9f2c1d4e5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b
          </dd>
        </div>
      </dl>
    </DialogHarness>
  ),
  // The summary classes are the real receipt-summary styles of the feature
  // (scoped `.vse-receipt-*`), so the story shows the actual contract.
  parameters: { layout: "padded" },
};
