/**
 * Context slot of the editor pages (ТЗ-DR6 §6; ТЗ DR53 Task 5): the compact
 * laboratory selector for roles with several allowed laboratories. The
 * context notes («Лаборатория … · Продукция …») were removed at the source:
 * they were technical read-model echoes, not user data. A role without a
 * switcher (HEAD/single-context) renders NO slot at all — never an empty
 * wrapper.
 */
import "./catalogs.css";
import { CatalogContextSelector } from "./editor-parts";
import type { CatalogContext } from "./use-catalog-context";

export interface CatalogContextSlotProps {
  context: CatalogContext;
  /** Deep-link update of the URL laboratory; null — no slot is rendered. */
  onPick: ((laboratoryId: string) => void) | null;
}

export function CatalogContextSlot({ context, onPick }: CatalogContextSlotProps): React.ReactElement | null {
  if (onPick === null) {
    return null;
  }
  return (
    <CatalogContextSelector
      laboratories={context.laboratories}
      value={context.laboratoryId ?? ""}
      onChange={onPick}
    />
  );
}
