/**
 * S03 balance stories: the readonly balances table for a disposing role and
 * the read-only analyst view, plus the empty and loading states.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { Balances } from "./Balances";
import { Collections } from "./Collections";
import type { CollectionView } from "./api";

const meta: Meta = {
  title: "S03/Учёт проб",
};
export default meta;

const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balances = [
  { product_species_id: SPECIES, mass_kg: "12.6", revision: 3 },
  {
    product_species_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    mass_kg: "2",
    revision: 1,
  },
];

const collection: CollectionView = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  laboratory_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  product_species_id: SPECIES,
  classification_snapshot: { product: { id: SPECIES, name: "говядина" } },
  collected_on: "2026-11-05",
  mass_kg: "12.6",
  collected_by: "00000000-0000-4000-8000-000000000001",
  created_at: "2026-11-05T10:00:00Z",
  disposal_id: null,
  revision: 1,
};

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

export const Отборы: StoryObj<typeof Collections> = {
  render: (args) => <Collections {...args} />,
  args: {
    items: [collection],
    total: 1,
    loading: false,
    page: 1,
    onPageChange: () => undefined,
  },
};

export const ОтборыДлинныеЗначения: StoryObj<typeof Collections> = {
  render: (args) => <Collections {...args} />,
  args: {
    items: [
      {
        ...collection,
        classification_snapshot: {
          product: {
            id: SPECIES,
            name: "говядина и продукты убоя крупного рогатого скота, включая обвалку и жиловку",
          },
        },
      },
    ],
    total: 1,
    loading: false,
    page: 1,
    onPageChange: () => undefined,
  },
};
