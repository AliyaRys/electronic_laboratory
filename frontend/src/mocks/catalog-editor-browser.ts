/**
 * The browser MSW worker of the catalog editor stories (ТЗ-DR6 §16): the full
 * three pages render with fixture handlers on the same components the
 * production pages use.
 */
import { setupWorker } from "msw/browser";
import { catalogEditorHandlers } from "./catalog-editor-handlers";

export const catalogWorker = setupWorker(...catalogEditorHandlers);
