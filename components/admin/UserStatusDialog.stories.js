import { admin, renderAdminComponent } from './story-support.js';

const activeUser = {
  ...admin.createDemoUsers()[0],
  name: 'Алексеева Марина Викторовна',
  login: 'alekseeva.marina',
  status: 'active',
  activatedAt: '2026-10-20T09:42:00Z',
};
const blockedUser = { ...activeUser, status: 'blocked' };

const successAdapter = {
  setUserBlocked: async (id, blocked) => ({
    user: { ...activeUser, id, status: blocked ? 'blocked' : 'active' },
  }),
};

const renderDialog = ({ user = activeUser, adapter = successAdapter } = {}) => {
  const stage = renderAdminComponent(document.createElement('div'), '760px');
  const trigger = document.createElement('button');
  trigger.className = 'vse-app app-button secondary';
  trigger.textContent = user.status === 'blocked' ? 'Разблокировать пользователя' : 'Заблокировать пользователя';
  stage.replaceChildren(trigger);
  const dialog = admin.createUserStatusDialog({ adapter });
  stage.append(dialog);
  trigger.addEventListener('click', () => dialog.openFor({ user, trigger }));
  requestAnimationFrame(() => trigger.click());
  return stage;
};

export default {
  id: 'admin-user-status-dialog',
  title: 'Администрирование/Компоненты/Блокировка пользователя',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Один общий диалог для блокировки и разблокировки. До ответа адаптера статус не меняется; исходный фокус находится на «Отмена» и возвращается инициатору после закрытия.' } },
  },
  render: args => renderDialog(args),
};

export const Block = { name: 'Блокировка активного', args: { user: activeUser } };
export const Unblock = { name: 'Разблокировка заблокированного', args: { user: blockedUser } };
export const Submitting = {
  name: 'Отправка', args: { user: activeUser, adapter: { setUserBlocked: () => new Promise(() => {}) } },
  play: async ({ canvasElement }) => canvasElement.ownerDocument.querySelector('.admin-user-status-actions .danger')?.click(),
};
export const Failure = {
  name: 'Ошибка',
  args: { user: activeUser, adapter: { setUserBlocked: async () => { throw Object.assign(new Error('Сервис временно недоступен. Повторите попытку.'), { code: 'network' }); } } },
  play: async ({ canvasElement }) => canvasElement.ownerDocument.querySelector('.admin-user-status-actions .danger')?.click(),
};
export const Conflict = {
  name: 'Статус изменён в другом окне',
  args: { user: activeUser, adapter: { setUserBlocked: async () => { throw Object.assign(new Error('Состояние изменилось.'), { code: 'status-conflict', user: blockedUser }); } } },
  play: async ({ canvasElement }) => canvasElement.ownerDocument.querySelector('.admin-user-status-actions .danger')?.click(),
};
export const LongData = { name: 'Длинные сведения', args: { user: { ...activeUser, name: 'Алексеева-Миронова Марина Викторовна-Станиславовна', login: 'alekseeva-mironova.marina-viktorovna' } } };
export const Narrow = { name: 'Узкий экран · 390 px', args: { user: activeUser }, globals: { viewport: { value: 'mobile1', isRotated: false } } };
