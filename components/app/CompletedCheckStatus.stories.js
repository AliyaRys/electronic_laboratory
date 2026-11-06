import { app, wrapApp } from './story-support.js';

export default {
  id: 'app-completed-check-status',
  title: 'Сверка данных/Компоненты/Сохранённый статус перевозки',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Карточка сохранённого ответа из сверки транспортного эВСД. Допустимые значения получают зелёное или красное семантическое состояние; неизвестные и незаполненные значения остаются нейтральными.',
      },
    },
  },
  argTypes: {
    kind: { control: 'select', options: ['cargo', 'combined'] },
    label: { control: 'text' },
    value: { control: 'text' },
  },
  args: {
    kind: 'cargo',
    label: 'Состояние грузового отделения',
    value: 'Соответствует требованиям',
  },
  render: args => {
    const card = document.createElement('div');
    card.className = 'check-card info-card';
    card.dataset.completedStatus = args.kind;
    const label = document.createElement('div');
    label.className = 'field-name';
    label.textContent = args.label;
    const value = document.createElement('div');
    value.className = 'mercury-value';
    value.textContent = args.value;
    card.append(label, value);
    const preview = wrapApp(card);
    app.applyCompletedTransportStatuses(preview);
    return preview;
  },
};

export const Positive = { name: 'Допустимое значение' };
export const Negative = {
  name: 'Недопустимое значение',
  args: { value: 'Есть загрязнения и повреждения' },
};
export const LegacyNegative = {
  name: 'Недопустимое сохранённое значение',
  args: { value: 'Есть загрязнения или повреждения' },
};
export const CombinedSeparated = {
  name: 'Совместная перевозка с разделением',
  args: { kind: 'combined', label: 'Совместная перевозка с другими грузами', value: 'Да, грузы разделены' },
};
export const CombinedUnsafe = {
  name: 'Совместная перевозка без разделения',
  args: { kind: 'combined', label: 'Совместная перевозка с другими грузами', value: 'Да, разделение не обеспечено' },
};
export const Neutral = {
  name: 'Значение не указано',
  args: { value: 'Не указано' },
};
