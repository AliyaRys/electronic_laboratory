(() => {
  const api = globalThis.VseSampleAccounting ||= {};
  const PAGE_SIZE = 20;
  const SCREEN_STATE_KEY = 'vse-sample-accounting-screen-state-v1';
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  };
  const icon = name => globalThis.VseIcons.create(name, { className: 'admin-icon' });
  const appButton = options => globalThis.VseApp.createButton(options);
  const weight = value => `${Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} кг`;
  const toIso = value => value && value !== '—' ? value.split('.').reverse().join('-') : '';
  const today = () => {
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  };
  const displayDate = value => value ? value.split('-').reverse().join('.') : '';

  const feedback = (root, message, tone = 'status') => {
    const region = root.querySelector('[data-sample-feedback]');
    region.hidden = false;
    region.className = `sample-feedback ${tone}`;
    region.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    region.textContent = message;
  };

  const addCell = (row, label, content, className = '') => {
    const cell = make('td', className);
    cell.dataset.label = label;
    if (content instanceof Node) cell.append(content); else cell.textContent = content;
    row.append(cell);
    return cell;
  };

  const createPagination = (total, page, onChange) => {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const nav = make('nav', 'pagination');
    nav.setAttribute('aria-label', 'Пагинация журнала');
    const previous = make('button', 'page-arrow'); previous.type = 'button'; previous.disabled = page <= 1; previous.setAttribute('aria-label', 'Предыдущая страница'); previous.textContent = '‹';
    const current = make('button', 'page-button', String(page)); current.type = 'button'; current.setAttribute('aria-current', 'page');
    const next = make('button', 'page-arrow'); next.type = 'button'; next.disabled = page >= pages; next.setAttribute('aria-label', 'Следующая страница'); next.textContent = '›';
    previous.addEventListener('click', () => onChange(page - 1)); next.addEventListener('click', () => onChange(page + 1));
    nav.append(previous, current, next);
    return nav;
  };

  api.createDisposalDialog = ({ onSaved } = {}) => {
    const dialog = make('dialog', 'sample-disposal-dialog');
    const box = make('div', 'sample-disposal-box');
    const head = make('div', 'sample-disposal-head');
    const heading = make('h2', '', 'Утилизация остатка'); heading.id = `sample-disposal-title-${Math.random().toString(36).slice(2)}`;
    const close = make('button', 'sample-dialog-close'); close.type = 'button'; close.setAttribute('aria-label', 'Закрыть'); close.append(icon('admin-clear'));
    head.append(heading, close);
    const description = make('p', 'sample-disposal-description', 'Регистрируется утилизация всего актуального остатка выбранного вида продукции.');
    const form = make('form', 'sample-disposal-form'); form.noValidate = true;
    const facts = make('div', 'sample-disposal-facts');
    const fields = make('div', 'sample-disposal-fields');
    const dateField = make('label', 'sample-form-field'); dateField.append(make('span', '', 'Дата утилизации *'));
    const date = make('input'); date.type = 'date'; date.required = true; date.id = 'sample-disposal-date'; dateField.append(date);
    const vsdField = make('label', 'sample-form-field'); vsdField.append(make('span', '', 'Номер исходящего ВСД *'));
    const vsd = make('input'); vsd.type = 'text'; vsd.required = true; vsd.id = 'sample-disposal-vsd'; vsd.placeholder = 'Введите номер документа из «Меркурия»'; vsdField.append(vsd);
    const fieldError = make('div', 'sample-dialog-error'); fieldError.id = `sample-disposal-error-${Math.random().toString(36).slice(2)}`; fieldError.hidden = true; fieldError.setAttribute('role', 'alert');
    fields.append(dateField, vsdField, fieldError);
    const note = make('p', 'sample-disposal-note', 'Исходящий ВСД оформляется в системе «Меркурий». В этом окне регистрируется уже оформленный документ.');
    const actions = make('div', 'sample-disposal-actions');
    const cancel = appButton({ label: 'Отмена', variant: 'secondary', type: 'button' });
    const dispose = appButton({ label: 'Утилизировать', busyLabel: 'Утилизируем…', variant: 'primary', type: 'submit' });
    actions.append(cancel, dispose);
    form.append(facts, fields, note, actions);
    box.append(head, description, form); dialog.append(box);
    dialog.setAttribute('aria-labelledby', heading.id);
    let current = null; let opener = null; let pending = false;

    const renderFacts = item => {
      facts.replaceChildren();
      [['Лаборатория', item.laboratoryName], ['Вид продукции', item.productLabel], ['Текущий остаток', weight(item.weight)]].forEach(([label, value]) => facts.append(globalThis.VseApp.createInfoField({ label, value, wide: label === 'Лаборатория' })));
    };
    const closeDialog = () => { if (pending) return; dialog.close(); opener?.focus(); };
    close.addEventListener('click', closeDialog); cancel.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      fieldError.hidden = true;
      if (!date.value || !vsd.value.trim()) {
        fieldError.textContent = 'Заполните дату утилизации и номер исходящего ВСД.'; fieldError.hidden = false;
        if (!date.value) { date.setAttribute('aria-invalid', 'true'); date.setAttribute('aria-describedby', fieldError.id); }
        if (!vsd.value.trim()) { vsd.setAttribute('aria-invalid', 'true'); vsd.setAttribute('aria-describedby', fieldError.id); }
        (!date.value ? date : vsd).focus(); return;
      }
      pending = true; dispose.setBusy(true); close.disabled = true; cancel.disabled = true; fieldError.hidden = true;
      try {
        await new Promise(resolve => setTimeout(resolve, 380));
        const result = api.registerDisposal({ laboratoryId: current.laboratoryId, productKey: current.productKey, date: displayDate(date.value), vsdNumber: vsd.value, expectedWeight: current.weight });
        dialog.close(); onSaved?.(result); opener?.focus();
      } catch (error) {
        if (error.code === 'STALE_BALANCE') {
          current.weight = error.currentWeight; renderFacts(current);
          fieldError.textContent = 'Остаток изменился. Проверьте актуальное значение и повторите действие.';
        } else fieldError.textContent = error.message || 'Не удалось зарегистрировать утилизацию. Повторите попытку.';
        fieldError.hidden = false; fieldError.focus?.();
      } finally { pending = false; dispose.setBusy(false); close.disabled = false; cancel.disabled = false; }
    });
    dialog.openForBalance = (item, trigger) => {
      current = { ...item }; opener = trigger; date.value = today(); vsd.value = '';
      date.removeAttribute('aria-invalid'); date.removeAttribute('aria-describedby'); vsd.removeAttribute('aria-invalid'); vsd.removeAttribute('aria-describedby');
      fieldError.hidden = true;
      renderFacts(current); dialog.showModal(); cancel.focus();
    };
    return dialog;
  };

  api.createScreen = ({ initialLaboratoryId = 'lab-kazan-1', initialState = 'ready', canDispose = true, restoreState = true, showLaboratorySelector = true } = {}) => {
    const root = make('div', 'sample-accounting');
    let saved = {};
    if (restoreState) {
      try { saved = JSON.parse(sessionStorage.getItem(SCREEN_STATE_KEY) || '{}'); } catch { saved = {}; }
    }
    const live = make('div', 'sample-feedback'); live.hidden = true; live.dataset.sampleFeedback = '';
    const context = make('section', 'sample-context');
    context.append(globalThis.VseReports.createReportTypeFilter({ active: 'sample-accounting', links: { form5Vet: 'admin-reports.html', samples: 'sample-accounting.html' } }));
    const laboratoryField = make('label', 'sample-form-field sample-laboratory-field'); laboratoryField.append(make('span', '', 'Лаборатория'));
    const laboratory = make('select'); laboratory.id = 'sample-laboratory'; laboratory.setAttribute('data-library-select', '');
    const restoredLaboratory = saved.laboratoryId || initialLaboratoryId;
    (globalThis.VseReports?.laboratories || []).filter(item => item.hasData).forEach(item => laboratory.append(new Option(item.name, item.id, false, item.id === restoredLaboratory)));
    laboratoryField.append(laboratory);
    if (showLaboratorySelector) context.append(laboratoryField);
    else {
      const laboratoryName = (globalThis.VseReports?.laboratories || []).find(item => item.id === laboratory.value)?.name || 'Лаборатория';
      context.append(globalThis.VseApp.createInfoField({ label: 'Лаборатория', value: laboratoryName, wide: true }));
    }
    const pageActions = make('div', 'sample-page-actions'); context.append(pageActions);
    const summary = make('div', 'sample-summary');
    const tabs = make('div', 'sample-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Данные учёта проб');
    const panel = make('section', 'sample-panel');
    root.append(live, context, summary, tabs, panel);
    let activeTab = ['balances', 'history'].includes(saved.activeTab) ? saved.activeTab : 'balances';
    let disposalPage = Number(saved.disposalPage) || 1;
    let historyFilter = { from: '', to: '', product: '', search: '', sort: 'desc', ...(saved.historyFilter || {}) };
    let viewState = initialState;

    const saveState = () => {
      if (!restoreState) return;
      try {
        sessionStorage.setItem(SCREEN_STATE_KEY, JSON.stringify({
          laboratoryId: laboratory.value, activeTab, disposalPage, historyFilter,
        }));
      } catch { /* Экран остаётся рабочим без восстановления состояния. */ }
    };

    const dialog = api.createDisposalDialog({ onSaved: disposal => {
      feedback(root, `Утилизация ${weight(disposal.weight)} зарегистрирована.`); activeTab = 'balances'; saveState(); render();
      requestAnimationFrame(() => panel.querySelector('.sample-row-actions .admin-icon-button')?.focus());
    } });
    root.append(dialog);

    const currentLab = () => (globalThis.VseReports?.laboratories || []).find(item => item.id === laboratory.value);
    const setTab = key => { activeTab = key; disposalPage = 1; saveState(); render(); };
    const renderTabs = () => {
      tabs.replaceChildren();
      [['balances', 'Текущие остатки'], ['history', 'История утилизаций']].forEach(([key, label]) => {
        const button = make('button', `sample-tab${activeTab === key ? ' active' : ''}`, label); button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(activeTab === key)); button.addEventListener('click', () => setTab(key)); tabs.append(button);
      });
    };
    const renderSummary = () => summary.replaceChildren(globalThis.VseApp.createInfoField({ label: 'Актуальность данных', value: '05.11.2026 10:30 МСК' }));

    const renderPageActions = () => {
      const laboratoryId = laboratory.value;
      pageActions.replaceChildren(globalThis.VseReports.createActionsMenu({ items: [
        { label: 'Скачать Excel', iconName: 'admin-download', onClick: () => { api.downloadXlsx(laboratoryId); feedback(root, 'Excel-файл отчёта «Учёт проб» сформирован.'); } },
        { label: 'Скачать PDF', iconName: 'admin-download', href: `sample-accounting-print.html?laboratory=${encodeURIComponent(laboratoryId)}&mode=pdf` },
        { label: 'Распечатать', iconName: 'admin-print', href: `sample-accounting-print.html?laboratory=${encodeURIComponent(laboratoryId)}&print=1` },
      ] }));
    };
    const renderState = (kind, title, text) => {
      const state = make('div', `sample-state ${kind}`); state.append(icon(kind === 'error' ? 'admin-warning' : 'admin-reports'), make('h2', '', title), make('p', '', text));
      if (kind === 'error') { const retry = appButton({ label: 'Повторить', variant: 'secondary', onClick: () => { viewState = 'ready'; render(); } }); state.append(retry); }
      panel.replaceChildren(state);
    };
    const renderBalances = balances => {
      const shell = make('div', 'sample-table-shell sample-balance-shell'); const table = make('table', 'sample-table sample-balance-table'); table.append(make('caption', 'sr-only', 'Текущие остатки проб по видам продукции'));
      const head = make('thead'); const row = make('tr'); ['Вид продукции', 'Количество взятых проб', 'Текущий остаток, кг', 'Последний отбор'].forEach(label => { const th = make('th', '', label); th.scope = 'col'; row.append(th); });
      if (canDispose) { const th = make('th'); th.scope = 'col'; th.append(make('span', 'sr-only', 'Действия')); row.append(th); } head.append(row);
      const body = make('tbody');
      balances.forEach(item => {
        const tr = make('tr', item.weight ? '' : 'empty-balance'); tr.dataset.productKey = item.productKey;
        const productName = make('span', 'sample-product-name', item.productLabel);
        addCell(tr, 'Вид продукции', productName); addCell(tr, 'Количество взятых проб', String(item.count), 'sample-number'); addCell(tr, 'Текущий остаток, кг', weight(item.weight), 'sample-weight'); addCell(tr, 'Последний отбор', item.latest, 'sample-date');
        if (canDispose) {
          const actions = make('div', 'sample-row-actions');
          if (item.weight) {
            const dispose = make('button', 'admin-icon-button');
            dispose.type = 'button';
            dispose.setAttribute('aria-label', 'Утилизировать остаток');
            dispose.dataset.tooltip = 'Утилизация';
            dispose.append(icon('admin-dispose'));
            dispose.addEventListener('click', () => dialog.openForBalance({ ...item, laboratoryId: laboratory.value, laboratoryName: currentLab()?.name || 'Лаборатория' }, dispose));
            actions.append(dispose);
          }
          addCell(tr, 'Действия', actions, 'sample-actions-cell');
        }
        body.append(tr);
      });
      table.append(head, body); shell.append(table);
      if (balances.every(item => !item.weight)) {
        const note = make('div', 'sample-empty-note');
        note.append(icon('admin-reports'), make('span', '', 'В выбранной лаборатории сейчас нет доступных физических проб.'));
        panel.replaceChildren(note, shell);
      } else panel.replaceChildren(shell);
    };
    const createFilter = (label, control) => { const field = make('label', 'sample-filter'); field.append(make('span', '', label), control); return field; };
    const renderHistory = disposals => {
      const controls = make('div', 'sample-controls history-controls');
      const from = make('input'); from.type = 'date'; from.value = historyFilter.from; const to = make('input'); to.type = 'date'; to.value = historyFilter.to;
      const product = make('select'); product.setAttribute('data-library-select', ''); product.append(new Option('Все виды', 'all')); api.productTypes.forEach(item => product.append(new Option(item.label, item.key)));
      product.value = historyFilter.product || 'all';
      const search = make('input'); search.type = 'search'; search.placeholder = 'Номер исходящего ВСД'; search.value = historyFilter.search;
      const sort = make('select'); sort.setAttribute('data-library-select', ''); sort.append(new Option('Сначала новые', 'desc'), new Option('Сначала старые', 'asc')); sort.value = historyFilter.sort || 'desc';
      const reset = make('button', 'sample-reset', 'Сбросить фильтры'); reset.type = 'button'; reset.hidden = true;
      controls.append(createFilter('С', from), createFilter('По', to), createFilter('Вид продукции', product), createFilter('Поиск', search), createFilter('Сортировка', sort), reset);
      const content = make('div');
      const draw = () => {
        const query = search.value.trim().toLowerCase();
        historyFilter = { from: from.value, to: to.value, product: product.value, search: search.value, sort: sort.value };
        saveState();
        const productKey = product.value === 'all' ? '' : product.value;
        const hasFilters = from.value || to.value || productKey || query || sort.value !== 'desc'; reset.hidden = !hasFilters;
        const items = disposals.filter(item => (!from.value || toIso(item.disposedAt) >= from.value) && (!to.value || toIso(item.disposedAt) <= to.value) && (!productKey || item.productKey === productKey) && (!query || item.vsdNumber.toLowerCase().includes(query))).sort((a, b) => (sort.value === 'asc' ? 1 : -1) * toIso(a.disposedAt).localeCompare(toIso(b.disposedAt)));
        if (!items.length) { const empty = make('div', 'sample-state empty'); empty.append(icon('admin-history'), make('h2', '', disposals.length ? 'События не найдены' : 'История утилизаций пуста'), make('p', '', disposals.length ? 'Измените период или сбросьте фильтры.' : 'Зарегистрированные утилизации появятся здесь.')); content.replaceChildren(empty); return; }
        const start = (disposalPage - 1) * PAGE_SIZE; const shell = make('div', 'sample-table-shell'); const table = make('table', 'sample-table sample-history-table'); table.append(make('caption', 'sr-only', 'История утилизаций проб'));
        const head = make('thead'); const hr = make('tr'); ['Дата утилизации', 'Вид продукции', 'Утилизированный вес, кг', 'Номер исходящего ВСД', 'Исполнитель'].forEach(label => { const th = make('th', '', label); th.scope = 'col'; hr.append(th); }); head.append(hr);
        const body = make('tbody'); items.slice(start, start + PAGE_SIZE).forEach(item => { const row = make('tr'); addCell(row, 'Дата утилизации', item.disposedAt); addCell(row, 'Вид продукции', api.productLabel(item.productKey)); addCell(row, 'Утилизированный вес, кг', weight(item.weight), 'sample-weight'); addCell(row, 'Номер исходящего ВСД', item.vsdNumber, 'sample-vsd'); addCell(row, 'Исполнитель', item.performer); body.append(row); });
        table.append(head, body); shell.append(table); content.replaceChildren(shell, createPagination(items.length, disposalPage, next => { disposalPage = next; saveState(); draw(); }));
      };
      [from, to, product, sort].forEach(control => control.addEventListener('change', () => { disposalPage = 1; draw(); })); search.addEventListener('input', () => { disposalPage = 1; draw(); }); reset.addEventListener('click', () => { from.value = ''; to.value = ''; product.value = 'all'; search.value = ''; sort.value = 'desc'; disposalPage = 1; historyFilter = { from: '', to: '', product: 'all', search: '', sort: 'desc' }; globalThis.MilkVseSelects?.refresh(product); globalThis.MilkVseSelects?.refresh(sort); draw(); search.focus(); });
      panel.replaceChildren(controls, content); globalThis.MilkVseSelects?.enhance(controls); draw();
    };
    const render = () => {
      renderSummary(); renderPageActions(); renderTabs();
      if (viewState === 'loading') { renderState('loading', 'Загружаем учёт проб', 'Получаем актуальные остатки выбранной лаборатории.'); return; }
      if (viewState === 'error') { renderState('error', 'Не удалось загрузить учёт проб', 'Проверьте подключение и повторите попытку.'); return; }
      if (activeTab === 'balances') renderBalances(viewState === 'empty' ? api.productTypes.map(item => ({ productKey: item.key, productLabel: item.label, count: 0, weight: 0, latest: '—' })) : api.getBalances(laboratory.value));
      else renderHistory(api.getDisposals(laboratory.value));
    };
    laboratory.addEventListener('change', () => { historyFilter = { from: '', to: '', product: 'all', search: '', sort: 'desc' }; activeTab = 'balances'; disposalPage = 1; viewState = 'ready'; saveState(); render(); });
    root.setViewState = state => { viewState = state; render(); };
    render();
    globalThis.MilkVseSelects?.enhance(root);
    return root;
  };

  api.downloadXlsx = laboratoryId => {
    const laboratory = (globalThis.VseReports?.laboratories || []).find(item => item.id === laboratoryId);
    const balances = api.getBalances(laboratoryId);
    globalThis.VseReports.downloadTableXlsx({
      title: `Учёт проб — ${laboratory?.name || 'Лаборатория'}`,
      sheetName: 'Учёт проб',
      columns: ['Вид продукции', 'Количество взятых проб', 'Текущий остаток, кг', 'Последний отбор'],
      rows: balances.map(item => [item.productLabel, item.count, item.weight, item.latest]),
    }, `Учёт-проб_${laboratoryId}_05-11-2026.xlsx`);
  };

  api.createPrintView = laboratoryId => {
    const laboratory = (globalThis.VseReports?.laboratories || []).find(item => item.id === laboratoryId);
    const root = make('main', 'sample-print-page');
    const head = make('header', 'sample-print-head');
    head.append(make('h1', '', 'Учёт проб'), make('p', '', laboratory?.name || 'Лаборатория'), make('p', '', 'Актуальность данных: 05.11.2026 10:30 МСК'));
    const table = make('table', 'sample-print-table'); table.append(make('caption', 'sr-only', 'Текущие остатки проб по видам продукции'));
    const thead = make('thead'); const heading = make('tr');
    ['Вид продукции', 'Количество взятых проб', 'Текущий остаток, кг', 'Последний отбор'].forEach(label => { const th = make('th', '', label); th.scope = 'col'; heading.append(th); });
    thead.append(heading);
    const tbody = make('tbody');
    api.getBalances(laboratoryId).forEach(item => {
      const row = make('tr');
      [item.productLabel, String(item.count), weight(item.weight), item.latest].forEach(value => row.append(make('td', '', value)));
      tbody.append(row);
    });
    table.append(thead, tbody); root.append(head, table);
    return root;
  };
})();
