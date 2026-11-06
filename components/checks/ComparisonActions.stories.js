import { check, wrapCheck } from './story-support.js';

const render = args => {
  const group = document.createElement('div');
  group.className = 'check-action-group';
  group.append(check.createComparisonActions(args));
  group.querySelectorAll('.check-button').forEach(button => button.addEventListener('click', () => {
    group.querySelectorAll('.check-button').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }));
  return wrapCheck(group, 'check-story-compact');
};

export default {
  id: 'check-comparison-actions',
  title: 'Сверка данных/Компоненты/Результат сравнения',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  argTypes: { state: { control: 'radio', options: ['', 'ok', 'bad'] }, label: { control: 'text' }, disabled: { control: 'boolean' } },
  args: { label: 'Вид продукции', state: '', disabled: false },
  render,
};

export const Idle = { name: 'Не выбран' };
export const Match = { name: 'Соответствует', args: { state: 'ok' } };
export const Mismatch = { name: 'Не соответствует', args: { state: 'bad' } };
export const Disabled = { name: 'Недоступно', args: { disabled: true } };
