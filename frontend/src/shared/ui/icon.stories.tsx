import type { Meta, StoryObj } from "@storybook/react";
import { Icon } from "./Icon";
import {
  ADMIN_ICON_NAMES,
  ARRIVAL_ICON_NAMES,
  CHECK_ACTIONS,
  CHECK_SECTIONS,
  EXAM_SECTION_ICON_NAMES,
  ICON_NAMES,
  PRODUCT_ICON_NAMES,
} from "./legacy-icons";

/** Catalog of the adapted registry — the adapter adds no SVG of its own. */
function IconCatalog(): React.ReactElement {
  return (
    <div style={{ padding: 16 }}>
      <h3>Разделы сверки (data-check-section)</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
        }}
      >
        {Object.values(CHECK_SECTIONS).map((section) => (
          <li key={section.key} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={section.icon as never} />
            <span>
              {section.label} <code>{section.key}</code>
            </span>
          </li>
        ))}
      </ul>
      <h3>Действия сверки</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
        }}
      >
        {CHECK_ACTIONS.map((action) => (
          <li key={action.icon} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={action.icon} />
            <span>{action.label}</span>
          </li>
        ))}
      </ul>
      <h3>Иконки поступлений</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
        }}
      >
        {ARRIVAL_ICON_NAMES.map((name) => (
          <li key={name} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={name} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <h3>Иконки разделов карточки ВСЭ</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
        }}
      >
        {EXAM_SECTION_ICON_NAMES.map((name) => (
          <li key={name} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={name} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <h3>Иконки шапки (продуктовые направления, ТЗ DR46 §3.1)</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(3, minmax(220px, 1fr))",
        }}
      >
        {PRODUCT_ICON_NAMES.map((name) => (
          <li key={name} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={name} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <h3>Административные иконки</h3>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
        }}
      >
        {ADMIN_ICON_NAMES.map((name) => (
          <li key={name} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name={name} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
      <p>
        Всего в реестре: {ICON_NAMES.length} иконок. Новые иконки добавляются сначала в
        components/icons/VseIcon.js, затем в этот адаптер.
      </p>
    </div>
  );
}

const meta: Meta = {
  title: "F02/Icon",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof IconCatalog>;

export const Registry: Story = { render: () => <IconCatalog /> };

/** ТЗ DR50 §2.3: the three library icons side by side — same size,
 * same currentColor, original Font Awesome geometry. */
export const ProductLibraryIcons: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, padding: 16, color: "#146c73", alignItems: "center" }}>
      {["product-eggs", "product-fish", "product-plant"].map((name) => (
        <span key={name} style={{ width: 32, height: 32, display: "inline-grid", placeItems: "center" }}>
          <Icon name={name as never} />
        </span>
      ))}
    </div>
  ),
};
