import { admin, renderAdminComponent } from './story-support.js';

export default {
  id: 'admin-access-editor',
  title: 'Администрирование/Компоненты/Редактор доступа',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Единый редактор пяти независимых прав и шести типов продукции. Используется формами создания и редактирования пользователя.' } } },
  render: args => renderAdminComponent(admin.createAccessEditor(args)),
};

export const Empty = { name: 'Пустой набор' };
export const Partial = { name: 'Частичный доступ', args: { permissions: ['vse_write', 'directory_edit'], products: ['meat', 'raw_milk'] } };
export const All = { name: 'Все права и продукция', args: { permissions: admin.permissions.map(item => item.code), products: admin.products.map(item => item.code) } };
export const RightsOnly = { name: 'Права без продукции', args: { permissions: ['vse_write', 'vse_delete'] } };
export const ProductsOnly = { name: 'Продукция без дополнительных прав', args: { products: ['fish', 'plant_food'] } };
export const Disabled = { name: 'Недоступный блок', args: { permissions: ['vse_write'], products: ['meat'], disabled: true } };
export const Narrow = { name: 'Узкий экран · 390 px', globals: { viewport: { value: 'mobile1', isRotated: false } } };
