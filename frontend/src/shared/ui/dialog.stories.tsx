import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

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
