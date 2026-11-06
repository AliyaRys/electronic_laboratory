import { check, wrapCheck } from './story-support.js';

const createProductSection = kind => {
  const grid = document.createElement('div');
  grid.className = 'compare-grid';
  if (kind === 'milk') {
    grid.append(
      check.createComparisonField({ label: 'Вид продукции', value: 'Молоко коровье сырое', key: 'product', state: 'ok' }),
      check.createComparisonField({ label: 'Производитель', value: 'КФХ «Ак Барс»', key: 'producer' }),
    );
  } else {
    grid.append(
      check.createProductTaxonomyFields({
        type: 'Мясо и мясопродукты',
        product: 'Свинина',
        kind: 'Свинина в тушах и полутушах охлажденная (0203)',
        name: 'Свинина в тушах охлажденная',
        state: 'ok'
      }),
      check.createComparisonField({ label: 'Производитель', value: 'ООО «АгроМясо»', key: 'producer' }),
    );
  }
  return check.createSection({
    section: 'product',
    title: 'Идентификация продукции по наименованию и визуальным осмотром',
    description: 'Классификация, наименование, объём и ветеринарные характеристики партии.',
    content: [grid],
  });
};

export default {
  id: 'check-section',
  title: 'Сверка данных/Блоки/Секция сверки',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { productKind: { control: 'radio', options: ['meat', 'milk'] } },
  args: { productKind: 'meat' },
  render: args => wrapCheck(createProductSection(args.productKind), 'check-story-block'),
};

export const Meat = { name: 'Мясо' };
export const Milk = { name: 'Молоко', args: { productKind: 'milk' } };
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
