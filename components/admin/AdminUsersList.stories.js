import { admin, renderUsersList } from './story-support.js';

export default {
  id: 'admin-users-list',
  title: 'Администрирование/Экраны/Список пользователей',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Канонический список обычных пользователей одной лаборатории: поиск, комбинированные фильтры, стабильная сортировка, действия и пагинация по 20 записей.' } },
  },
  render: args => renderUsersList(args),
};

export const Filled = { name: 'Заполненный список' };
export const Loading = { name: 'Первоначальная загрузка', args: { initialState: 'loading' } };
export const Error = { name: 'Ошибка загрузки', args: { initialState: 'error' } };
export const Empty = { name: 'Пользователей ещё нет', args: { users: [] } };
export const NoMatches = {
  name: 'Поиск без совпадений',
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector('#admin-user-search');
    input.value = 'несуществующий пользователь';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },
};
export const SecondPage = {
  name: 'Вторая страница',
  play: async ({ canvasElement }) => canvasElement.querySelector('[aria-label="Следующая страница"]')?.click(),
};
export const LongData = {
  name: 'Длинные данные',
  args: {
    users: admin.createDemoUsers().map((user, index) => index ? user : {
      ...user,
      name: 'Алексеева-Миронова Марина Викторовна-Станиславовна',
      login: 'alekseeva-mironova.marina-viktorovna',
      products: admin.products.map(product => product.code),
    }),
  },
};
export const MenuOpen = {
  name: 'Меню действий открыто',
  play: async ({ canvasElement }) => canvasElement.querySelector('.admin-actions-menu')?.setAttribute('open', ''),
};
export const Narrow = {
  name: 'Узкий экран · 390 px',
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
