import { appHeader, logoSrc } from './story-support.js';
import '../app/app.css';
import './access-denied.css';
import './no-products.css';
import './NoProducts.js';

export const noProducts = globalThis.VseAppHeader;

const renderPage = options => {
  const page = document.createElement('div');
  page.className = 'vse-app no-products-story-page';
  page.append(appHeader.create({
    mode: 'no-products',
    logoSrc,
    links: { brand: '#', profile: '#' },
    onLogout: event => event.preventDefault(),
  }));
  page.append(noProducts.createNoProducts(options));
  page.querySelectorAll('main a, main button').forEach(node => {
    if (node.tagName === 'A') node.addEventListener('click', event => event.preventDefault());
  });
  return page;
};

export default {
  id: 'system-no-products',
  title: 'Система/Типы продукции не назначены',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Экран состояния активного обычного пользователя без назначенных типов продукции: общая шапка в документированном режиме no-products, спокойный блок, профиль и проверка доступа. Пять прав сами по себе доступ к продукции не заменяют; экана для администратора не существует.',
      },
    },
  },
  argTypes: {
    state: { control: 'inline-radio', options: ['idle', 'checking', 'unchanged', 'network-error', 'assigned', 'unimplemented', 'revoked'], description: 'Состояние экрана' },
    permissions: { control: 'boolean', description: 'Есть ли дополнительные права (для пояснения)' },
    unimplementedLabel: { control: 'text', description: 'Полное название неготового направления' },
    onCheck: { control: 'select', options: ['unchanged', 'error', 'assigned'], description: 'Демонстрационный обработчик проверки' },
  },
  args: { state: 'idle', permissions: false, unimplementedLabel: '', onCheck: 'unchanged' },
  render: ({ state, permissions, unimplementedLabel, onCheck }) => {
    const handlers = {
      unchanged: async () => ({}),
      error: async () => ({ error: true }),
      assigned: async () => ({ message: 'Администратор назначил тип продукции. Обновляем шапку и открываем доступный раздел.' }),
    };
    return renderPage({
      state,
      permissions: permissions ? ['vse_write', 'vse_delete'] : [],
      unimplementedLabel,
      onCheck: handlers[onCheck] ?? handlers.unchanged,
    });
  },
};

export const NothingAssigned = { name: 'Продукция не назначена' };
export const RightsWithoutProducts = { name: 'Права есть · продукции нет', args: { permissions: true } };
export const Checking = { name: 'Проверка идёт', args: { state: 'checking' } };
export const Unchanged = { name: 'Проверка без изменений', args: { state: 'unchanged' } };
export const CheckError = { name: 'Ошибка проверки · повтор', args: { state: 'network-error' } };
export const Assigned = { name: 'Тип назначен', args: { state: 'assigned' } };
export const Unimplemented = {
  name: 'Назначено только неготовое направление',
  args: { state: 'unimplemented', unimplementedLabel: 'Мёд, перга и молочко маточное пчелиное', permissions: true },
};
export const Revoked = { name: 'Последний тип отозван', args: { state: 'revoked', permissions: true } };
export const LongInstitution = {
  name: 'Длинное учреждение',
  render: args => {
    const page = document.createElement('div');
    page.className = 'vse-app no-products-story-page';
    page.append(appHeader.create({
      mode: 'no-products',
      logoSrc,
      institution: 'Государственная бюджетная ветеринарная лаборатория по надзору в племенном животноводстве и репродуктивных технологиях',
      links: { brand: '#', profile: '#' },
      onLogout: event => event.preventDefault(),
    }));
    page.append(noProducts.createNoProducts({ state: args.state, permissions: args.permissions ? ['vse_write'] : [] }));
    page.querySelectorAll('main a').forEach(node => node.addEventListener('click', event => event.preventDefault()));
    return page;
  },
};
export const Narrow = { name: 'Узкий экран', globals: { viewport: { value: 'mobile1', isRotated: false } } };
