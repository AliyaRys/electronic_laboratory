import { profile, demoPasswordChange } from './story-support.js';

export default {
  id: 'profile-screen', title: 'Профиль/Экран профиля', tags: ['autodocs'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Основное содержимое profile.html без общей шапки приложения. Собрано из карточки пользователя, информационных полей, общей кнопки и формы смены пароля. Шапка остаётся отдельной инфраструктурой app-shell и не дублируется внутри профиля.' } } },
  argTypes: { passwordOpen: { control: 'boolean', description: 'Показать форму смены пароля' }, passwordBusy: { control: 'boolean' }, passwordError: { control: 'text' } },
  args: { passwordOpen: false, passwordBusy: false, passwordError: '' },
  render: args => profile.createScreen({ ...args, onPasswordSubmit: demoPasswordChange }),
};
export const Default = { name: 'Обычный профиль' };
export const PasswordOpen = { name: 'Смена пароля открыта', args: { passwordOpen: true } };
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
