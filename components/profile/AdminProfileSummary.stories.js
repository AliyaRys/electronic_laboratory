import { profile, adminProfileUser, wrapApp } from './story-support.js';

export default {
  id: 'admin-profile-summary',
  title: 'Профиль администратора/Карточка администратора',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Карточка администратора: личность, выбор фото и права доступа без блока доступных типов продукции. Переиспользует createSummary с пустым списком продукции.',
      },
    },
  },
  argTypes: {
    name: { control: 'text' },
    login: { control: 'text' },
    initials: { control: 'text' },
    disabled: { control: 'boolean', description: 'Запретить выбор фото' },
  },
  args: { name: adminProfileUser.name, login: adminProfileUser.login, initials: adminProfileUser.initials, disabled: false },
  render: args => wrapApp(profile.createSummary({ ...args, permissions: adminProfileUser.permissions, products: [] }), 'profile-story-card'),
};
export const Default = { name: 'Карточка без продукции' };
export const LongIdentity = { name: 'Длинные данные', args: { name: 'Елена Александровна Морозова-Смирнова', login: 'Morozova-Smirnova.Elena.Aleksandrovna@regional-administration.example.ru' } };
export const PhotoDisabled = { name: 'Фото недоступно', args: { disabled: true } };
