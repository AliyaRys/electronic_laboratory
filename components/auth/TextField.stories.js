import { ui, wrap } from './story-support.js';

export default {
  id: 'auth-field', title: 'Вход/Поле ввода', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Поле оформления login. Подпись связана с вводом. type=password скрывает пароль; error добавляет текст ошибки и aria-invalid. labelAction позволяет поставить ссылку рядом с подписью. Возвращает DOM-элемент с input и методом setError(text). Логин остаётся обычным текстом: формат email не требуется.' } } },
  argTypes: {
    label: { control: 'text', description: 'Подпись поля' },
    type: { control: 'select', options: ['text', 'password', 'email'], description: 'Тип ввода' },
    placeholder: { control: 'text', description: 'Подсказка внутри пустого поля' },
    value: { control: 'text', description: 'Начальное демонстрационное значение' },
    error: { control: 'text', description: 'Текст ошибки' },
    hint: { control: 'text', description: 'Пояснение под полем' },
    disabled: { control: 'boolean', description: 'Недоступное поле' },
    required: { control: 'boolean', description: 'Обязательное поле' },
  },
  args: { label: 'Логин', type: 'text', placeholder: 'Например, Kuznetsova.Anna@tatar.ru', value: '', error: '', hint: '', disabled: false, required: true },
  render: args => wrap(ui.createTextField(args)),
};
export const Empty = { name: 'Пустое поле' };
export const Filled = { name: 'Заполненное поле', args: { value: 'Kuznetsova.Anna@tatar.ru' } };
export const Password = { name: 'Пароль', args: { label: 'Пароль', type: 'password', placeholder: 'Введите пароль', value: 'demo-password' }, argTypes: { value: { control: false, table: { disable: true } } } };
export const Email = { name: 'Электронная почта', args: { label: 'Электронная почта', type: 'email', placeholder: 'name@example.ru' } };
export const Error = { name: 'Ошибка', args: { error: 'Введите логин' } };
export const Disabled = { name: 'Недоступное поле', args: { disabled: true } };
export const Hint = { name: 'С пояснением', args: { hint: 'Используйте логин, выданный администратором.' } };
export const LongLabel = { name: 'Длинная подпись', args: { label: 'Логин сотрудника электронной лаборатории ветеринарно-санитарной экспертизы' } };
export const Focus = { name: 'В фокусе', play: ({ canvasElement }) => canvasElement.querySelector('input').focus() };
