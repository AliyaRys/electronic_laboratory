/**
 * Legacy icon registry adapter (UI-02).
 *
 * The SVG definitions are ported 1:1 from the existing registries —
 * ``components/icons/VseIcon.js``, ``components/shell/AppHeader.js`` and
 * ``components/app/Icon.js`` (meat/milk deduplicated). No new SVG is added
 * here: a new icon first joins the reference registry and Storybook, and only
 * then this adapter. Check-section keys come strictly from the canonical map
 * in ``components/icons/README.md``.
 */

export type IconPart = readonly [
  tag: "path" | "rect" | "circle" | "line",
  attributes: Readonly<Record<string, string>>,
];

export interface CheckSection {
  readonly key: string;
  readonly icon: string;
  readonly label: string;
}

export const ICON_DEFINITIONS: Readonly<Record<string, readonly IconPart[]>> = Object.freeze({
  // --- components/icons/VseIcon.js (check sections, actions, admin, directory)
  "check-document": [
    ["path", { d: "M7 3h7l4 4v14H7z" }],
    ["path", { d: "M14 3v5h5" }],
  ],
  "check-participants": [
    ["path", { d: "M4 21V7l8-4 8 4v14" }],
    ["path", { d: "M9 21v-7h6v7" }],
  ],
  "check-product": [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
    ["circle", { cx: "12", cy: "12", r: "1" }],
    [
      "path",
      { d: "M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" },
    ],
  ],
  "check-transport": [
    ["path", { d: "M3 16h13V6H3z" }],
    ["path", { d: "M16 10h3l2 3v3h-5z" }],
    ["circle", { cx: "7", cy: "18", r: "2" }],
    ["circle", { cx: "18", cy: "18", r: "2" }],
  ],
  "check-documents": [
    ["path", { d: "M8 7h8" }],
    ["path", { d: "M8 11h8" }],
    ["path", { d: "M8 15h5" }],
    ["path", { d: "M5 3h14v18H5z" }],
  ],
  "check-prior-vse": [
    ["circle", { cx: "10.5", cy: "10.5", r: "6.5" }],
    ["path", { d: "M15.5 15.5 21 21" }],
  ],
  "check-results": [
    ["rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }],
    ["path", { d: "M9 2v4h6V2" }],
    ["path", { d: "m9 14 2 2 4-4" }],
  ],
  "check-invoice": [
    ["path", { d: "M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" }],
    ["path", { d: "M8 8h8M8 12h8M8 16h5" }],
  ],
  "comparison-match": [["path", { d: "M20 6 9 17l-5-5" }]],
  "comparison-mismatch": [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  "check-complete": [
    ["path", { d: "m3.5 12.5 3.5 3.5 7-8" }],
    ["path", { d: "m10.5 12.5 3.5 3.5 7-8" }],
  ],
  "admin-users": [
    ["path", { d: "M18 21a8 8 0 0 0-16 0" }],
    ["circle", { cx: "10", cy: "8", r: "5" }],
    ["path", { d: "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" }],
  ],
  "admin-reports": [
    ["path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }],
    ["path", { d: "M14 2v6h6M8 13h2M8 17h2M14 13h2M14 17h2" }],
  ],
  "admin-user-add": [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: "9", cy: "7", r: "4" }],
    ["line", { x1: "19", x2: "19", y1: "8", y2: "14" }],
    ["line", { x1: "22", x2: "16", y1: "11", y2: "11" }],
  ],
  "admin-edit": [
    [
      "path",
      {
        d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
      },
    ],
    ["path", { d: "m15 5 4 4" }],
  ],
  "admin-lock": [
    ["circle", { cx: "12", cy: "16", r: "1" }],
    ["rect", { x: "3", y: "10", width: "18", height: "12", rx: "2" }],
    ["path", { d: "M7 10V7a5 5 0 0 1 10 0v3" }],
  ],
  "admin-unlock": [
    ["circle", { cx: "12", cy: "16", r: "1" }],
    ["rect", { x: "3", y: "10", width: "18", height: "12", rx: "2" }],
    ["path", { d: "M7 10V7a5 5 0 0 1 9.33-2.5" }],
  ],
  "admin-delete": [
    ["path", { d: "M10 11v6M14 11v6" }],
    ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
    ["path", { d: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
  ],
  "admin-dispose": [
    ["path", { d: "M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" }],
    ["path", { d: "M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" }],
    ["path", { d: "m14 16-3 3 3 3" }],
    ["path", { d: "M8.293 13.596 7.196 9.5 3.1 10.598" }],
    [
      "path",
      { d: "m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" },
    ],
    ["path", { d: "m13.378 9.633 4.096 1.098 1.097-4.096" }],
  ],
  "admin-history": [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5M12 7v5l4 2" }],
  ],
  "admin-invite": [
    ["path", { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" }],
    ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }],
  ],
  "admin-retry": [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
  ],
  "admin-clear": [["path", { d: "M18 6 6 18M6 6l12 12" }]],
  "admin-search": [
    ["path", { d: "m21 21-4.34-4.34" }],
    ["circle", { cx: "11", cy: "11", r: "8" }],
  ],
  "admin-more": [
    ["circle", { cx: "5", cy: "12", r: "1" }],
    ["circle", { cx: "12", cy: "12", r: "1" }],
    ["circle", { cx: "19", cy: "12", r: "1" }],
  ],
  "admin-view": [
    ["path", { d: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" }],
    ["circle", { cx: "12", cy: "12", r: "2.7" }],
  ],
  "admin-download": [
    ["path", { d: "M12 3v12" }],
    ["path", { d: "m7 10 5 5 5-5M5 21h14" }],
  ],
  "admin-print": [
    ["path", { d: "M7 8V3h10v5" }],
    ["path", { d: "M6 17H5a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1" }],
    ["path", { d: "M7 14h10v7H7zM18 12h.01" }],
  ],
  "admin-save": [
    ["path", { d: "M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8z" }],
    ["path", { d: "M17 21v-8H7v8M7 3v5h8" }],
  ],
  "admin-warning": [
    ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
    ["path", { d: "M12 9v4M12 17h.01" }],
  ],
  "directory-paid-services": [
    ["rect", { x: "2", y: "6", width: "20", height: "12", rx: "2" }],
    ["circle", { cx: "12", cy: "12", r: "2" }],
    ["path", { d: "M6 12h.01" }],
    ["path", { d: "M18 12h.01" }],
  ],
  "directory-price": [
    ["circle", { cx: "10.5", cy: "10.5", r: "6.5" }],
    ["path", { d: "M15.5 15.5 21 21" }],
  ],
  "directory-norms": [
    ["path", { d: "M4 18h16" }],
    ["path", { d: "M6 14l4-4 3 3 5-7" }],
    ["path", { d: "M18 6h-4" }],
    ["path", { d: "M18 6v4" }],
  ],
  "arrival-plus": [
    ["path", { d: "M12 5v14" }],
    ["path", { d: "M5 12h14" }],
  ],
  "arrival-reconcile": [
    ["path", { d: "M9 11 12 14 20 6" }],
    ["path", { d: "M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" }],
  ],
  "columns-grid": [
    ["path", { d: "M4 4h6v6H4z" }],
    ["path", { d: "M14 4h6v6h-6z" }],
    ["path", { d: "M4 14h6v6H4z" }],
    ["path", { d: "M14 14h6v6h-6z" }],
  ],
  "chevron-left": [["path", { d: "m15 18-6-6 6-6" }]],
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  // --- components/shell/AppHeader.js (canonical shell icons)
  arrivals: [
    ["path", { d: "M4.5 8.2 12 4l7.5 4.2-7.5 4.2-7.5-4.2Z" }],
    ["path", { d: "M4.5 8.2v7.9L12 20l7.5-3.9V8.2" }],
    ["path", { d: "M12 12.4V20" }],
  ],
  "journal-classic": [
    ["rect", { x: "4", y: "3", width: "16", height: "18", rx: "2" }],
    ["path", { d: "M9 3v18M12.5 8H17M12.5 12H17M12.5 16H16" }],
  ],
  "directories-classic": [
    [
      "path",
      {
        d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z",
      },
    ],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
  // --- components/app/Icon.js (working-screen icons; meat/milk shared with the header)
  key: [
    ["circle", { cx: "7.5", cy: "14.5", r: "3.5" }],
    ["path", { d: "M11 14.5h10" }],
    ["path", { d: "M17 14.5v-3" }],
    ["path", { d: "M20 14.5v-2" }],
  ],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  user: [
    ["circle", { cx: "12", cy: "8", r: "4" }],
    ["path", { d: "M5 21a7 7 0 0 1 14 0" }],
  ],
  camera: [
    [
      "path",
      {
        d: "M4.826 9.62a.957.957 0 0 1-.956-.953V6.762H1.957A.957.957 0 0 1 1 5.81c0-.524.43-.953.957-.953H3.87V2.952a.957.957 0 0 1 1.913 0v1.905h1.913c.526 0 .956.429.956.953 0 .523-.43.952-.956.952H5.783v1.905c0 .523-.43.952-.957.952Z",
      },
    ],
    ["path", { d: "M17 14.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" }],
    [
      "path",
      {
        d: "M18.055 6.762h3.032c1.052 0 1.913.857 1.913 1.905v11.428C23 21.143 22.14 22 21.087 22H5.783a1.915 1.915 0 0 1-1.913-1.905v-9.79c.287.162.602.266.956.266A1.914 1.914 0 0 0 6.74 8.667v-.953h.957A1.915 1.915 0 0 0 9.609 5.81c0-.353-.105-.667-.268-.953h6.122a1.91 1.91 0 0 1 1.406.62l1.186 1.285ZM19 14.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z",
        "fill-rule": "evenodd",
        "clip-rule": "evenodd",
      },
    ],
  ],
  meat: [
    [
      "path",
      {
        d: "M12.7 3.3c4.8-.5 8.1 2.5 8.1 6.8 0 5.5-4.4 10.5-9.8 10.5-4.4 0-7.8-2.7-7.8-6.7 0-3.1 1.9-5.7 4.7-7.1 1.7-.9 2.5-3.2 4.8-3.5Z",
      },
    ],
    [
      "path",
      {
        d: "M12.6 7.3c2.7-.4 4.6 1.2 4.6 3.4 0 2.7-2.5 5-5.2 5-2.2 0-3.8-1.4-3.8-3.5 0-1.8 1.7-3.3 4.4-4.9Z",
      },
    ],
  ],
  milk: [
    ["path", { d: "M9 3h6v3l1.5 2.5V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V8.5L9 6V3Z" }],
    ["path", { d: "M9 6h6M7.5 11h9M7.5 16h9" }],
  ],
  caret: [["path", { d: "m7 10 5 5 5-5" }]],
});

export type IconName = keyof typeof ICON_DEFINITIONS & string;

export const ICON_NAMES: readonly IconName[] = Object.freeze(Object.keys(ICON_DEFINITIONS));

/** Canonical check-section map — keys strictly from components/icons/README.md. */
export const CHECK_SECTIONS: Readonly<Record<string, CheckSection>> = Object.freeze({
  document: Object.freeze({ key: "document", icon: "check-document", label: "Документ" }),
  participants: Object.freeze({
    key: "participants",
    icon: "check-participants",
    label: "Участники перевозки",
  }),
  product: Object.freeze({
    key: "product",
    icon: "check-product",
    label: "Идентификация продукции",
  }),
  transport: Object.freeze({
    key: "transport",
    icon: "check-transport",
    label: "Идентификация транспорта",
  }),
  documents: Object.freeze({
    key: "documents",
    icon: "check-documents",
    label: "Сопроводительные документы",
  }),
  priorVse: Object.freeze({
    key: "priorVse",
    icon: "check-prior-vse",
    label: "Ранее проведённая ВСЭ",
  }),
  results: Object.freeze({
    key: "results",
    icon: "check-results",
    label: "Результаты сверки",
  }),
  invoice: Object.freeze({
    key: "invoice",
    icon: "check-invoice",
    label: "Расчёт стоимости услуг",
  }),
});

export const CHECK_SECTION_KEYS: readonly string[] = Object.freeze(Object.keys(CHECK_SECTIONS));

export function getCheckSection(key: string): CheckSection | undefined {
  return CHECK_SECTIONS[key];
}

/** Comparison actions — labels are fixed by the reference registry. */
export const CHECK_ACTIONS: readonly { icon: IconName; label: string }[] = Object.freeze([
  Object.freeze({ icon: "comparison-match", label: "Поле соответствует данным эВСД" }),
  Object.freeze({ icon: "comparison-mismatch", label: "Поле не соответствует данным эВСД" }),
  Object.freeze({ icon: "check-complete", label: "Отметить все поля соответствующими" }),
]);

/** Administrative icon names from the reference registry map. */
export const ADMIN_ICON_NAMES: readonly IconName[] = Object.freeze([
  "admin-users",
  "admin-reports",
  "admin-user-add",
  "admin-edit",
  "admin-lock",
  "admin-unlock",
  "admin-delete",
  "admin-dispose",
  "admin-history",
  "admin-invite",
  "admin-retry",
  "admin-clear",
  "admin-search",
  "admin-more",
  "admin-view",
  "admin-download",
  "admin-print",
  "admin-save",
  "admin-warning",
  "chevron-left",
  "chevron-right",
]);

export const DIRECTORY_ICON_NAMES: readonly IconName[] = Object.freeze(["directory-paid-services"]);

/** Arrival-action icon names (components/icons/VseIcon.js, listArrivalIcons). */
export const ARRIVAL_ICON_NAMES: readonly IconName[] = Object.freeze([
  "arrival-plus",
  "arrival-reconcile",
  "columns-grid",
]);
