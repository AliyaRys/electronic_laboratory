import { check, wrapCheck } from './story-support.js';

const meat = {
  label: 'Состав мясной партии',
  columns: ['Маркировка', 'Часть', 'Кол-во'],
  rows: [['АГМ-26-СВ-0812-01', 'Туша', '1'], ['АГМ-26-СВ-0812-02', 'Туша', '1'], ['АГМ-26-СВ-0812-03', 'Туша', '1']],
};
const milk = {
  label: 'Состав молочной партии',
  columns: ['Секция', 'Объём'],
  rows: [['1', '40 л'], ['2', '40 л'], ['3', '40 л']],
};

export default {
  id: 'check-composition-table',
  title: 'Сверка данных/Компоненты/Состав партии',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { columns: { control: 'object' }, rows: { control: 'object' }, label: { control: 'text' } },
  args: meat,
  render: args => wrapCheck(check.createCompositionTable(args), 'check-story-table'),
};

export const Meat = { name: 'Мясо · маркировка частей' };
export const Milk = { name: 'Молоко · секции', args: milk };
export const LongMarking = { name: 'Длинная маркировка', args: { ...meat, rows: [['ПРОИЗВОДИТЕЛЬ-2026-СВИНИНА-ПАРТИЯ-0001', 'Левая полутуша', '1']] } };
export const Narrow = { name: 'Узкий экран', args: milk, parameters: { viewport: { defaultViewport: 'mobile1' } } };
