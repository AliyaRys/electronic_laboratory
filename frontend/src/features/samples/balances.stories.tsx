/**
 * S03 balance stories (DR48 §4): the direct dispose action for a disposing
 * role, the read-only analyst view (no action at all) and the states: long
 * product name, empty, loading, narrow viewport.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { Balances } from "./Balances";

const meta: Meta = {
  title: "S03/Учёт проб",
};
export default meta;

const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balances = [
  { product_species_id: SPECIES, mass_kg: "12.6", revision: 3, product_name: "Говядина" },
  {
    product_species_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    mass_kg: "2",
    revision: 1,
    product_name: "Свинина",
  },
];

export const ОстаткиВрача: StoryObj<typeof Balances> = {
  render: (args) => <Balances {...args} />,
  args: {
    balances,
    loading: false,
    emptyMessage: "Положительных остатков нет.",
    canDispose: true,
    onDispose: () => undefined,
  },
};

export const ОстаткиАналитика: StoryObj<typeof Balances> = {
  render: (args) => <Balances {...args} />,
  args: {
    balances,
    loading: false,
    emptyMessage: "Положительных остатков нет.",
    canDispose: false,
    onDispose: () => undefined,
  },
};

export const ОстаткиДлинноеИмя: StoryObj<typeof Balances> = {
  render: (args) => <Balances {...args} />,
  args: {
    balances: [
      {
        product_species_id: SPECIES,
        mass_kg: "12.6",
        revision: 3,
        product_name:
          "говядина и продукты убоя крупного рогатого скота, включая обвалку, жиловку и фасовку",
      },
    ],
    loading: false,
    emptyMessage: "Положительных остатков нет.",
    canDispose: true,
    onDispose: () => undefined,
  },
};

export const ОстаткиПусто: StoryObj<typeof Balances> = {
  render: (args) => <Balances {...args} />,
  args: {
    balances: [],
    loading: false,
    emptyMessage: "Положительных остатков нет.",
    canDispose: true,
    onDispose: () => undefined,
  },
};

export const ОстаткиЗагрузка: StoryObj<typeof Balances> = {
  render: (args) => <Balances {...args} />,
  args: {
    balances: [],
    loading: true,
    emptyMessage: "Положительных остатков нет.",
    canDispose: true,
    onDispose: () => undefined,
  },
};
