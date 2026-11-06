import { app, wrapApp, delay } from '../app/story-support.js';
import './ProfileSummary.js';
import './PasswordChangeForm.js';
import './ProfileScreen.js';
import './profile.css';

export { app, wrapApp };
export const profile = globalThis.VseProfile;
export const demoPasswordChange = async () => { await delay(); };
export const demoPasswordFailure = async () => { await delay(); return { error: 'Не удалось сменить пароль. Проверьте данные и попробуйте снова.' }; };

export const adminProfileUser = {
  name: 'Елена Морозова',
  login: 'Morozova.Elena@tatar.ru',
  initials: 'ЕМ',
  city: 'г. Казань',
  role: 'Администратор',
  registeredAt: '05.02.2024',
  permissions: [
    'Создание и редактирование пользователей',
    'Блокировка и разблокировка',
    'Сброс паролей',
    'Редактирование справочников',
  ],
  products: [],
};
