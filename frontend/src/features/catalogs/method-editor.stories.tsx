import type { Meta, StoryObj } from "@storybook/react";
import { INDICATORS } from "../examinations/indicators";
import type { CatalogIndicatorView } from "./api";
import { MethodEditor } from "./MethodEditor";

/** The context indicator definitions of the DR28 §7 read model, mirrored from
 * the shared INDICATORS registry (ONE registry, ТЗ-DR28 §6.3). */
const contextIndicators: CatalogIndicatorView[] = INDICATORS.map((item) => ({
  id: item.id,
  code: item.code,
  name: item.name,
  result_schema:
    item.kind === "ENUM"
      ? "ENUM"
      : item.kind === "TEXT"
        ? "TEXT"
        : item.kind === "INTEGER"
          ? "INTEGER_NONNEGATIVE"
          : item.kind === "DOSIMETRY"
            ? "DOSIMETRY_PAIR"
            : item.kind === "BOOLEAN"
              ? "BOOLEAN_MATCH"
              : "DECIMAL",
  unit_id: item.unit ?? null,
  mandatory: item.mandatory,
  conditional: item.code === "VSE-F21",
  options: item.options?.map((option) => option.label) ?? null,
}));

const base = {
  laboratoryId: "7c1e6bb2-0000-4000-8000-000000000001",
  productSpeciesId: "11111111-1111-4111-8111-111111111111",
  productStateId: "22222222-2222-4222-8222-222222222222",
  indicators: contextIndicators,
  onSaved: () => undefined,
  onClose: () => undefined,
};

const meta: Meta<typeof MethodEditor> = {
  title: "C02/MethodEditor",
  component: MethodEditor,
  parameters: { layout: "padded" },
  args: {
    mode: "create",
    laboratoryId: base.laboratoryId,
    productSpeciesId: base.productSpeciesId,
    productStateId: base.productStateId,
    indicators: base.indicators,
    onSaved: () => undefined,
    onClose: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof MethodEditor>;

/** The create dialog: the indicator is picked by Russian name and code; no
 * UUID input exists (ТЗ-DR28 §6.2). */
export const Create: Story = {
  render: () => <MethodEditor mode="create" {...base} />,
};
/** «Настроить» from the row of a missing indicator: one indicator pre-picked
 * with its canonical result type and unit. */
export const PresetIndicator: Story = {
  render: () => (
    <MethodEditor
      mode="create"
      {...base}
      presetIndicatorId={INDICATORS.find((item) => item.code === "VSE-F20")?.id ?? null}
    />
  ),
};
export const Narrow: Story = {
  render: () => (
    <div style={{ width: 390 }}>
      <MethodEditor mode="create" {...base} />
    </div>
  ),
};
