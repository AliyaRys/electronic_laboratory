/**
 * S03 disposal dialog and history stories: the confirmation facts before the
 * confirm, the stale-dialog state, the immutable history and its empty state.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { DisposalDialog } from "./DisposalDialog";
import { DisposalHistory } from "./DisposalHistory";

const meta: Meta = {
  title: "S03/Учёт проб",
};
export default meta;

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SPECIES = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const balance = { product_species_id: SPECIES, mass_kg: "12.6", revision: 3 };

const disposal = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  laboratory_id: LAB,
  product_species_id: SPECIES,
  disposed_on: "2026-11-06",
  mass_kg: "12.6",
  external_vsd_number: "ВСД-001",
  actor_id: "00000000-0000-4000-8000-000000000001",
  recorded_at: "2026-11-06T10:00:00Z",
};

export const ДиалогУтилизации: StoryObj<typeof DisposalDialog> = {
  render: (args) => <DisposalDialog {...args} />,
  args: {
    laboratoryId: LAB,
    balance,
    open: true,
    today: "2026-11-06",
    onClose: () => undefined,
    onDisposed: () => undefined,
  },
};

export const ДиалогБезОстатка: StoryObj<typeof DisposalDialog> = {
  render: (args) => <DisposalDialog {...args} />,
  args: {
    laboratoryId: LAB,
    balance: null,
    open: true,
    today: "2026-11-06",
    onClose: () => undefined,
    onDisposed: () => undefined,
  },
};

export const ИсторияУтилизаций: StoryObj<typeof DisposalHistory> = {
  render: (args) => <DisposalHistory {...args} />,
  args: {
    items: [disposal],
    collections: [],
    total: 1,
    page: 1,
    loading: false,
    onPageChange: () => undefined,
  },
};

export const ИсторияПусто: StoryObj<typeof DisposalHistory> = {
  render: (args) => <DisposalHistory {...args} />,
  args: {
    items: [],
    collections: [],
    total: 0,
    page: 1,
    loading: false,
    onPageChange: () => undefined,
  },
};

export const ИсторияСтраницы: StoryObj<typeof DisposalHistory> = {
  render: (args) => <DisposalHistory {...args} />,
  args: {
    items: Array.from({ length: 20 }, (_, index) => ({
      ...disposal,
      id: `dddddddd-dddd-4ddd-8ddd-dddddddddddd`.slice(0, 34) + index.toString().padStart(2, "0"),
      external_vsd_number: `ВСД-0${index + 1}`,
    })),
    collections: [],
    total: 25,
    page: 1,
    loading: false,
    onPageChange: () => undefined,
  },
};
