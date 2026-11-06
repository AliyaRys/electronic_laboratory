import { check, wrapCheck } from './story-support.js';

const cargoOptions = ['Соответствует требованиям', 'Есть загрязнения или повреждения'];

export default {
  id: 'check-transport-observation',
  title: 'Сверка данных/Компоненты/Состояние перевозки',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { label: { control: 'text' }, value: { control: 'select', options: ['', ...cargoOptions] }, disabled: { control: 'boolean' } },
  args: { label: 'Состояние грузового отделения', options: cargoOptions, value: '', disabled: false },
  render: args => wrapCheck(check.createTransportObservation(args), 'check-story-field'),
};

export const Idle = { name: 'Не заполнено' };
export const Positive = { name: 'Допустимое значение', args: { value: 'Соответствует требованиям' } };
export const Negative = { name: 'Недопустимое значение', args: { value: 'Есть загрязнения или повреждения' } };
export const Disabled = { name: 'Недоступно', args: { disabled: true } };
export const CombinedCargo = {
  name: 'Совместная перевозка',
  args: { label: 'Совместная перевозка с другими грузами', options: ['Нет', 'Да, грузы разделены', 'Да, разделение не обеспечено'], value: 'Да, грузы разделены' },
};
