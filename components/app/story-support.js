import './Icon.js';
import './Button.js';
import './InfoField.js';
import './CompletedCheckStatus.js';
import './app.css';
import './evsd-check-values.css';

export const app = globalThis.VseApp;
export const wrapApp = (element, className = 'app-preview') => {
  const wrapper = document.createElement('div');
  wrapper.className = `vse-app ${className}`;
  wrapper.append(element);
  return wrapper;
};
export const delay = (duration = 600) => new Promise(resolve => setTimeout(resolve, duration));
