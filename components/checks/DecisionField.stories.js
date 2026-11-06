import { check, wrapCheck } from './story-support.js';

const options = [
  { value: 'not-required', label: 'Повторная ВСЭ не требуется' },
  { value: 'required', label: 'Требуется повторная ВСЭ' },
];

export default {
  id: 'check-decision-field',
  title: 'Сверка данных/Компоненты/Решение по партии',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: {
    value: { control: 'select', options: ['', 'not-required', 'required'] },
    disabled: { control: 'boolean' },
  },
  args: {
    label: 'Необходимость повторного ВСЭ',
    description: 'Решение принимается по результатам осмотра продукции и транспорта.',
    options,
    name: 'repeatVseDecision',
    required: true,
    value: '',
    disabled: false,
  },
  render: args => wrapCheck(check.createDecisionField(args), 'check-story-field'),
};

export const Empty = { name: 'Решение не выбрано' };
export const NotRequired = { name: 'Повторная ВСЭ не требуется', args: { value: 'not-required' } };
export const Required = {
  name: 'Требуется повторная ВСЭ — основание и № акта',
  render: args => {
    const group = check.createRepeatVseDecision(args);
    const select = group.querySelector('[name="repeatVseDecision"]');
    select.value = 'required';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return wrapCheck(group, 'check-story-field');
  },
};
export const RequiredEmptyDetails = {
  name: 'Требуется повторная ВСЭ — поля пустые',
  render: args => {
    const group = check.createRepeatVseDecision(args);
    const select = group.querySelector('[name="repeatVseDecision"]');
    select.value = 'required';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const basis = group.querySelector('[name="repeatVseBasis"]');
    check.setDecisionFieldError(basis, 'Укажите основание для проведения повторного ВСЭ.');
    return wrapCheck(group, 'check-story-field');
  },
};
export const Disabled = { name: 'Недоступно', args: { value: 'not-required', disabled: true } };
