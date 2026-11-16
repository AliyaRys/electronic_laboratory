/**
 * DR33 (ТЗ §5): the single typed presentation registry mapping GET /me
 * capability codes to Russian labels (mandatory map, ТЗ §6.1–6.8, verified
 * against PERMISSION_MATRIX in backend/src/modules/identity/policies.py).
 *
 * Presentation only: labels are never sent to the server, never stored in
 * Casbin and never used in access checks or route guards — the technical
 * codes stay the only source of authorization decisions.
 */
export const CAPABILITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // 6.1. Профиль и рабочий контекст
  "profile:read": "Просмотр своего профиля",
  "password:change": "Смена своего пароля",
  "context:list": "Просмотр доступных лабораторий и рабочих областей",
  "operation:read": "Просмотр состояния операций",
  // 6.2. Поступления и сверка
  "arrivals:list": "Просмотр списка поступлений",
  "arrivals:read": "Просмотр поступления",
  "arrivals:search": "Поиск поступлений",
  "arrivals:count": "Просмотр количества поступлений",
  "arrivals:hide": "Скрытие ожидаемого поступления",
  "reconciliation:save": "Сохранение сверки данных",
  "vetis:sync": "Синхронизация входящих эВСД с ВетИС",
  "receipt:submit": "Гашение и возврат входящего эВСД",
  "receipt:reconcile": "Проверка результата гашения эВСД",
  // 6.3. Ветеринарно-санитарная экспертиза
  "examination:list": "Просмотр списка ВСЭ",
  "examination:read": "Просмотр карточки ВСЭ",
  "examination:search": "Поиск карточек ВСЭ",
  "examination:count": "Просмотр количества карточек ВСЭ",
  "examination:create-wait": "Создание ВСЭ с ожиданием результатов лаборатории",
  "examination:create-complete": "Создание и завершение ВСЭ",
  "examination:update": "Редактирование карточки ВСЭ",
  "examination:complete-waiting": "Завершение ВСЭ после получения результатов лаборатории",
  "examination:delete": "Удаление карточки ВСЭ",
  // 6.4. Заключения
  "conclusion:preview": "Предварительный просмотр заключения",
  "conclusion:pdf": "Скачивание заключения в PDF",
  "conclusion:print": "Печать заключения",
  // 6.5. Пробы
  "sample:read": "Просмотр проб и их остатков",
  "sample:collect": "Регистрация отбора проб",
  "sample:reuse": "Повторное использование пробы",
  "sample:edit": "Исправление сведений о пробе",
  "sample:dispose": "Регистрация утилизации проб",
  // 6.6. Справочники
  "catalog:read": "Просмотр справочников",
  "catalog:create": "Создание записей справочников",
  "catalog:update": "Редактирование справочников",
  "catalog:delete": "Удаление записей справочников",
  "catalog:bulk-price": "Массовое назначение стоимости",
  "catalog:retry": "Повтор неуспешного массового назначения стоимости",
  // 6.7. Отчёты
  "report:operational": "Просмотр оперативного отчёта",
  "report:5vet-list": "Просмотр списка отчётов 5-вет",
  "report:5vet-read": "Просмотр отчёта 5-вет",
  "report:5vet-export": "Экспорт отчёта 5-вет",
  "report:5vet-preview": "Предварительный просмотр отчёта 5-вет",
  "report:5vet-save": "Сохранение отчёта 5-вет",
  "report:5vet-delete": "Удаление отчёта 5-вет",
  // 6.8. Пользователи
  "users:list": "Просмотр списка пользователей",
  "users:read": "Просмотр данных пользователя",
  "users:history": "Просмотр истории пользователя",
  "users:create": "Создание пользователя",
  "users:update": "Редактирование пользователя",
  "users:block": "Блокировка пользователя",
  "users:unblock": "Разблокировка пользователя",
  "users:reset-password": "Сброс пароля пользователя",
  "users:delete": "Удаление пользователя",
} as const);

export const UNKNOWN_CAPABILITY_LABEL = "Неизвестное право доступа";

export function isKnownCapability(code: string): boolean {
  return CAPABILITY_LABELS[code] !== undefined;
}

/**
 * Russian label of a capability code. An unknown code never renders as the
 * raw English string (ТЗ §7): the visible text is the Russian fallback; in
 * development/test a diagnostic warning asks for a conscious translation.
 */
export function capabilityLabel(code: string): string {
  const label = CAPABILITY_LABELS[code];
  if (label !== undefined) return label;
  if (import.meta.env.DEV) {
    console.warn(`[capabilityLabels] неизвестный capability-код: ${code}`);
  }
  return UNKNOWN_CAPABILITY_LABEL;
}

/** Full tooltip text: the label itself, or fallback + code for diagnostics. */
export function capabilityTooltip(code: string): string {
  return isKnownCapability(code) ? capabilityLabel(code) : `${UNKNOWN_CAPABILITY_LABEL}: ${code}`;
}
