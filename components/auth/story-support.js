import './TextField.js';
import './Button.js';
import './TextLink.js';
import './AuthPage.js';
import './LoginForm.js';
import './LoginScreen.js';
import './RecoveryForm.js';
import './RecoveryScreen.js';
import './auth.css';

export const ui = globalThis.VseAuth;
export const wrap = (element, className = 'auth-preview') => {
  const wrapper = document.createElement('div');
  wrapper.className = `vse-auth ${className}`;
  wrapper.append(element);
  return wrapper;
};
// Examples never leave Storybook or make authentication requests.
export const preventNavigation = event => event.preventDefault();
const delay = () => new Promise(resolve => setTimeout(resolve, 600));
export const demoSuccess = async () => { await delay(); return { message: 'Форма заполнена. Это демонстрационный пример.' }; };
export const demoFailure = async () => { await delay(); return { error: 'Неверный логин или пароль. Проверьте данные и попробуйте снова.' }; };
export const demoNetworkFailure = async () => { await delay(); throw new Error('Demo connection failure'); };
export const demoRecovery = async () => { await delay(); };
