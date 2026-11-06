import type { Meta, StoryObj } from "@storybook/react";
import { Icon } from "./Icon";
import { ADMIN_ICON_NAMES, CHECK_ACTIONS, CHECK_SECTIONS, ICON_NAMES } from "./legacy-icons";

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
