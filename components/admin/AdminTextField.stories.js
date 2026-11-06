import { admin, renderAdminComponent } from './story-support.js';

export default {
  id: 'admin-text-field',
  title: 'Администрирование/Компоненты/Поле формы',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Редактируемое поле рабочих административных форм. Поддерживает подпись, подсказку, ошибку, обязательность и недоступное состояние.' } } },
  args: { label: 'Логин', value: '', required: true, hint: 'Можно использовать логин, который не является email.', disabled: false },
  render: args => renderAdminComponent(admin.createTextField({ id: 'field-story', ...args }), '460px'),
};

export const Default = { name: 'Обычное' };
export const Filled = { name: 'Заполненное', args: { value: 'ivanova.maria' } };
export const Disabled = { name: 'Недоступное', args: { value: 'ivanova.maria', disabled: true } };
export const Error = {
  name: 'Ошибка',
  render: args => {
    const field = admin.createTextField({ id: 'field-error-story', ...args });
    field.setError('Пользователь с таким логином уже существует.');
    return renderAdminComponent(field, '460px');
  },
};
