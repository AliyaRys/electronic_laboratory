/**
 * R03 component stories: significant states of the reporting pieces — the
 * saved matrix (ordinary, long data, narrow), the parameters with the stale
 * warning, and the codes with validation errors. The preview payload here is
 * a frozen fixture, exactly what the screen shows for a saved snapshot.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ReportMatrix } from "./ReportMatrix";
import { ReportParameters } from "./ReportParameters";
import { ReportCodes } from "./ReportCodes";
import "./reports.css";

const meta: Meta = {
  title: "R03/Отчёты",
};
export default meta;

const payload = {
  version: 1,
  classification_version: "2026-v1",
  columns: [
    "CATTLE",
    "PIG",
    "SHEEP_GOAT",
    "RABBIT_NUTRIA",
    "CHICKEN",
    "OTHER_BIRDS",
    "FISH",
    "OTHER_ANIMALS",
  ],
  matrix: [
    ["12", "34", "2", "0", "5", "7", "0", "1"],
    ["8", "20", "1", "0", "3", "4", "0", "0"],
    ["1", "6", "0", "0", "0", "0", "0", "0"],
    ["0", "9", "1", "0", "0", "0", "0", "0"],
    ["2", "4", "0", "0", "0", "1", "0", "0"],
    ["3", "11", "0", "0", "1", "2", "0", "0"],
    ["0", "2", "0", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0.3", "0.25", "0.05", "0", "0", "0", "0", "0"],
    ["0", "0", "0", "0", "0", "0", "0", "0"],
  ],
  source_count: 34,
  official: false,
};

const longPayload = {
  ...payload,
  columns: ["OTHER_ANIMALS"],
  matrix: [
    ["0.1234567890123456789"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0"],
    ["0.000000001"],
    ["0"],
    ["0"],
  ],
};

export const МатрицаСохранённогоОтчёта: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload, sourceCount: 34, official: false, caption: "Матрица сохранённого отчёта" },
};

export const МатрицаСДлиннымиДанными: StoryObj<typeof ReportMatrix> = {
  render: (args) => <ReportMatrix {...args} />,
  args: { payload: longPayload, sourceCount: 3, official: false, caption: "Матрица сохранённого отчёта" },
};

export const МатрицаNarrowView: StoryObj<typeof ReportMatrix> = {
  render: (args) => (
    <div style={{ width: 390 }}>
      <ReportMatrix {...args} />
    </div>
  ),
  args: { payload, sourceCount: 34, official: false, caption: "Матрица сохранённого отчёта" },
};

export const ПараметрыСПредупреждением: StoryObj<typeof ReportParameters> = {
  render: (args) => <ReportParameters {...args} />,
  args: {
    year: 2026,
    half: 1,
    busy: false,
    disabled: false,
    stale: true,
    onYear: () => undefined,
    onHalf: () => undefined,
    onPreview: () => undefined,
  },
};

export const КодыСОшибками: StoryObj<typeof ReportCodes> = {
  render: (args) => <ReportCodes {...args} />,
  args: {
    values: { okud: "001", okpo: "", okved: "", oktmo: "", okogu: "", okopf: "", okfs: "" },
    errors: {
      okpo: "Код обязателен и не может быть пустым.",
      okved: "Код обязателен и не может быть пустым.",
    },
    disabled: false,
  },
};
