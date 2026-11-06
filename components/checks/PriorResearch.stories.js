import { check, wrapCheck } from './story-support.js';

const meatConclusion = 'По результатам ветеринарно-санитарной экспертизы туши и внутренние органы признаны пригодными для пищевых целей. Органолептические показатели соответствуют требованиям, патологические изменения и признаки инвазионных заболеваний не выявлены. Продукция допускается к реализации без ограничений при соблюдении установленных условий хранения и сроков годности.';

export default {
  id: 'check-prior-research',
  title: 'Сверка данных/Блоки/Ранее проведённая ВСЭ',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { conclusion: { control: 'text' }, conclusionOpen: { control: 'boolean' } },
  args: { conclusion: meatConclusion, conclusionOpen: false },
  render: args => {
    const grid = document.createElement('div');
    grid.className = 'compare-grid';
    [
      ['Номер экспертизы', 'ВСЭ № 902'],
      ['Дата проведения', '12.08.2026 07:55'],
      ['Организация-оператор', 'Лаборатория ВСЭ №2 г. Казань'],
      ['Результат осмотра', 'Всё соответствует'],
    ].forEach(([label, value]) => grid.append(check.createComparisonField({ label, value, reference: true })));
    const section = check.createSection({
      title: 'Ранее проведённая ВСЭ',
      description: 'Сведения из мероприятий с партией продукции.',
      section: 'priorVse',
      content: [grid, globalThis.VsePriorConclusion.create({ text: args.conclusion, open: args.conclusionOpen })],
    });
    return wrapCheck(section, 'check-story-block');
  },
};

export const Default = { name: 'Обычное состояние' };
export const ConclusionOpen = { name: 'Заключение раскрыто', args: { conclusionOpen: true } };
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
