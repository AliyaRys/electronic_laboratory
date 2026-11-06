import { admin, renderAdminComponent } from './story-support.js';

const successAdapter = {
  createUser: async payload => {
    await new Promise(resolve => setTimeout(resolve, 700));
    return { user: { id: 'story-user', ...payload } };
  },
};
const errorAdapter = {
  createUser: async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    throw new Error('Не удалось создать пользователя. Повторите попытку.');
  },
};
const duplicateAdapter = {
  createUser: async () => {
    throw Object.assign(new Error('Проверьте уникальность логина и email.'), { fields: { login: 'Пользователь с таким логином уже существует.' } });
  },
};
const duplicateEmailAdapter = {
  createUser: async () => {
    throw Object.assign(new Error('Проверьте уникальность логина и email.'), { fields: { email: 'Пользователь с таким email уже существует.' } });
  },
};
const pendingAdapter = { createUser: () => new Promise(() => {}) };

const renderForm = args => {
  const stage = document.createElement('div');
  const message = document.createElement('div');
  const form = admin.createUserForm({
    adapter: successAdapter,
    ...args,
    onCreated: result => { message.className = 'admin-feedback'; message.textContent = `Пользователь создан. Логин для входа: ${result.user.login}.`; },
  });
  stage.append(message, form);
  return renderAdminComponent(stage);
};

export default {
  id: 'admin-create-user-form',
  title: 'Администрирование/Блоки/Форма создания пользователя',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Форма создания обычного пользователя своей лаборатории: логин и пароль задаёт администратор, пользователь входит по ним без приглашения и активации. Роль, выбор лаборатории и административные полномочия отсутствуют.' } } },
  render: args => renderForm(args),
};

export const Empty = { name: 'Пустая форма' };
export const Filled = { name: 'Заполненная', args: { values: { name: 'Мария Иванова', login: 'ivanova.maria', email: 'maria.ivanova@example.test', position: 'Ветеринарный врач' }, access: { permissions: ['vse_write', 'directory_edit'], products: ['meat', 'raw_milk'] } } };
export const WithoutProducts = { name: 'Без продукции', args: { values: Filled.args.values, access: { permissions: ['vse_write'] } } };
export const WithoutRights = { name: 'Без дополнительных прав', args: { values: Filled.args.values, access: { products: ['fish'] } } };
export const RequiredErrors = {
  name: 'Ошибки обязательных полей',
  play: async ({ canvasElement }) => canvasElement.querySelector('form')?.requestSubmit(),
};
export const DuplicateLogin = { name: 'Логин занят', args: { ...Filled.args, adapter: duplicateAdapter } };
export const DuplicateEmail = { name: 'Email занят', args: { ...Filled.args, adapter: duplicateEmailAdapter } };
export const Creating = {
  name: 'Создание',
  args: { ...Filled.args, adapter: pendingAdapter },
  play: async ({ canvasElement }) => canvasElement.querySelector('form')?.requestSubmit(),
};
export const CreateError = { name: 'Ошибка создания', args: { ...Filled.args, adapter: errorAdapter } };
export const LongData = { name: 'Длинные данные', args: { values: { name: 'Алексеева-Миронова Марина Викторовна-Станиславовна', login: 'alekseeva-mironova.marina-viktorovna', email: 'marina.alekseeva-mironova@example.test', position: 'Ведущий ветеринарный врач отдела ветеринарно-санитарной экспертизы' }, access: { products: ['raw_milk'], permissions: ['vse_write'] } } };
export const Narrow = { name: 'Узкий экран · 390 px', globals: { viewport: { value: 'mobile1', isRotated: false } } };
