import { profile, wrapApp } from './story-support.js';

export default {
  id: 'profile-summary', title: 'Профиль/Карточка пользователя', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Карточка объединяет личность пользователя, выбор изображения, права и доступные типы продукции. Эти сведения образуют один устойчивый блок профиля, поэтому не раздроблены на отдельные компоненты. Выбор файла в макете только вызывает onPhotoSelect(file); загрузки на сервер нет.' } } },
  argTypes: { name: { control: 'text' }, login: { control: 'text' }, initials: { control: 'text' }, disabled: { control: 'boolean', description: 'Запретить выбор фото' } },
  args: { name: 'Анна Кузнецова', login: 'Kuznetsova.Anna@tatar.ru', initials: 'АК', disabled: false },
  render: args => wrapApp(profile.createSummary(args), 'profile-story-card'),
};
export const Default = { name: 'Обычная карточка' };
export const LongIdentity = { name: 'Длинные данные', args: { name: 'Александра Константиновна Кузнецова-Смирнова', login: 'Kuznetsova-Smirnova.Alexandra.Konstantinovna@regional-laboratory.example.ru', initials: 'АК' } };
export const PhotoDisabled = { name: 'Фото недоступно', args: { disabled: true } };
