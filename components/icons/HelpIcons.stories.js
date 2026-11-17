import '../app/tokens.css';
import './VseIcon.js';
import './icons.css';

export default {
  id: 'help-icons',
  title: 'Рабочие экраны/Справочные иконки',
  tags: ['autodocs'],
  parameters: { docs: { description: { component: 'Иконки доступных подсказок (ТЗ DR44 §3). SVG берётся только из реестра VseIcon.js.' } } },
  render: () => {
    const app = document.createElement('div');
    app.className = 'vse-app';
    const stage = document.createElement('div');
    stage.className = 'vse-icon-catalog';
    const note = document.createElement('p');
    note.className = 'vse-icon-usage';
    note.textContent = 'Справочная иконка используется внутри доступной подсказки; SVG не копируется в страницу.';
    const grid = document.createElement('div');
    grid.className = 'vse-icon-grid';
    VseIcons.listHelpIcons().forEach(({ icon, label }) => {
      const item = document.createElement('div');
      item.className = 'vse-icon-card';
      const slot = document.createElement('span');
      slot.className = 'section-icon';
      slot.append(VseIcons.create(icon, { label }));
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
