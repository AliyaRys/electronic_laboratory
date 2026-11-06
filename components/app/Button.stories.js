import { app, wrapApp } from './story-support.js';

export default {
  id: 'app-button', title: 'Профиль/Кнопка', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Основная кнопка рабочих экранов: 43 px, спокойный вторичный и бирюзовый основной варианты. Компонент хранит геометрию при ожидании и даёт методы setBusy и setDisabled. Крупная градиентная кнопка входа остаётся отдельным вариантом авторизации.' } } },
  argTypes: {
    label: { control: 'text', description: 'Текст действия' },
    busyLabel: { control: 'text', description: 'Текст ожидания' },
    variant: { control: 'select', options: ['secondary', 'primary', 'danger'], description: 'Иерархия действия' },
    icon: { control: 'select', options: [undefined, 'key', 'check'], description: 'Системная иконка' },
    iconOnly: { control: 'boolean', description: 'Показать только иконку, сохранив доступное имя' },
    disabled: { control: 'boolean', description: 'Недоступная кнопка' },
    busy: { control: 'boolean', description: 'Действие выполняется' },
  },
  args: { label: 'Сменить пароль', busyLabel: 'Сохраняем…', variant: 'secondary', icon: 'key', iconOnly: false, disabled: false, busy: false },
  render: args => wrapApp(app.createButton(args), 'app-preview app-preview-row'),
};
export const Secondary = { name: 'Вторичная' };
export const Primary = { name: 'Основная', args: { label: 'Сохранить', variant: 'primary', icon: 'check' } };
export const Danger = { name: 'Опасное действие', args: { label: 'Заблокировать', variant: 'danger' } };
export const IconOnly = { name: 'Только иконка', args: { label: 'Сохранить новый пароль', variant: 'primary', icon: 'check', iconOnly: true } };
export const Loading = { name: 'Выполняется', args: { label: 'Сохранить', variant: 'primary', icon: 'check', busy: true } };
export const Disabled = { name: 'Недоступная', args: { disabled: true } };
export const LongLabel = { name: 'Длинная подпись', args: { label: 'Сохранить изменения профиля пользователя лаборатории' } };
