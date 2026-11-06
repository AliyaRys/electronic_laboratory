import { ui, wrap, demoRecovery } from './story-support.js';

export default {
  id: 'auth-recovery-form', title: 'Вход/Восстановление пароля/Форма', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Составная форма использует общие createTextField(type=email) и createButton без копирования их разметки. Проверяет обязательность и формат адреса, блокирует повторную отправку и передаёт владельцу экрана onSubmit({email}). Методы: setBusy, setError; field и submitButton дают доступ к дочерним компонентам.' } } },
  argTypes: {
    email: { control: 'text', description: 'Начальный демонстрационный адрес' },
    busy: { control: 'boolean', description: 'Письмо отправляется' },
    disabled: { control: 'boolean', description: 'Форма недоступна' },
    error: { control: 'text', description: 'Ошибка у поля' },
  },
  args: { email: '', busy: false, disabled: false, error: '' },
  render: args => wrap(ui.createRecoveryForm({ ...args, onSubmit: demoRecovery }), 'auth-form-preview'),
};
export const Default = { name: 'Обычная форма' };
export const InvalidEmail = { name: 'Неверный адрес', args: { email: 'wrong-address', error: 'Проверьте адрес электронной почты.' } };
export const Loading = { name: 'Отправка письма', args: { email: 'anna@example.ru', busy: true } };
export const Disabled = { name: 'Форма недоступна', args: { disabled: true } };
export const LongEmail = { name: 'Длинный адрес', args: { email: 'specialist.veterinary.sanitary.expertise@regional-laboratory.example.ru' } };
