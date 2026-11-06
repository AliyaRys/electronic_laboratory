import { app, wrapApp } from './story-support.js';

export default {
  id: 'app-info-field', title: 'Профиль/Информационное поле', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Пара «подпись — значение» для неизменяемых сведений в карточках, сводках и профиле. Это не поле ввода: элемент не выглядит редактируемым и переносит длинные значения.' } } },
  argTypes: { label: { control: 'text' }, value: { control: 'text' }, wide: { control: 'boolean' } },
  args: { label: 'Должность', value: 'Ветеринарный врач', wide: false },
  render: args => wrapApp(app.createInfoField(args)),
};
export const Default = { name: 'Обычное значение' };
export const Empty = { name: 'Нет данных', args: { value: '' } };
export const LongValue = { name: 'Длинное значение', args: { label: 'Учреждение', value: 'Государственное бюджетное учреждение «Электронная лаборатория ветеринарно-санитарной экспертизы №1 города Казани»' } };
