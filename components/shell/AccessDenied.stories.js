import { appHeader, logoSrc } from './story-support.js';
import '../app/app.css';
import './access-denied.css';
import './AccessDenied.js';

export const accessDenied = globalThis.VseAppHeader;

const renderPage = ({ mode = 'work', product = 'milk', ...options }) => {
  const page = document.createElement('div');
  page.className = 'vse-app access-denied-story-page';
  page.append(appHeader.create({
    mode,
    product,
    logoSrc,
    onProductChange: (nextProduct, header) => header.setProduct(nextProduct),
    onLogout: event => event.preventDefault(),
    links: mode === 'admin'
      ? { adminUsers: '#', profile: '#' }
      : { brand: '#', arrivals: '#', journal: '#', directories: '#', profile: '#' },
  }));
  page.append(accessDenied.createAccessDenied(options));
  page.querySelectorAll('main a, main button').forEach(node => {
    if (node.tagName === 'A') node.addEventListener('click', event => event.preventDefault());
  });
  return page;
};

export default {
  id: 'system-access-denied',
  title: 'Система/Экран отказа в доступе',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Один общий экран состояния «Нет доступа / доступ отозван» поверх действующей шапки. Причина задаётся кодом состояния, не текстом URL. Экран не показывает запрещённые данные и не предлагает сохранить несохранённое.',
      },
    },
  },
  argTypes: {
    reason: { control: 'inline-radio', options: ['no-permission', 'changed', 'product-denied', 'admin-page'], description: 'Код причины отказа' },
    checkState: { control: 'inline-radio', options: [undefined, 'checking', 'network-error'], description: 'Состояние проверки доступа' },
    hasAvailableProducts: { control: 'boolean', description: 'Осталась ли доступная продукция' },
    savedView: { control: 'boolean', description: 'Чтение объекта разрешено: ссылка на сохранённую версию' },
    mode: { control: 'inline-radio', options: ['work', 'admin'], description: 'Режим шапки' },
  },
  args: { reason: 'no-permission', hasAvailableProducts: true, savedView: false, mode: 'work' },
  render: args => renderPage(args),
};

export const NoPermission = { name: 'Нет права на раздел' };
export const NoPermissionWithSavedView = { name: 'Доступного чтения нет · Есть сохранённая версия', args: { savedView: true } };
export const Changed = { name: 'Доступ отозван во время работы', args: { reason: 'changed' } };
export const ChangedWithSavedView = { name: 'Отозвано только право действия', args: { reason: 'changed', savedView: true } };
export const ProductDenied = { name: 'Недоступный тип продукции', args: { reason: 'product-denied', product: 'meat' } };
export const NoProductsLeft = { name: 'Доступной продукции больше нет', args: { reason: 'product-denied', hasAvailableProducts: false } };
export const AdminPage = { name: 'Администратор открыл рабочую страницу', args: { reason: 'admin-page', mode: 'admin', product: 'meat' } };
export const Checking = { name: 'Загрузка проверки', args: { checkState: 'checking' } };
export const NetworkError = { name: 'Отказ проверки сети', args: { checkState: 'network-error' } };
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
