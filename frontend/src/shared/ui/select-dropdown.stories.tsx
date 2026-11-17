/**
 * ТЗ DR42 §6.1: the one styled select — open, disabled and selected states.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SelectDropdown } from "./SelectDropdown";

const meta: Meta<typeof SelectDropdown> = {
  title: "UI/SelectDropdown",
  component: SelectDropdown,
};

export default meta;
type Story = StoryObj<typeof SelectDropdown>;

const RESULT_OPTIONS = [
  { value: "", label: "Выберите результат" },
  { value: "FIT", label: "Пригодно" },
  { value: "UNFIT", label: "Непригодно" },
];

const LONG_OPTIONS = [
  { value: "", label: "Выберите направление" },
  { value: "SALE", label: "В реализацию без ограничений" },
  { value: "DISPOSAL", label: "На утилизацию" },
  { value: "DESTRUCTION", label: "На уничтожение" },
];

function OpenStory(): React.ReactElement {
  const [value, setValue] = useState("FIT");
  return (
    <div style={{ minHeight: 320 }}>
      <SelectDropdown
        label="Результат ВСЭ"
        value={value}
        options={RESULT_OPTIONS}
        placeholder="Выберите результат"
        onChange={setValue}
      />
      <p style={{ marginTop: 200, color: "#5a5a5a" }}>Раскрывающийся список перекрывает этот текст.</p>
    </div>
  );
}

export const Placeholder: Story = {
  render: () => <SelectDropdown label="Результат ВСЭ" value="" options={RESULT_OPTIONS} placeholder="Выберите результат" onChange={() => {}} />,
};

export const Selected: Story = {
  render: () => <SelectDropdown label="Результат ВСЭ" value="UNFIT" options={RESULT_OPTIONS} placeholder="Выберите результат" onChange={() => {}} />,
};

export const Disabled: Story = {
  render: () => <SelectDropdown label="Результат ВСЭ" value="" options={RESULT_OPTIONS} placeholder="Выберите результат" disabled onChange={() => {}} />,
};

export const LongNames: Story = {
  render: () => <SelectDropdown label="Направление по результатам ВСЭ" value="" options={LONG_OPTIONS} placeholder="Выберите направление" onChange={() => {}} />,
};

export const OpenWithOverlay: Story = {
  render: () => <OpenStory />,
};
