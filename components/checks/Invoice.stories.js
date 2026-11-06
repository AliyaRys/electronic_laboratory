import { check, wrapCheck } from './story-support.js';

const meatLines = [
  { service: 'Идентификация продукции по наименованию и визуальным осмотром', quantity: '3 туши', rate: '94 ₽', sum: '282 ₽' },
  { service: 'Ветеринарно-санитарная оценка и идентификация транспорта', quantity: '1 ТС', rate: '94 ₽', sum: '94 ₽' },
];
const milkLines = [
  { service: 'Идентификация продукции по наименованию и визуальным осмотром', quantity: '3 секции', rate: '94 ₽', sum: '282 ₽' },
  { service: 'Ветеринарно-санитарная оценка и идентификация транспорта', quantity: '1 ТС', rate: '94 ₽', sum: '94 ₽' },
];

const render = args => {
  const content = document.createElement('div');
  content.append(check.createInvoice(args));
  return wrapCheck(check.createSection({
    section: 'invoice',
    title: 'Расчёт стоимости услуг',
    description: 'Услуги по сверке партии и транспорта, их количество, тарифы и итоговая сумма.',
    content: [content],
  }), 'check-story-block');
};

export default {
  id: 'check-invoice',
  title: 'Сверка данных/Блоки/Расчёт стоимости',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { lines: { control: 'object' }, total: { control: 'text' } },
  args: { lines: meatLines, total: '376 ₽' },
  render,
};

export const Meat = { name: 'Мясо' };
export const Milk = { name: 'Молоко', args: { lines: milkLines } };
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
