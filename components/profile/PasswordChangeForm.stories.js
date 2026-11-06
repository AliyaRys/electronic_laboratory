import { profile, wrapApp, demoPasswordChange, demoPasswordFailure } from './story-support.js';

export default {
  id: 'profile-password-form', title: 'Профиль/Смена пароля', tags: ['autodocs'],
  parameters: { layout: 'centered', docs: { description: { component: 'Раскрываемая форма для смены пароля в профиле. Поля скрыты до действия пользователя, используют корректный autocomplete, показывают связанные ошибки и блокируют повторную отправку. Пароли не сохраняются и не выводятся в уведомления.' } } },
  argTypes: { open: { control: 'boolean' }, busy: { control: 'boolean' }, disabled: { control: 'boolean' }, error: { control: 'text' } },
  args: { open: false, busy: false, disabled: false, error: '' },
  render: args => wrapApp(profile.createPasswordChangeForm({ ...args, onSubmit: demoPasswordChange }), 'profile-password-preview'),
};
export const Closed = { name: 'Закрытая' };
export const Open = { name: 'Открытая', args: { open: true } };
export const EmptySubmit = { name: 'Пустые обязательные поля', args: { open: true }, play: ({ canvasElement }) => canvasElement.querySelector('form').requestSubmit() };
export const Loading = { name: 'Сохранение', args: { open: true, busy: true } };
export const Failure = { name: 'Ошибка сохранения', args: { open: true, error: 'Не удалось сменить пароль. Проверьте данные и попробуйте снова.' }, render: args => wrapApp(profile.createPasswordChangeForm({ ...args, onSubmit: demoPasswordFailure }), 'profile-password-preview') };
