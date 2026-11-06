import { check, wrapCheck } from './story-support.js';

export default {
  id: 'check-comparison-field',
  title: 'Сверка данных/Компоненты/Поле сверки',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    label: { control: 'text' }, value: { control: 'text' },
    state: { control: 'radio', options: ['', 'ok', 'bad'] },
    reference: { control: 'boolean' }, factValue: { control: 'text' },
    factOptions: { control: 'object' },
    mismatchReason: { control: 'boolean' }, reasonValue: { control: 'text' },
    disabled: { control: 'boolean' }, error: { control: 'text' },
  },
  args: { label: 'Вид продукции', value: 'Свинина охлажденная', state: '', reference: false, factValue: '', factOptions: [], mismatchReason: false, reasonValue: '', disabled: false, error: '' },
  render: args => wrapCheck(check.createComparisonField(args), 'check-story-field'),
};

export const Idle = { name: 'Ожидает проверки' };
export const Match = { name: 'Совпадение', args: { state: 'ok' } };
export const Mismatch = { name: 'Расхождение', args: { state: 'bad', factValue: 'Свинина замороженная' } };
export const MismatchWithReason = { name: 'Расхождение с причиной', args: { label: 'Название продукции', value: 'Свинина в тушах охлажденная', state: 'bad', mismatchReason: true, factValue: 'Свинина в полутушах охлажденная', reasonValue: 'Маркировка партии отличается от сведений эВСД.' } };
export const SelectMismatchWithReason = { name: 'Расхождение со списком и причиной', args: { label: 'Тип транспортного документа', value: 'Товарно-транспортная накладная', state: 'bad', mismatchReason: true, factPlaceholder: 'Выберите тип документа', factOptions: ['Товарно-транспортная накладная', 'Коносамент', 'CMR', 'Авианакладная', 'Транспортная накладная'] } };
export const Reference = { name: 'Справочное значение', args: { label: 'Номер эВСД', value: 'RU016:260812-005118', reference: true } };
export const LongValue = { name: 'Длинное значение', args: { label: 'Связанные документы', value: 'Удостоверение качества № 91/26, декларация соответствия ЕАЭС N RU Д-RU.РА02' } };
export const Error = { name: 'Ошибка фактического значения', args: { state: 'bad', error: 'Укажите фактическое значение.' } };
export const Disabled = { name: 'Недоступно', args: { disabled: true } };
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
