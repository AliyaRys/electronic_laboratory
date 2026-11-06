import './tokens.css';
import './research-tone.css';

const rule = 'Карточка обязательного исследования («Органолептика», «Идентификация», «Температура в толще мышц») использует спокойный светло-синий тон: линия #c9d6ec (--app-mandatory-line), фон #f1f4fa (--app-mandatory-tint). Зелёный цвет зарезервирован за отметкой результата «Соответствует», красный — «Не соответствует»; ими обязательность полей не обозначается. Канонический источник значений — components/app/tokens.css.';

const createCard = ({ title, tone, marker }) => {
  const card = document.createElement('article');
  card.className = tone ? 'vse-mandatory-card' : 'vse-mandatory-card vse-mandatory-card--plain';
  const header = document.createElement('header');
  const titleNode = document.createElement('h3');
  titleNode.innerHTML = `${title} <span class="req" aria-hidden="true">*</span>`;
  const group = document.createElement('div');
  group.className = 'vse-mandatory-radio-group';
  const ok = document.createElement('span');
  ok.className = 'vse-mandatory-radio vse-mandatory-radio--ok';
  ok.textContent = 'Соответствует';
  const bad = document.createElement('span');
  bad.className = 'vse-mandatory-radio vse-mandatory-radio--bad';
  bad.textContent = 'Не соответствует';
  group.append(ok, bad);
  header.append(titleNode, group);
  if (marker) {
    const note = document.createElement('p');
    note.className = 'vse-mandatory-note';
    note.textContent = marker;
    card.append(header, note);
  } else {
    card.append(header);
  }
  return card;
};

const renderCatalog = () => {
  const app = document.createElement('div');
  app.className = 'vse-app';
  const catalog = document.createElement('section');
  catalog.className = 'vse-mandatory-catalog';
  const note = document.createElement('p');
  note.className = 'vse-icon-usage';
  note.textContent = rule;
  const grid = document.createElement('div');
  grid.className = 'vse-mandatory-grid';
  grid.append(
    createCard({ title: 'Органолептика', tone: true, marker: 'Обязательное исследование — светло-синий тон' }),
    createCard({ title: 'Идентификация', tone: true }),
    createCard({ title: 'Температура в толще мышц, °C', tone: true }),
    createCard({ title: 'Обычное исследование', tone: false, marker: 'Необязательное — без выделения' }),
  );
  catalog.append(note, grid);
  app.append(catalog);
  return app;
};

export default {
  id: 'mandatory-research-tone',
  title: 'Система/Тон обязательных исследований',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: { description: { component: 'Цветовое правило карточек обязательных исследований рабочих экранов: светло-синий тон выделения, зелёный — только для результата «Соответствует».' } },
  },
  render: renderCatalog,
};

export const Catalog = { name: 'Правило применения' };
