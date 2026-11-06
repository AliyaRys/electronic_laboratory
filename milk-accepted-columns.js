(() => {
  const table = document.querySelector('.accepted-table');
  const filter = document.getElementById('column-filter');
  if (!table || !filter) return;

  const trigger = document.getElementById('columns-trigger');
  const popover = document.getElementById('columns-popover');
  const checkboxes = [...popover.querySelectorAll('[data-column-toggle]')];
  const columns = [...table.querySelectorAll('colgroup col')];
  const header = table.tHead.rows[0];
  const rows = [...table.tBodies[0].rows];
  const hasComposition = columns.some(column => column.dataset.column === 'composition');
  const baseKeys = hasComposition
    ? ['date', 'number', 'owner', 'product', 'composition', 'amount', 'comparison', 'vse', 'cost', 'deadline', 'actions']
    : ['date', 'number', 'owner', 'product', 'amount', 'comparison', 'vse', 'cost', 'deadline', 'actions'];
  const widths = { date: 116, number: 160, owner: 106, product: 132, composition: 88, amount: 84, comparison: 106, vse: 100, cost: 72, deadline: 96, checkAuthor: 140, vseAuthor: 140, vseNumber: 95, actions: 126 };

  baseKeys.forEach((key, index) => {
    columns[index].dataset.column = key;
    header.cells[index].dataset.column = key;
    rows.forEach(row => { row.cells[index].dataset.column = key; });
  });

  const extras = [
    { key: 'checkAuthor', label: 'Автор сверки данных', value: row => row.dataset.checkAuthor },
    { key: 'vseAuthor', label: 'Автор ВСЭ', value: row => row.dataset.author },
    { key: 'vseNumber', label: 'Номер ВСЭ', value: row => row.dataset.vseNumber }
  ];
  const colgroup = table.querySelector('colgroup');
  const actionCol = columns.at(-1);
  const actionHead = header.cells[header.cells.length - 1];
  extras.forEach(({ key, label, value }) => {
    const col = document.createElement('col');
    col.dataset.column = key;
    colgroup.insertBefore(col, actionCol);

    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.column = key;
    th.textContent = label;
    header.insertBefore(th, actionHead);

    rows.forEach(row => {
      const td = document.createElement('td');
      td.dataset.column = key;
      const text = document.createElement('span');
      text.className = 'work-cell-text';
      text.textContent = value(row) || '—';
      text.title = text.textContent;
      td.append(text);
      row.insertBefore(td, row.lastElementChild);
    });
  });

  function updateColumns() {
    const visible = new Set(checkboxes.filter(box => box.checked).map(box => box.dataset.columnToggle));
    table.querySelectorAll('[data-column]').forEach(cell => {
      cell.classList.toggle('column-hidden', cell.dataset.column !== 'actions' && !visible.has(cell.dataset.column));
    });
    const totalWidth = [...visible].reduce((sum, key) => sum + widths[key], widths.actions);
    table.style.minWidth = `${Math.max(1100, totalWidth)}px`;
    checkboxes.forEach(box => { box.disabled = visible.size === 1 && box.checked; });
  }

  function closePopover(returnFocus = false) {
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }

  trigger.addEventListener('click', () => {
    const opening = popover.hidden;
    popover.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) checkboxes[0].focus();
  });
  checkboxes.forEach(box => box.addEventListener('change', updateColumns));
  document.addEventListener('click', event => {
    if (!popover.hidden && !filter.contains(event.target)) closePopover();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popover.hidden) {
      event.preventDefault();
      closePopover(true);
    }
  });
  updateColumns();
})();
