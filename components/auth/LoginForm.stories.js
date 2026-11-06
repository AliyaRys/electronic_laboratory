import { ui, wrap, preventNavigation, demoSuccess, demoFailure, demoNetworkFailure } from './story-support.js';

export default {
  id: 'auth-form', title: 'Вход/Форма входа', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Собрана из createTextField, createButton и createTextLink. Пустые поля получают ошибки; фокус переходит к первому из них. onSubmit({login,password}) задаёт действие владельца экрана и может вернуть {error} или {message}. Пароли не сохраняются и не попадают в адрес страницы. Здесь только демонстрационные обработчики: заполните поля и нажмите «Войти». Методы: setBusy, setError, setStatus; fields содержит поля.' } } },
  argTypes: { busy: { control: 'boolean' }, disabled: { control: 'boolean' }, error: { control: 'text' } },
  args: { busy: false, disabled: false, error: '' },
  render: args => wrap(ui.createLoginForm({ ...args, onSubmit: demoSuccess, onRecover: preventNavigation }), 'auth-form-preview'),
};
export const Default = { name: 'Обычная форма' };
export const EmptySubmit = { name: 'Пустые обязательные поля', play: ({ canvasElement }) => canvasElement.querySelector('form').requestSubmit() };
export const Loading = { name: 'Вход выполняется', args: { busy: true } };
export const Disabled = { name: 'Форма недоступна', args: { disabled: true } };
export const InvalidCredentials = { name: 'Неверные данные', args: { error: 'Неверный логин или пароль. Проверьте данные и попробуйте снова.' }, render: args => wrap(ui.createLoginForm({ ...args, onSubmit: demoFailure, onRecover: preventNavigation }), 'auth-form-preview') };
export const Retry = { name: 'Ошибка соединения и повтор', render: args => wrap(ui.createLoginForm({ ...args, onSubmit: demoNetworkFailure, onRecover: preventNavigation }), 'auth-form-preview') };
