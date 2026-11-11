import type { Meta, StoryObj } from "@storybook/react";
import { PriceCard, NormRow, QualitativeBlock, SaveSummary, CatalogContextSelector } from "./editor-parts";
import { INDICATORS } from "../examinations/indicators";

const longIndicator = INDICATORS[10];

const meta: Meta = {
  title: "C02/EditorParts",
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj;

export const PriceCardFilled: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <PriceCard name={INDICATORS[0].name} mandatory value="35,00" onChange={() => undefined} />
    </div>
  ),
};

export const PriceCardZero: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <PriceCard name={INDICATORS[0].name} value="0.00" onChange={() => undefined} />
    </div>
  ),
};

export const PriceCardUnset: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <PriceCard name={INDICATORS[0].name} value="" unset onChange={() => undefined} />
    </div>
  ),
};

export const PriceCardError: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <PriceCard
        name={INDICATORS[0].name}
        value="12,345"
        error="Цена — конечное число с точкой или запятой, не более 2 знаков, не отрицательная."
        onChange={() => undefined}
      />
    </div>
  ),
};

export const PriceCardBusyAndReadonly: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <PriceCard name={INDICATORS[0].name} value="35.00" busy onChange={() => undefined} />
      <PriceCard name={INDICATORS[0].name} value="35.00" readOnly onChange={() => undefined} />
    </div>
  ),
};

export const PriceCardLongName: Story = {
  render: () => (
    <div style={{ maxWidth: 560 }}>
      <PriceCard
        name={`Длинное название исследования: ${longIndicator.name} с уточнением`}
        value="35.00"
        onChange={() => undefined}
      />
    </div>
  ),
};

export const NormRowBothBounds: Story = {
  render: () => (
    <div style={{ maxWidth: 900 }}>
      <NormRow
        name="Температура в толще мышц"
        meta="Температура сырья при поступлении"
        lower="0"
        upper="4"
        unit="°C"
        onLowerChange={() => undefined}
        onUpperChange={() => undefined}
        details={<p>Версия записи: 1 · источник: Методика измерений</p>}
      />
    </div>
  ),
};

export const NormRowOneBoundAndOrderError: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <NormRow
        name="Мощность дозы от партии"
        lower="0"
        upper=""
        unit="мкЗв/ч"
        onLowerChange={() => undefined}
        onUpperChange={() => undefined}
      />
      <NormRow
        name="Микроскопия"
        lower="50"
        upper="10"
        unit="ед."
        error="Нижняя граница должна быть не больше верхней."
        onLowerChange={() => undefined}
        onUpperChange={() => undefined}
      />
    </div>
  ),
};

export const NormRowLongUnit: Story = {
  render: () => (
    <div style={{ maxWidth: 900 }}>
      <NormRow
        name="Показатель"
        lower="1"
        upper="2"
        unit="тыс. мЕд/мл"
        onLowerChange={() => undefined}
        onUpperChange={() => undefined}
      />
    </div>
  ),
};

const COOKING = INDICATORS.find((indicator) => indicator.code === "VSE-F26") as (typeof INDICATORS)[number];

export const QualitativeBlockNormal: Story = {
  render: () => (
    <div style={{ maxWidth: 900 }}>
      <QualitativeBlock
        title={COOKING.name}
        description="Укажите варианты результата и отметьте, считается ли вариант нормой."
        rows={(COOKING.options ?? []).slice(0, 3).map((option, index) => ({
          key: option.value,
          value: option.label,
          norm: index === 0,
        }))}
      />
    </div>
  ),
};

export const QualitativeBlockAddRemoveError: Story = {
  render: () => (
    <div style={{ maxWidth: 900 }}>
      <QualitativeBlock
        title={COOKING.name}
        rows={[
          { key: "a", value: "Бульон прозрачный, аромат специфический", norm: true },
          {
            key: "b",
            value: "Бульон мутный",
            norm: false,
            onNormChange: () => undefined,
            onRemove: () => undefined,
          },
        ]}
        onAdd={() => undefined}
        error="Хотя бы один вариант должен быть отмечен как «Норма»."
      />
    </div>
  ),
};

export const ContextSelectorMany: Story = {
  render: () => (
    <CatalogContextSelector
      laboratories={[
        { id: "1", name: "Лаборатория №1 г. Казань" },
        { id: "2", name: "Лаборатория №2 с. Азнакаево" },
      ]}
      value="1"
      onChange={() => undefined}
    />
  ),
};

export const ContextSelectorSingle: Story = {
  render: () => (
    <CatalogContextSelector
      laboratories={[{ id: "1", name: "Лаборатория №1 г. Казань" }]}
      value=""
      onChange={() => undefined}
    />
  ),
};

export const ContextSelectorDisabled: Story = {
  render: () => (
    <CatalogContextSelector
      laboratories={[{ id: "1", name: "Лаборатория №1 г. Казань" }]}
      value="1"
      disabled
      onChange={() => undefined}
    />
  ),
};

export const SaveSummarySuccess: Story = {
  render: () => <SaveSummary state="success" text="Справочник сохранён." />,
};

export const SaveSummaryPartial: Story = {
  render: () => (
    <SaveSummary
      state="partial"
      text="Сохранено: 1. Не удалось: 1. Повторите сохранение для неуспешных карточек."
      details={["Трихинеллоскопия: Запись была изменена другим пользователем. Обновите данные и повторите."]}
    />
  ),
};

export const SaveSummaryConflict: Story = {
  render: () => (
    <SaveSummary
      state="error"
      text="Не удалось сохранить справочник."
      details={["Сеть недоступна. Проверьте соединение и повторите."]}
    />
  ),
};
