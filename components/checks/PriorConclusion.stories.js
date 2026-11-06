import { wrapCheck } from './story-support.js';

const meatConclusion = 'По результатам ветеринарно-санитарной экспертизы туши и внутренние органы признаны пригодными для пищевых целей. Органолептические показатели соответствуют требованиям, патологические изменения и признаки инвазионных заболеваний не выявлены. Продукция допускается к реализации без ограничений при соблюдении установленных условий хранения и сроков годности.';
const milkConclusion = 'По результатам ветеринарно-санитарной экспертизы сырое коровье молоко соответствует установленным требованиям безопасности и качества. Органолептические, физико-химические и лабораторные показатели находятся в пределах допустимых значений. Продукция допускается к дальнейшей переработке и реализации при соблюдении условий хранения и срока годности.';

export default {
  id: 'check-prior-conclusion',
  title: 'Сверка данных/Компоненты/Заключение ранее проведённой ВСЭ',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { text: { control: 'text' }, open: { control: 'boolean' } },
  args: { text: meatConclusion, open: false },
  render: args => wrapCheck(globalThis.VsePriorConclusion.create(args), 'check-story-block'),
};

export const Meat = { name: 'Мясо' };
export const Milk = { name: 'Молоко', args: { text: milkConclusion } };
export const Open = { name: 'Раскрыто', args: { open: true } };
export const Narrow = { name: 'Узкий экран', args: { text: milkConclusion }, parameters: { viewport: { defaultViewport: 'mobile1' } } };
