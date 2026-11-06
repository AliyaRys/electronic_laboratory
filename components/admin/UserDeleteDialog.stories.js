import { admin, renderAdminComponent } from './story-support.js';

const base = { ...admin.createDemoUsers()[0], linkedDocumentCount: 0 };
const linked = { ...admin.createDemoUsers()[4], linkedDocumentCount: 3 };
const linkedBlocked = { ...linked, status: 'blocked' };
const wait = duration => new Promise(resolve => setTimeout(resolve, duration));
const adapter = ({ count = 0, checkError = false, deleteError = false, race = false, pendingCheck = false, pendingDelete = false } = {}) => ({
  checkUserDeletion: async id => {
    if (pendingCheck) return new Promise(() => {});
    await wait(40);
    if (checkError) throw Object.assign(new Error('Не удалось проверить связанные документы.'), { code: 'network' });
    const user = count ? { ...linked, id, linkedDocumentCount: count } : { ...base, id, linkedDocumentCount: 0 };
    return { user, linkedDocumentCount: count };
  },
  deleteUser: async (id, options) => {
    if (pendingDelete) return new Promise(() => {});
    await wait(40);
    if (race) throw Object.assign(new Error('Появился документ.'), { code: 'linked-documents', user: { ...base, id, linkedDocumentCount: 1 }, linkedDocumentCount: 1 });
    if (deleteError) throw Object.assign(new Error('Не удалось удалить пользователя.'), { code: 'network' });
    return { user: { ...base, id, deleted: true }, operationId: options.operationId };
  },
});

const renderDialog = ({ user = base, adapter: dataAdapter = adapter(), autoDelete = false } = {}) => {
  const stage = renderAdminComponent(document.createElement('div'), '760px');
  const trigger = document.createElement('button');
  trigger.className = 'vse-app app-button secondary';
  trigger.textContent = 'Удалить пользователя';
  const effectiveAdapter = {
    ...dataAdapter,
    checkUserDeletion: async id => {
      const result = await dataAdapter.checkUserDeletion(id);
      return { ...result, user: { ...result.user, status: user.status, activatedAt: user.activatedAt } };
    },
  };
  const dialog = admin.createUserDeleteDialog({ adapter: effectiveAdapter });
  stage.replaceChildren(trigger, dialog);
  trigger.addEventListener('click', () => dialog.openFor({ user, trigger }));
  requestAnimationFrame(async () => {
    trigger.click();
    if (autoDelete) {
      await wait(90);
      dialog.querySelector('.admin-user-delete-actions .danger')?.click();
    }
  });
  return stage;
};

export default {
  id: 'admin-user-delete-dialog', title: 'Администрирование/Компоненты/Удаление пользователя', tags: ['autodocs'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Общий диалог сначала проверяет связи. Удаление доступно только для обычного пользователя своей лаборатории без рабочих документов; при связях предлагается блокировка с сохранением авторства.' } } },
  render: args => renderDialog(args),
};
export const Checking = { name: 'Проверка связей', args: { user: base, adapter: adapter({ pendingCheck: true }) } };
export const Allowed = { name: 'Связей нет', args: { user: base, adapter: adapter() } };
export const Linked = { name: 'Есть связанные документы', args: { user: linked, adapter: adapter({ count: 3 }) } };
export const LinkedBlocked = { name: 'Связи · уже заблокирован', args: { user: linkedBlocked, adapter: adapter({ count: 3 }) } };
export const CheckFailure = { name: 'Ошибка проверки', args: { user: base, adapter: adapter({ checkError: true }) } };
export const Deleting = { name: 'Удаление', args: { user: base, adapter: adapter({ pendingDelete: true }), autoDelete: true } };
export const DeleteFailure = { name: 'Ошибка удаления', args: { user: base, adapter: adapter({ deleteError: true }), autoDelete: true } };
export const NewDocument = { name: 'Документ появился при подтверждении', args: { user: base, adapter: adapter({ race: true }), autoDelete: true } };
export const LongData = { name: 'Длинные сведения', args: { user: { ...base, name: 'Алексеева-Миронова Марина Викторовна-Станиславовна', login: 'alekseeva-mironova.marina-viktorovna' }, adapter: adapter() } };
export const Narrow = { name: 'Узкий экран · 390 px', args: { user: base, adapter: adapter() }, globals: { viewport: { value: 'mobile1', isRotated: false } } };
