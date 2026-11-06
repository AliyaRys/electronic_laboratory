import { admin, renderUserHistory } from './story-support.js';

const user = { id: 'u-story', name: 'Алексеева Марина Викторовна', login: 'alekseeva.marina' };
const allRights = admin.permissions.map(item => item.label);
const allProducts = admin.products.map(item => item.label);
const events = [
  { id: 'h-8', type: 'unblocked', at: '2026-10-20T12:40:00+03:00', actor: 'Елена Морозова', previousStatus: 'blocked', status: 'active' },
  { id: 'h-7', type: 'blocked', at: '2026-10-20T09:10:00+03:00', actor: 'Елена Морозова', previousStatus: 'active', status: 'blocked' },
  { id: 'h-6', type: 'update', at: '2026-10-19T16:25:00+03:00', actor: 'Елена Морозова', changes: [
    { kind: 'field', label: 'Должность', before: 'Ветеринарный фельдшер', after: 'Ветеринарный врач' },
    { kind: 'permissions', added: allRights, removed: [] },
    { kind: 'products', added: allProducts, removed: [] },
  ] },
  { id: 'h-2', type: 'created', at: '2026-10-18T10:00:00+03:00', actor: 'Елена Морозова', permissions: [], products: ['Мясо и продукты убоя животных'] },
];

export default {
  id: 'admin-user-history',
  title: 'Администрирование/Экраны/История пользователя',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Read only история одного пользователя: стабильная сортировка, фильтр типов событий, составной diff, пагинация и состояние удалённой записи. Пароли в события не включаются.' } },
  },
  render: args => renderUserHistory({ user, events, ...args }),
};

export const Filled = { name: 'Несколько событий' };
export const Empty = { name: 'Пустая история', args: { events: [] } };
export const Loading = { name: 'Загрузка', args: { initialState: 'loading' } };
export const Error = { name: 'Ошибка с повтором', args: { initialState: 'error', onRetry: component => component.setViewState('ready') } };
export const NoMatches = {
  name: 'Фильтр без результатов',
  play: ({ canvasElement }) => {
    const select = canvasElement.querySelector('#admin-history-filter');
    select.value = 'deletion';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },
};
export const FullAccessChange = { name: 'Составное изменение всех прав и продукции', args: { events: [events[2]] } };
export const Deleted = {
  name: 'Удалённый пользователь',
  args: { user: { ...user, deleted: true }, events: [{ id: 'deleted', type: 'deleted', at: '2026-10-21T08:15:00+03:00', actor: 'Елена Морозова', userId: user.id, userName: user.name, previousStatus: 'active' }, ...events] },
};
export const LongData = {
  name: 'Длинные данные',
  args: {
    user: { ...user, name: 'Алексеева-Миронова Марина Викторовна-Станиславовна', login: 'alekseeva-mironova.marina-viktorovna' },
    events: [{ ...events[2], actor: 'Главный системный администратор межрайонного ветеринарного объединения Республики Татарстан' }],
  },
};
export const SecondPage = {
  name: 'Вторая страница',
  args: { events: Array.from({ length: 23 }, (_, index) => ({ ...events[0], id: `page-${index}`, at: new Date(Date.parse('2026-10-20T12:40:00+03:00') - index * 60000).toISOString() })) },
  play: ({ canvasElement }) => canvasElement.querySelector('[aria-label="Следующая страница"]')?.click(),
};
export const Narrow = { name: 'Узкий экран · 390 px', globals: { viewport: { value: 'mobile1', isRotated: false } } };
