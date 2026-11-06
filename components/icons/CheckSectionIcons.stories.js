import '../app/tokens.css';
import './VseIcon.js';
import './icons.css';

const icons = globalThis.VseIcons;

const createCard = ({ icon, label, key = '' }) => {
  const card = document.createElement('article');
  card.className = 'vse-icon-card';
  const slot = document.createElement('span');
  slot.className = 'section-icon';
  slot.append(icons.create(icon));
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = label;
  const code = document.createElement('code');
  code.textContent = key ? `${key} → ${icon}` : icon;
  copy.append(title, code);
  card.append(slot, copy);
  return card;
};

const renderCatalog = () => {
  const app = document.createElement('div');
  app.className = 'vse-app';
  const catalog = document.createElement('section');
  catalog.className = 'vse-icon-catalog';
  const note = document.createElement('p');
  note.className = 'vse-icon-usage';
  note.textContent = 'Иконка выбирается по назначению блока, а не по типу продукции. Мясные, молочные и будущие сверки используют эту же карту.';
  const grid = document.createElement('div');
  grid.className = 'vse-icon-grid';
  icons.listCheckSections().forEach(({ key, icon, label }) => {
    grid.append(createCard({ key, icon, label }));
  });
  const actionTitle = document.createElement('h2');
  actionTitle.textContent = 'Действия и состояния';
  const actionGrid = document.createElement('div');
  actionGrid.className = 'vse-icon-grid';
  icons.listCheckActions().forEach(action => actionGrid.append(createCard(action)));
  catalog.append(note, grid, actionTitle, actionGrid);
  app.append(catalog);
  return app;
};

export default {
  id: 'check-section-icons',
  title: 'Сверка данных/Компоненты/Иконки сверки',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: { description: { component: 'Каноническая карта иконок разделов сверки. Ключ блока закреплён в разметке через data-check-section и одинаков для всех типов продукции.' } },
  },
  render: renderCatalog,
};

export const Catalog = { name: 'Карта применения' };
export const Narrow = { name: 'Узкий экран', parameters: { viewport: { defaultViewport: 'mobile1' } } };
