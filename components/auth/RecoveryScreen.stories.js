import { ui, preventNavigation, demoRecovery } from './story-support.js';

export default {
  id: 'auth-recovery-screen', title: 'Вход/Восстановление пароля/Экраны', tags: ['autodocs'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Два макета восстановления на одном общем компоненте: форма ввода адреса и нейтральное подтверждение. Экран повторно использует общий фон авторизации, поле, кнопку и ссылку назад. В подтверждении не раскрывается, существует ли такая учётная запись.' } } },
  argTypes: {
    mode: { control: 'select', options: ['form', 'sent'], description: 'Форма или подтверждение' },
    email: { control: 'text', description: 'Адрес для формы или подтверждения' },
    busy: { control: 'boolean', description: 'Состояние отправки формы' },
    error: { control: 'text', description: 'Ошибка поля формы' },
  },
  args: { mode: 'form', email: '', busy: false, error: '' },
  render: args => ui.createRecoveryScreen({ ...args, onSubmit: demoRecovery, onBack: preventNavigation }),
};
export const Request = { name: 'Введите почту' };
export const RequestLoading = { name: 'Письмо отправляется', args: { email: 'anna@example.ru', busy: true } };
export const Sent = { name: 'Письмо отправлено', args: { mode: 'sent', email: 'anna@example.ru' } };
export const SentWithoutEmail = { name: 'Подтверждение без адреса', args: { mode: 'sent' } };
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
