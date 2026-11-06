import { ui, preventNavigation, demoSuccess } from './story-support.js';
import logoSrc from '../../vse-lab-icon-transparent.png';

export default {
  id: 'auth-screen', title: 'Вход/Экран входа', tags: ['autodocs'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Полный экран login из того же кода, что использует login.html. Сохранены композиция, логотип, фон и перестроение на узкой ширине. В Storybook вход демонстрационный и не переводит на журнал. В самом макете переход на journal.html сохранён. Пароль скрыт по умолчанию. Анимация отключается при prefers-reduced-motion.' } } },
  args: { busy: false, error: '' },
  argTypes: { busy: { control: 'boolean' }, error: { control: 'text' } },
  render: args => ui.createLoginScreen({ ...args, logoSrc, onSubmit: demoSuccess, onRecover: preventNavigation }),
};
export const Default = { name: 'Полный экран' };
export const Loading = { name: 'Загрузка', args: { busy: true } };
export const Error = { name: 'Ошибка входа', args: { error: 'Неверный логин или пароль. Проверьте данные и попробуйте снова.' } };
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
