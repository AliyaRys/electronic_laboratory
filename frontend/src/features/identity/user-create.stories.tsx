import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Dialog } from "../../shared/ui/Dialog";
import { UserCreateForm } from "./UserCreateForm";
import type { AssignableOptions } from "./api";

const LAB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LAB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEAT = "11111111-1111-4111-8111-111111111111";
const DISTRICT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** One delegated administrator: all four roles, district + two laboratories. */
const FULL_OPTIONS: AssignableOptions = {
  roles: [
    {
      role: "VET",
      label: "Ветеринарный врач",
      territories: [],
      laboratories: [
        { laboratory_id: LAB_A, name: "Лаборатория ВСЭ №1 г. Казань", territory_id: DISTRICT },
        { laboratory_id: LAB_B, name: "Лаборатория ВСЭ №2 Альметьевск", territory_id: DISTRICT },
      ],
      product_areas: [
        { product_area_id: MEAT, name: "Свинина" },
        { product_area_id: "22222222-2222-4222-8222-222222222222", name: "Крупный рогатый скот" },
      ],
      max_laboratories: null,
    },
    {
      role: "HEAD",
      label: "Заведующий лабораторией",
      territories: [],
      laboratories: [{ laboratory_id: LAB_A, name: "Лаборатория ВСЭ №1 г. Казань", territory_id: DISTRICT }],
      product_areas: [],
      max_laboratories: 1,
    },
    {
      role: "ANALYST",
      label: "Аналитик",
      territories: [],
      laboratories: [{ laboratory_id: LAB_A, name: "Лаборатория ВСЭ №1 г. Казань", territory_id: DISTRICT }],
      product_areas: [],
      max_laboratories: 1,
    },
    {
      role: "ADMIN",
      label: "Администратор",
      territories: [{ territory_id: DISTRICT, name: "Альметьевский район" }],
      laboratories: [],
      product_areas: [],
      max_laboratories: null,
    },
  ],
};

/** An administrator without the right to delegate ADMIN. */
const NO_ADMIN_OPTIONS: AssignableOptions = {
  roles: FULL_OPTIONS.roles.filter((item) => item.role !== "ADMIN"),
};

const meta: Meta<typeof UserCreateForm> = {
  title: "F03/UserCreateForm",
  component: UserCreateForm,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof UserCreateForm>;

export const Empty: Story = {
  args: {
    options: FULL_OPTIONS,
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

/** A filled form: prefilled non-secret values; passwords are never prefilled. */
export const Filled: Story = {
  args: {
    options: FULL_OPTIONS,
    initial: {
      fullName: "Иванов Иван Иванович",
      login: "ivanov",
      email: "ivanov@example.test",
      position: "Ветеринарный врач",
    },
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

export const OptionsLoading: Story = {
  args: {
    options: null,
    optionsLoading: true,
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

export const NoDelegation: Story = {
  args: {
    options: { roles: [] },
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

export const HeadRole: Story = {
  args: {
    options: FULL_OPTIONS,
    onSubmit: async () => null,
    onCancel: () => {},
  },
  render: (args) => <UserCreateForm {...args} />,
};

/** The role list always mirrors the server answer (here: no ADMIN). */
export const WithoutAdminRole: Story = {
  args: {
    options: NO_ADMIN_OPTIONS,
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

export const DuplicateLogin: Story = {
  render: () => (
    <UserCreateForm
      options={FULL_OPTIONS}
      onSubmit={async () => ({
        type: "about:blank",
        title: "Already exists",
        status: 409,
        detail: "Логин уже занят.",
        code: "ALREADY_EXISTS",
        errors: [],
      })}
      onCancel={() => {}}
    />
  ),
};

export const FieldErrors: Story = {
  render: () => (
    <UserCreateForm
      options={FULL_OPTIONS}
      onSubmit={async () => ({
        type: "about:blank",
        title: "Validation error",
        status: 422,
        detail: "Запрос не прошёл проверку.",
        code: "VALIDATION_ERROR",
        errors: [
          { path: "login", message: "Логин уже занят." },
          { path: "confirmation", message: "Пароли не совпадают." },
          { path: "scopes.0.laboratory_id", message: "Лаборатория не найдена." },
        ],
      })}
      onCancel={() => {}}
    />
  ),
};

export const Busy: Story = {
  args: {
    options: FULL_OPTIONS,
    busy: true,
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

export const LongValues: Story = {
  render: () => (
    <UserCreateForm
      options={FULL_OPTIONS}
      initial={{
        fullName:
          "Ветеринарный Врач с очень длинной фамилией Общества с ограниченной ответственностью «Агрофирма Свободный Труд имени двадцатилетия Татарской Автономной Советской Социалистической Республики»",
        login: "long-name-vet-of-the-agrofirm",
        email: "long-name-vet-of-the-agrofirm@example.test",
        position: "Ведущий ветеринарный врач по продовольственной безопасности и надзору",
      }}
      onSubmit={async () => null}
      onCancel={() => {}}
    />
  ),
};

/** Narrow screen: cards stack, actions take the full width, no horizontal scroll. */
export const Narrow390: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  args: {
    options: FULL_OPTIONS,
    onSubmit: async () => null,
    onCancel: () => {},
  },
};

/** §11: the shared unsaved-changes decision exactly as the page renders it. */
export const UnsavedDialog: Story = {
  render: () => {
    function UnsavedLeaveDemo(): React.ReactElement {
      const [open, setOpen] = useState(true);
      return (
        <div className="vse-app vse-page">
          <UserCreateForm options={FULL_OPTIONS} onSubmit={async () => null} onCancel={() => {}} />
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Изменения не сохранены"
            description="Введённые данные и выбранный доступ будут потеряны."
            confirmLabel="Выйти без сохранения"
            cancelLabel="Продолжить редактирование"
            onConfirm={() => setOpen(false)}
          />
        </div>
      );
    }
    return <UnsavedLeaveDemo />;
  },
};
