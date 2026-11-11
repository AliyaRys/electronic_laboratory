import type { Meta, StoryObj } from "@storybook/react";
import { ReceiptConfirmationDialog } from "./ReceiptConfirmationDialog";
import type { IncomingView, ReceiptPreview, ReconciliationView } from "./api";

const party = {
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  external: { fields: { documentUuid: "e13bda81-7cf6-4b2b-b1aa-3c99e25adaac" } },
} as unknown as IncomingView;

const reconciliation = {
  decision: "PARTIAL",
  accepted: { quantity: "3", mass_kg: "100", unit_id: "u" },
  returned: { quantity: "1", mass_kg: "20", unit_id: "u" },
} as ReconciliationView;

const preview = {
  fingerprint: "9b7d6ef37e771f0a6238814e33c9e5eb99db407c985c630f1c018451adc8252b",
} as ReceiptPreview;

const meta: Meta<typeof ReceiptConfirmationDialog> = {
  title: "W03/Подтверждение гашения",
  component: ReceiptConfirmationDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    party,
    reconciliation,
    preview,
    busy: false,
    onConfirm: () => undefined,
  },
};

export default meta;

export const ПроверкаПередОтправкой: StoryObj<typeof ReceiptConfirmationDialog> = {};

export const Отправка: StoryObj<typeof ReceiptConfirmationDialog> = {
  args: { busy: true },
};

export const ОшибкаБезПотериPreview: StoryObj<typeof ReceiptConfirmationDialog> = {
  args: { error: "Сверка изменилась. Закройте окно и подготовьте гашение заново." },
};
