import { profile, adminProfileUser, demoPasswordChange } from './story-support.js';

export default {
  id: 'admin-profile-screen',
  title: 'Профиль администратора/Экран профиля',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Профиль администратора города/МО. Переиспользует ProfileSummary, ProfileScreen и форму смены пароля; показывает роль, город/МО и права из PRD (PDR-003) без блока доступной продукции. Шапка остаётся в AppHeader.',
      },
    },
  },
  argTypes: {
    passwordOpen: { control: 'boolean', description: 'Показать форму смены пароля' },
    passwordBusy: { control: 'boolean' },
    passwordError: { control: 'text' },
  },
  args: { passwordOpen: false, passwordBusy: false, passwordError: '' },
  render: args => profile.createScreen({ user: adminProfileUser, title: 'Профиль администратора', ...args, onPasswordSubmit: demoPasswordChange }),
};
export const Default = { name: 'Обычный профиль' };
export const PasswordOpen = { name: 'Смена пароля открыта', args: { passwordOpen: true } };
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
