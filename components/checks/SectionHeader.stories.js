import { check, wrapCheck } from './story-support.js';

export default {
  id: 'check-section-header',
  title: 'Сверка данных/Компоненты/Заголовок раздела',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    section: { control: 'select', options: ['document', 'participants', 'product', 'transport', 'documents', 'priorVse', 'invoice'] },
    title: { control: 'text' },
    description: { control: 'text' },
    price: { control: 'text' },
  },
  args: {
    section: 'product',
    title: 'Идентификация продукции',
    description: 'Продукция, объём и ветеринарные характеристики партии.',
    price: '',
  },
  render: args => wrapCheck(check.createSectionHeader(args), 'check-story-header'),
};

export const Default = { name: 'Обычный' };
export const WithPrice = { name: 'Со стоимостью', args: { price: '376 ₽' } };
export const LongTitle = {
  name: 'Длинное название',
  args: { section: 'transport', title: 'Ветеринарно-санитарная оценка и идентификация транспорта' },
};
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
