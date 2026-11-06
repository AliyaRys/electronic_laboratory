import '../app/tokens.css';
import './VseIcon.js';
import './icons.css';

const icons = globalThis.VseIcons;

const createCard = ({ icon, label }) => {
  const card = document.createElement('article');
  card.className = 'vse-icon-card';
  const slot = document.createElement('span');
  slot.className = 'section-icon';
  slot.append(icons.create(icon));
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = label;
  const code = document.createElement('code');
  code.textContent = icon;
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
  note.textContent = 'Иконки справочников системы. Иконка выбирается по назначению справочника; SVG не копируется в страницу и не перерисовывается локально.';
  const grid = document.createElement('div');
  grid.className = 'vse-icon-grid';
  icons.listDirectoryIcons().forEach(item => grid.append(createCard(item)));
  catalog.append(note, grid);
  app.append(catalog);
  return app;
};

export default {
  id: 'directory-icons',
  title: 'Система/Иконки справочников',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: { description: { component: 'Каноническая карта иконок справочников. Ключ закреплён в реестре VseIcons и одинаков для мясных и молочных макетов.' } },
  },
  render: renderCatalog,
};

export const Catalog = { name: 'Карта применения' };
