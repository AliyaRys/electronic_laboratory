/**
 * Catalogs page (Task C02, FT-CAL-05/06/07, ui-mapping: catalogs → /catalogs).
 *
 * The overview (directories.html composition, spec DR4 §7.2) shows the three
 * directory cards in the mockup order. The three editor routes render the
 * dedicated editor pages of ТЗ-DR6 (§9/§10/§11); the editor pages carry NO
 * pill-tab strip — navigation back goes through the overview, and the scope
 * lives in the URL for a restorable deep link.
 */
import "../features/catalogs/catalogs.css";
import { useLocation, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { Button } from "../shared/ui/Button";
import { Icon, type IconName } from "../shared/ui/Icon";
import { TariffsEditorPage } from "../features/catalogs/TariffsEditorPage";
import { CheckServicesEditorPage } from "../features/catalogs/CheckServicesEditorPage";
import { MethodsEditorPage } from "../features/catalogs/MethodsEditorPage";

const TABS = [
  { id: "methods", label: "Нормы исследований" },
  { id: "tariffs", label: "Стоимость исследований" },
  { id: "check-services", label: "Услуги сверки" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Overview cards (directories.html composition, spec DR4 §7.2): the mockup
 * order «Стоимость исследований ВСЭ» → «Платные услуги» → «Нормы исследований».
 * Descriptions are static UI text from the approved mockup; every value and
 * status keeps coming from the real model. No fake delete actions: only the
 * existing editors are offered.
 */
const OVERVIEW: readonly {
  tab: TabId;
  name: string;
  description: string;
  icon?: IconName;
  glyph?: string;
}[] = [
  {
    tab: "tariffs",
    name: "Стоимость исследований ВСЭ",
    description: "Используется для автоматического расчёта стоимости услуг",
    glyph: "₽",
  },
  {
    tab: "check-services",
    name: "Платные услуги",
    description: "Стоимость услуг сверки данных для мясной и молочной продукции",
    icon: "directory-paid-services",
  },
  {
    tab: "methods",
    name: "Нормы исследований",
    description: "Используется для автоматической отметки «норма» и отклонений в результатах ВСЭ",
    glyph: "≋",
  },
];

/**
 * The tab comes from the deep link path (/catalogs/methods, /catalogs/tariffs)
 * first, then from ?tab=; a missing or unknown tab is the safe overview state
 * — never a fetch with empty or foreign identifiers (spec DR4 §7.2).
 */
function tabFromRoute(pathname: string, value: string | null): TabId | null {
  if (pathname.endsWith("/methods")) return "methods";
  if (pathname.endsWith("/tariffs")) return "tariffs";
  if (pathname.endsWith("/check-services")) return "check-services";
  return TABS.some((tab) => tab.id === value) ? (value as TabId) : null;
}

export function CatalogsPage(): React.ReactElement {
  return (
    <RequireSession>
      <CatalogsContent />
    </RequireSession>
  );
}

function CatalogsContent(): React.ReactElement {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = tabFromRoute(location.pathname, params.get("tab"));

  const openTab = (id: TabId): void => {
    const search = new URLSearchParams(params);
    search.set("tab", id);
    setParams(search);
  };

  if (tab === "tariffs") return <TariffsEditorPage />;
  if (tab === "check-services") return <CheckServicesEditorPage />;
  if (tab === "methods") return <MethodsEditorPage />;

  return (
    <div className="vse-app vse-page vse-catalog-page">
      <div className="vse-catalog-header">
        <p className="vse-catalog-eyebrow">Справочники</p>
        <h1>Управление справочниками</h1>
      </div>
      <section
        className="vse-catalog-section"
        aria-labelledby="catalog-overview-title"
        data-testid="catalog-overview"
      >
        <div className="vse-catalog-section-head">
          <div className="vse-catalog-section-title">
            <span className="vse-catalog-section-icon" aria-hidden="true">
              <Icon name="directories-classic" />
            </span>
            <div>
              <h2 id="catalog-overview-title">Список справочников</h2>
              <p>Настройки, которые используются при заполнении электронного журнала.</p>
            </div>
          </div>
        </div>
        <div className="vse-catalog-list">
          {OVERVIEW.map((card) => (
            <article className="vse-catalog-item" key={card.tab} data-testid={`catalog-card-${card.tab}`}>
              <div className="vse-catalog-item-main">
                <span className="vse-catalog-item-icon" aria-hidden="true">
                  {card.icon !== undefined ? <Icon name={card.icon} /> : card.glyph}
                </span>
                <div>
                  <div className="vse-catalog-item-name">{card.name}</div>
                  <div className="vse-catalog-item-meta">{card.description}</div>
                </div>
              </div>
              <div className="vse-catalog-item-actions">
                <Button type="button" variant="secondary" onClick={() => openTab(card.tab)}>
                  Редактировать
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
