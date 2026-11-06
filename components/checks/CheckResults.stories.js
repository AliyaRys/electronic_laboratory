import { check, wrapCheck } from './story-support.js';

export default {
  id: 'check-results',
  title: 'Сверка данных/Блоки/Результаты сверки',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: { description: { component: 'Итоговый блок сверки: активный специалист отображается без возможности редактирования, пользователь явно выбирает способ завершения приёмки и указывает необходимость повторной ВСЭ.' } },
  },
  argTypes: {
    specialist: { control: 'text' },
    decision: { control: 'select', options: ['', 'not-required', 'required'] },
    receiptDecision: { control: 'select', options: ['', 'accept-all', 'partial', 'return-all'] },
    automaticAct: { control: 'boolean' },
    transaction: { control: 'boolean' },
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
  },
  args: {
    specialist: 'Анна Кузнецова',
    decision: '',
    receiptDecision: '',
    automaticAct: true,
    transaction: false,
    disabled: false,
    error: false,
  },
  render: args => {
    const section = check.createCheckResultsSection(args);
    if (args.error) {
      const select = section.querySelector('[name="repeatVseDecision"]');
      check.setDecisionFieldError(select, 'Укажите необходимость повторного ВСЭ.');
    }
    return wrapCheck(section, 'check-story-block');
  },
};

export const Default = { name: 'Решение не выбрано' };
export const Selected = { name: 'Решения выбраны', args: { receiptDecision: 'accept-all', decision: 'not-required' } };
export const ValidationError = { name: 'Ошибка обязательного поля', args: { error: true } };
export const Disabled = { name: 'Сохранённые решения', args: { receiptDecision: 'partial', decision: 'required', disabled: true } };
export const LongName = { name: 'Длинное имя специалиста', args: { specialist: 'Александра Константиновна Мухаметзянова' } };
export const WithTransaction = {
  name: 'С транзакцией по партии',
  args: { transaction: true },
  render: args => {
    const section = check.createCheckResultsSection(args);
    return wrapCheck(section, 'check-story-block');
  },
};
export const TransactionTypeHidden = {
  name: 'Транзакция не нужна — тип скрыт',
  args: { transaction: true },
  render: args => {
    const section = check.createCheckResultsSection(args);
    const select = section.querySelector('[name="transactionDecision"]');
    select.value = 'no';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return wrapCheck(section, 'check-story-block');
  },
};
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
