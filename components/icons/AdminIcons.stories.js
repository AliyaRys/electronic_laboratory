import '../app/tokens.css';
import './VseIcon.js';
import './icons.css';

const labels = {
  'admin-users': 'Управление пользователями', 'admin-reports': 'Отчёты', 'admin-user-add': 'Добавить пользователя',
  'admin-edit': 'Редактировать', 'admin-lock': 'Блокировать', 'admin-unlock': 'Разблокировать',
  'admin-delete': 'Удалить', 'admin-dispose': 'Утилизация', 'admin-history': 'История', 'admin-invite': 'Приглашение',
  'admin-retry': 'Повторить', 'admin-clear': 'Очистить', 'admin-search': 'Поиск',
  'admin-more': 'Дополнительные действия', 'chevron-left': 'Предыдущая страница',
  'chevron-right': 'Следующая страница', 'admin-view': 'Посмотреть',
  'admin-download': 'Скачать', 'admin-print': 'Распечатать', 'admin-save': 'Сохранить',
  'admin-warning': 'Предупреждение',
};

export default {
  id: 'admin-icons',
  title: 'Администрирование/Иконки',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Единый набор административных иконок Lucide Static 1.60.0. Страницы и общая шапка получают SVG только через VseIcons.' } } },
  render: () => {
    const app = document.createElement('div');
    app.className = 'vse-app';
    const stage = document.createElement('div');
    stage.className = 'vse-icon-catalog';
    const note = document.createElement('p');
    note.className = 'vse-icon-usage';
    note.textContent = 'Ключ выбирается по назначению действия. SVG не копируется в страницу и не перерисовывается локально.';
    const grid = document.createElement('div');
    grid.className = 'vse-icon-grid';
    VseIcons.listAdminIcons().forEach(name => {
      const item = document.createElement('div');
      item.className = 'vse-icon-card';
      const icon = document.createElement('span');
      icon.className = 'section-icon';
      icon.append(VseIcons.create(name));
      const copy = document.createElement('div');
      copy.append(Object.assign(document.createElement('strong'), { textContent: labels[name] }), Object.assign(document.createElement('code'), { textContent: name }));
      item.append(icon, copy);
      grid.append(item);
    });
    stage.append(note, grid);
    app.append(stage);
    return app;
  },
};

export const Registry = { name: 'Карта назначения' };
