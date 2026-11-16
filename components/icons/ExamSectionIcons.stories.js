import '../app/tokens.css';
import './VseIcon.js';
import './icons.css';

export default {
  id: 'exam-section-icons',
  title: 'Карточка ВСЭ/Иконки',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Иконки разделов карточки ВСЭ (DR30). SVG берётся только из реестра VseIcon.js.' } } },
  render: () => {
    const app = document.createElement('div');
    app.className = 'vse-app';
    const stage = document.createElement('div');
    stage.className = 'vse-icon-catalog';
    const note = document.createElement('p');
    note.className = 'vse-icon-usage';
    note.textContent = 'Ключ выбирается по назначению раздела. SVG не копируется в страницу и не перерисовывается локально.';
    const grid = document.createElement('div');
    grid.className = 'vse-icon-grid';
    VseIcons.listExamSectionIcons().forEach(({ icon, label }) => {
      const item = document.createElement('div');
      item.className = 'vse-icon-card';
      const slot = document.createElement('span');
      slot.className = 'section-icon';
      slot.append(VseIcons.create(icon));
      const copy = document.createElement('div');
      copy.append(Object.assign(document.createElement('strong'), { textContent: label }), Object.assign(document.createElement('code'), { textContent: icon }));
      item.append(slot, copy);
      grid.append(item);
    });
    stage.append(note, grid);
    app.append(stage);
    return app;
  },
};

export const Registry = { name: 'Карта назначения' };
