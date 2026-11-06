import { ui, wrap } from './story-support.js';

export default {
  id: 'auth-button', title: 'Вход/Кнопка', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Кнопка варианта login: исходные градиент, размер и иконка. disabled блокирует действие; busy показывает ожидание и также блокирует действие. Методы setBusy(boolean) и setDisabled(boolean). Это оформление входа, а не замена кнопок всех рабочих экранов.' } } },
  argTypes: {
    label: { control: 'text', description: 'Текст кнопки' },
    busyLabel: { control: 'text', description: 'Текст во время ожидания' },
    icon: { control: 'boolean', description: 'Стрелка справа' },
    disabled: { control: 'boolean', description: 'Недоступное состояние' },
    busy: { control: 'boolean', description: 'Ожидание результата' },
  },
  args: { label: 'Войти', busyLabel: 'Входим…', icon: true, disabled: false, busy: false },
  render: args => wrap(ui.createButton(args)),
};
export const Default = { name: 'Обычная' };
export const WithoutIcon = { name: 'Без иконки', args: { icon: false } };
export const Recovery = { name: 'Восстановить пароль', args: { label: 'Восстановить пароль', busyLabel: 'Отправляем…', icon: false } };
export const RecoveryLoading = { name: 'Письмо отправляется', args: { label: 'Восстановить пароль', busyLabel: 'Отправляем…', icon: false, busy: true } };
export const Disabled = { name: 'Недоступная', args: { disabled: true } };
export const Loading = { name: 'Загрузка', args: { busy: true } };
export const LongLabel = { name: 'Длинная подпись', args: { label: 'Войти в электронную лабораторию ветеринарно-санитарной экспертизы' } };
export const Focus = { name: 'В фокусе', play: ({ canvasElement }) => canvasElement.querySelector('button').focus() };
