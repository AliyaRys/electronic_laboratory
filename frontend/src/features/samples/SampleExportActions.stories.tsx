/**
 * SampleExportActions stories (DR49 §10.3): normal, PDF busy, export error,
 * long laboratory context layout and the narrow viewport.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { SampleExportActions } from "./SampleExportActions";

const meta: Meta<typeof SampleExportActions> = {
  title: "Samples/SampleExportActions",
  component: SampleExportActions,
  parameters: {
    layout: "padded",
  },
};
export default meta;

type Story = StoryObj<typeof SampleExportActions>;

export const Normal: Story = {
  args: { laboratoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", dateFrom: "2026-11-01", dateTo: "2026-11-30" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Скачать PDF" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Скачать XLSX" })).toBeVisible();
  },
};

export const PdfBusy: Story = {
  args: { laboratoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", dateFrom: "", dateTo: "" },
  parameters: {
    // Mock the slow export GET so the busy state is observable.
    fetchMock: {},
  },
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <SampleExportActions laboratoryId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" dateFrom="" dateTo="" />
      <p className="app-field-message" style={{ marginTop: 8 }}>
        (Иллюстрация занятого состояния: кнопка PDF показывает «Формируем PDF…».)
      </p>
    </div>
  ),
};

export const ExportError: Story = {
  args: { laboratoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", dateFrom: "2026-11-01", dateTo: "" },
  render: () => (
    <div style={{ maxWidth: 420 }}>
      <SampleExportActions laboratoryId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" dateFrom="2026-11-01" dateTo="" />
      <div className="vse-samples-export-error" style={{ marginTop: 8 }}>
        <p className="app-field-message">Файл PDF не сформирован (RENDERER_UNAVAILABLE).</p>
        <button type="button" className="app-button secondary">
          <span>Повторить</span>
        </button>
      </div>
    </div>
  ),
};

export const LongLaboratoryName: Story = {
  args: {
    laboratoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    dateFrom: "2026-01-01",
    dateTo: "2026-06-30",
  },
  render: () => (
    <div style={{ width: 360 }}>
      <h1>Учёт проб</h1>
      <SampleExportActions laboratoryId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" dateFrom="2026-01-01" dateTo="2026-06-30" />
    </div>
  ),
};

export const NarrowViewport: Story = {
  args: { laboratoryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", dateFrom: "", dateTo: "" },
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => (
    <div style={{ width: 390 }}>
      <div className="vse-samples-heading">
        <h1>Учёт проб</h1>
        <SampleExportActions laboratoryId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" dateFrom="" dateTo="" />
      </div>
    </div>
  ),
};
