import { check, wrapCheck } from './story-support.js';

export default {
  id: 'check-research-result',
  title: 'Сверка данных/Компоненты/Результат исследования',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { name: { control: 'text' }, value: { control: 'text' }, optional: { control: 'boolean' } },
  args: { name: 'Органолептика', value: 'Соответствует', optional: false },
  render: args => wrapCheck(check.createResearchResult(args), 'check-story-research-item'),
};

export const Required = { name: 'Основное исследование' };
export const Optional = { name: 'Дополнительное исследование', args: { name: 'Реакция с сернокислой медью', value: 'Отрицательная', optional: true } };
export const LongValue = { name: 'Длинный результат', args: { name: 'Дозометрическое исследование', value: 'Мощность дозы от партии — 0,12 мкЗв/ч; гамма-фон — 0,10 мкЗв/ч' } };
