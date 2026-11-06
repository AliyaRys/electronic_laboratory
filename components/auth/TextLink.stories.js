import { ui, wrap, preventNavigation } from './story-support.js';

export default {
  id: 'auth-link', title: 'Вход/Ссылка', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Общая навигационная ссылка экранов авторизации. Вариант default ведёт к восстановлению пароля, back добавляет стрелку назад. Параметры: label, href, variant, onClick. В примерах переход отменяется, чтобы оставаться в каталоге.' } } },
  argTypes: { label: { control: 'text', description: 'Текст ссылки' }, variant: { control: 'select', options: ['default', 'back'], description: 'Обычная ссылка или переход назад' } },
  args: { label: 'Забыли пароль?', variant: 'default' },
  render: args => wrap(ui.createTextLink({ ...args, onClick: preventNavigation })),
};
export const Default = { name: 'Восстановление пароля' };
export const Back = { name: 'Вернуться ко входу', args: { label: 'Вернуться ко входу', variant: 'back' } };
export const Focus = { name: 'В фокусе', play: ({ canvasElement }) => canvasElement.querySelector('a').focus() };
export const LongLabel = { name: 'Длинная подпись', args: { label: 'Восстановить доступ к учётной записи электронной лаборатории' } };
