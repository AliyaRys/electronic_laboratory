/**
 * ArrivalList stories (A01): realistic queue rows for the three queues, long
 * data and the empty queue state.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { ArrivalList } from "./ArrivalList";
import type { IncomingView } from "./api";

const meta: Meta<typeof ArrivalList> = {
  title: "A01/Очередь поступлений",
  component: ArrivalList,
};

export default meta;

const base: IncomingView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: "9c1b2d3e-1111-4222-8333-444444444444",
  laboratory_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentNumber: "№ A-001234",
      transportNumber: "А123ВС77",
      consignor: "ООО «Мясопром»",
      consignee: "Убойный пункт Ленина, 5",
      productItem: "Отруба говяжьи",
    },
  },
  classification: {
    product: { id: "362aa885-9b9f-ae95-05d0-f9570f4fbdc6", name: "говядина" },
    subProduct: null,
    productItem: { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002", name: "Отруба говяжьи" },
    unit: { id: "aaaaaaaa-1111-4111-8111-111111111111", name: "кг" },
  },
  documentary: { mass_kg: "120.0", quantity: "4", unit_id: "aaaaaaaa-1111-4111-8111-111111111111" },
  confirmation: null,
  queue: "EXPECTED",
  examination_id: null,
  revision: 1,
};

const row = (over: Partial<IncomingView>): IncomingView => ({ ...base, ...over });

export const Ожидается: StoryObj<typeof ArrivalList> = {
  args: {
    labId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    items: [
      row({}),
      row({
        party_id: "0c1b2d3e-1111-4222-8333-444444444444",
        external: {
          ...base.external,
          fields: {
            ...base.external.fields,
            documentNumber: "№ В-000999",
            consignor: "КФХ «Восток» — очень длинное наименование отправителя для проверки переноса строк",
          },
        },
        classification: {
          ...base.classification,
          product: { ...base.classification.product, name: "свинина" },
        },
        documentary: { mass_kg: "105.5", quantity: "12", unit_id: base.documentary.unit_id },
      }),
    ],
  },
};

export const ВРаботе: StoryObj<typeof ArrivalList> = {
  args: {
    labId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    items: [
      row({
        queue: "WORK",
        external: { ...base.external, fields: { ...base.external.fields, documentNumber: "№ А-000001" } },
      }),
    ],
  },
};

export const Принято: StoryObj<typeof ArrivalList> = {
  args: {
    labId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    items: [
      row({
        queue: "ACCEPTED",
        confirmation: {
          id: "55555555-1111-4222-8333-444444444444",
          accepted_mass_kg: "120.000000",
          accepted_quantity: "4.000000",
          accepted_unit_id: "aaaaaaaa-1111-4111-8111-111111111111",
          returned_mass_kg: "0.000000",
          returned_quantity: "0.000000",
          confirmed_at: "2026-11-07T10:00:00Z",
        },
      }),
    ],
  },
};

export const ПустаяОчередь: StoryObj<typeof ArrivalList> = {
  args: {
    labId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    items: [],
  },
};
