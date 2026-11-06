(() => {
  const api = globalThis.VseReports ||= {};
  const LIST_STATE_KEY = 'vse-admin-reports-list-state-v1';
  const PAGE_SIZE = 20;
  const codeFields = Object.freeze([
    ['okud', 'Код формы по ОКУД'], ['okpo', 'Код отчитывающейся организации по ОКПО'],
    ['okved', 'Код вида деятельности по ОКВЭД'], ['oktmo', 'Код территории по ОКТМО'],
    ['okogu', 'Код министерства (ведомства), органа управления по ОКОГУ'],
    ['okopf', 'Код организационно-правовой формы по ОКОПФ'], ['okfs', 'Код формы собственности по ОКФС'],
  ]);

  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  };
  const icon = name => globalThis.VseIcons.create(name, { className: 'admin-icon' });
  const appButton = options => globalThis.VseApp.createButton(options);
  const formatCell = (value, mass) => mass ? Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : String(Number(value || 0));
  const safeFilePart = value => value.replace(/[\\/:*?"<>|«»]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const fileName = (report, extension) => `5-вет_раздел-III_${safeFilePart(report.laboratoryName)}_${report.year}_${report.half}-полугодие.${extension}`;

  const announce = (root, message, tone = 'status') => {
    const region = root.querySelector('[data-report-feedback]');
    if (!region) return;
    region.className = `report-feedback ${tone}`;
    region.textContent = message;
    region.hidden = false;
    region.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  };

  api.createReportTypeFilter = ({ active = '5-vet-iii', links = {} } = {}) => {
    const field = make('label', 'report-filter report-type-filter');
    field.append(make('span', '', 'Тип отчёта'));
    const select = make('select'); select.id = 'report-type'; select.setAttribute('data-library-select', '');
    select.append(
      new Option('Отчёт по форме 5-вет (раздел III)', '5-vet-iii'),
      new Option('Учёт проб', 'sample-accounting'),
    );
    select.value = active;
    select.addEventListener('change', () => {
      const href = select.value === 'sample-accounting' ? (links.samples || 'sample-accounting.html') : (links.form5Vet || 'admin-reports.html');
      if (href && href !== '#') location.href = href;
    });
    field.append(select);
    field.control = select;
    return field;
  };

  api.createReportSummary = report => {
    const section = make('section', 'report-summary');
    section.setAttribute('aria-label', 'Сведения об отчёте');
    [
      ['Лаборатория', report.laboratoryName], ['Отчётное полугодие', report.periodLabel],
      ['Дата и время формирования', report.formedAt || 'Будет указана после сохранения'],
      ['Количество проведённых ВСЭ', String(report.vseCount)],
    ].forEach(([label, value]) => section.append(globalThis.VseApp.createInfoField({ label, value })));
    return section;
  };

  api.createOrganizationHeader = (report, { editableCodes = false } = {}) => {
    const section = make('section', 'report-organization');
    const heading = make('div', 'report-section-heading');
    heading.append(icon('admin-reports'));
    const headingCopy = make('div');
    headingCopy.append(make('h2', '', 'Сведения об отчитывающейся организации'), make('p', '', editableCodes ? 'Проверьте организацию и заполните обязательные классификационные коды.' : 'Сведения зафиксированы на момент сохранения отчёта.'));
    heading.append(headingCopy);
    const facts = make('div', 'report-organization-facts');
    facts.append(
      globalThis.VseApp.createInfoField({ label: 'Наименование организации', value: report.laboratoryName, wide: true }),
      globalThis.VseApp.createInfoField({ label: 'Адрес', value: report.laboratoryAddress, wide: true }),
      globalThis.VseApp.createInfoField({ label: 'Отчётный период', value: `${report.start} — ${report.end}` }),
      globalThis.VseApp.createInfoField({ label: 'Тип отчёта', value: 'Форма 5-вет (раздел III)' }),
    );
    const codes = make('div', `report-code-grid${editableCodes ? ' editable' : ''}`);
    const controls = new Map();
    codeFields.forEach(([key, label]) => {
      if (!editableCodes) {
        codes.append(globalThis.VseApp.createInfoField({ label, value: report.codes?.[key] || 'Не указано', wide: label.length > 50 }));
        return;
      }
      const field = make('div', 'report-code-field');
      const id = `report-code-${key}`;
      const fieldLabel = make('label');
      fieldLabel.htmlFor = id;
      fieldLabel.append(label, make('span', 'required-mark', ' *'));
      const input = make('input');
      input.id = id;
      input.name = key;
      input.type = 'text';
      input.autocomplete = 'off';
      input.required = true;
      input.value = report.codes?.[key] || '';
      const error = make('span', 'report-field-error');
      error.id = `${id}-error`;
      error.hidden = true;
      field.append(fieldLabel, input, error);
      codes.append(field);
      controls.set(key, { input, error });
    });
    section.append(heading, facts, codes);
    section.codeControls = controls;
    return section;
  };

  api.createReportMatrix = report => {
    const section = make('section', 'report-matrix-section');
    const heading = make('div', 'report-section-heading matrix-heading');
    const headingIcon = icon('admin-reports');
    const copy = make('div');
    copy.append(make('h2', '', 'Раздел III. Ветеринарно-санитарная экспертиза'), make('p', '', 'Расчётные показатели по видам животных. Демонстрационные значения не утверждают методику расчёта.'));
    heading.append(headingIcon, copy);
    const shell = make('div', 'report-matrix-scroll');
    shell.tabIndex = 0;
    shell.setAttribute('aria-label', 'Таблица отчёта. Доступна горизонтальная прокрутка');
    const table = make('table', 'report-matrix');
    const caption = make('caption', '', 'Форма 5-вет, раздел III');
    const thead = make('thead');
    const first = make('tr');
    const nameHead = make('th', '', 'Наименование показателей'); nameHead.rowSpan = 2; nameHead.scope = 'col';
    const lineHead = make('th', '', '№ строки'); lineHead.rowSpan = 2; lineHead.scope = 'col';
    ['Крупный рогатый скот, яки, буйволы', 'Свиньи', 'Овцы, козы', 'Кролики, нутрии'].forEach(label => { const th = make('th', '', label); th.rowSpan = 2; th.scope = 'col'; first.append(th); });
    const birds = make('th', '', 'Птица'); birds.colSpan = 2; birds.scope = 'colgroup';
    const fish = make('th', '', 'Рыба'); fish.rowSpan = 2; fish.scope = 'col';
    const other = make('th', '', 'Другие виды животных'); other.rowSpan = 2; other.scope = 'col';
    first.prepend(nameHead, lineHead); first.append(birds, fish, other);
    const second = make('tr');
    ['Куры', 'Другие виды'].forEach(label => { const th = make('th', '', label); th.scope = 'col'; second.append(th); });
    thead.append(first, second);
    const tbody = make('tbody');
    api.rows.forEach(row => {
      const tr = make('tr', row.section ? 'report-matrix-section-row' : '');
      const label = make('th', '', row.label); label.scope = 'row';
      tr.append(label, make('td', 'report-line-number', String(row.line)));
      api.columns.forEach(column => tr.append(make('td', 'report-value', formatCell(report.values?.[row.line]?.[column.key], row.mass))));
      tbody.append(tr);
    });
    table.append(caption, thead, tbody);
    shell.append(table);
    section.append(heading, make('p', 'report-scroll-hint', 'Прокрутите таблицу по горизонтали, чтобы увидеть все виды животных.'), shell);
    return section;
  };

  const createOfficialHeaderSheet = report => {
    const section = make('section', 'official-sheet official-header-sheet');
    section.setAttribute('aria-label', 'Шапка формы 5-вет');
    const title = make('div', 'official-form-title');
    title.append(
      make('h1', '', 'СВЕДЕНИЯ О ВЕТЕРИНАРНО-САНИТАРНОЙ ЭКСПЕРТИЗЕ СЫРЬЯ И ПРОДУКТОВ ЖИВОТНОГО ПРОИСХОЖДЕНИЯ'),
      make('p', '', `ЗА ${report.half === 2 ? 'II' : 'I'} ПОЛУГОДИЕ ${report.year} Г.`),
    );
    const submission = make('div', 'official-submission-layout');
    const submissionTable = make('table', 'official-submission-table');
    const submissionCaption = make('caption', 'sr-only', 'Порядок и срок представления отчёта');
    const submissionHead = make('thead'); const submissionHeadRow = make('tr');
    const submitterHead = make('th', '', 'Представляют'); submitterHead.scope = 'col';
    const deadlineHead = make('th', '', 'Сроки представления'); deadlineHead.scope = 'col';
    submissionHeadRow.append(submitterHead, deadlineHead); submissionHead.append(submissionHeadRow);
    submissionTable.append(submissionCaption, submissionHead);
    const submissionBody = make('tbody');
    const submissionRow = make('tr');
    submissionRow.append(
      make('td', '', 'Уполномоченные в области ветеринарии органы исполнительной власти субъектов Российской Федерации Минсельхозу России (федеральному государственному бюджетному учреждению «Центр ветеринарии» — 129344, г. Москва, вн. тер. г. муниципальный округ Бабушкинский, ул. Летчика Бабушкина, д. 20)'),
      make('td', '', 'На 30-й день после отчетного периода'),
    );
    submissionBody.append(submissionRow); submissionTable.append(submissionBody);
    const frequency = make('div', 'official-frequency');
    frequency.append(make('strong', '', '5-вет'), make('strong', '', 'Полугодовая'));
    submission.append(submissionTable, frequency);

    const organization = make('table', 'official-organization-table');
    const caption = make('caption', 'sr-only', 'Сведения об отчитывающейся организации и классификационные коды');
    const body = make('tbody');
    const nameRow = make('tr'); const nameCell = make('td'); nameCell.colSpan = 7; nameCell.append('Наименование отчитывающейся организации ', make('span', 'official-line-value', report.laboratoryName)); nameRow.append(nameCell);
    const addressRow = make('tr'); const addressCell = make('td'); addressCell.colSpan = 7; addressCell.append('Адрес ', make('span', 'official-line-value', report.laboratoryAddress)); addressRow.append(addressCell);
    const codeTitleRow = make('tr'); const blank = make('td'); const codeTitle = make('td', '', 'Код'); codeTitle.colSpan = 6; codeTitleRow.append(blank, codeTitle);
    const labelsRow = make('tr');
    codeFields.forEach(([, label]) => { const cell = make('th', '', label); cell.scope = 'col'; labelsRow.append(cell); });
    const numbersRow = make('tr', 'official-code-numbers');
    codeFields.forEach((_, index) => numbersRow.append(make('td', '', String(index + 1))));
    const valuesRow = make('tr', 'official-code-values');
    codeFields.forEach(([key]) => valuesRow.append(make('td', '', report.codes?.[key] || '')));
    body.append(nameRow, addressRow, codeTitleRow, labelsRow, numbersRow, valuesRow);
    organization.append(caption, body);
    section.append(title, submission, organization);
    return section;
  };

  const createOfficialSectionSheet = report => {
    const section = make('section', 'official-sheet official-section-sheet');
    const heading = make('header', 'official-section-title');
    heading.append(make('h2', '', 'Раздел III'), make('h3', '', 'III. Результаты ветеринарно-санитарной экспертизы мяса и мясных продуктов на рынках'));
    const table = make('table', 'official-report-table');
    const caption = make('caption', 'sr-only', 'Форма 5-вет, раздел III');
    const colgroup = make('colgroup');
    ['indicator', 'line', 'animal', 'animal', 'animal', 'animal', 'bird', 'bird', 'animal', 'animal'].forEach(className => colgroup.append(make('col', className)));
    const thead = make('thead');
    const first = make('tr');
    const indicator = make('th', '', 'Наименование показателей'); indicator.rowSpan = 2; indicator.scope = 'col';
    const line = make('th', '', '№ строки'); line.rowSpan = 2; line.scope = 'col';
    const cattle = make('th', '', 'Крупный рогатый скот, яки, буйволы'); cattle.rowSpan = 2; cattle.scope = 'col';
    const pigs = make('th', '', 'Свиньи'); pigs.rowSpan = 2; pigs.scope = 'col';
    const sheep = make('th', '', 'Овцы, козы'); sheep.rowSpan = 2; sheep.scope = 'col';
    const rabbits = make('th', '', 'Кролики, нутрии'); rabbits.rowSpan = 2; rabbits.scope = 'col';
    const birds = make('th', '', 'Птица'); birds.colSpan = 2; birds.scope = 'colgroup';
    const fish = make('th', '', 'Рыба'); fish.rowSpan = 2; fish.scope = 'col';
    const other = make('th', '', 'Другие виды животных'); other.rowSpan = 2; other.scope = 'col';
    first.append(indicator, line, cattle, pigs, sheep, rabbits, birds, fish, other);
    const second = make('tr');
    ['куры', 'другие виды'].forEach(label => { const th = make('th', '', label); th.scope = 'col'; second.append(th); });
    const numbering = make('tr', 'official-column-numbers');
    for (let index = 1; index <= 10; index += 1) numbering.append(make('th', '', String(index)));
    thead.append(first, second, numbering);
    const tbody = make('tbody');
    api.rows.forEach(item => {
      const tr = make('tr');
      const label = make('th', '', item.label); label.scope = 'row';
      tr.append(label, make('td', 'official-line-number', String(item.line)));
      api.columns.forEach(column => tr.append(make('td', 'official-value', formatCell(report.values?.[item.line]?.[column.key], item.mass))));
      tbody.append(tr);
    });
    table.append(caption, colgroup, thead, tbody);
    section.append(heading, table);
    return section;
  };

  api.createOfficialReport = report => {
    const fragment = document.createDocumentFragment();
    fragment.append(createOfficialHeaderSheet(report), createOfficialSectionSheet(report));
    return fragment;
  };

  const createDecisionDialog = ({ title, description, confirmLabel, danger = false, onConfirm }) => {
    const dialog = make('dialog', 'report-dialog');
    const box = make('div', 'report-dialog-box');
    const head = make('div', 'report-dialog-head');
    const copy = make('div');
    copy.append(make('h2', '', title), make('p', '', description));
    const close = make('button', 'report-dialog-close'); close.type = 'button'; close.setAttribute('aria-label', 'Закрыть'); close.append(icon('admin-clear'));
    head.append(copy, close);
    const body = make('div', 'report-dialog-body');
    const actions = make('div', 'report-dialog-actions');
    const cancel = appButton({ label: 'Отмена', variant: 'secondary', onClick: () => dialog.close('cancel') });
    const confirm = appButton({ label: confirmLabel, busyLabel: danger ? 'Удаляем…' : 'Продолжаем…', variant: danger ? 'danger' : 'primary' });
    actions.append(cancel, confirm);
    box.append(head, body, actions);
    dialog.append(box);
    const closeDialog = () => { if (!confirm.disabled) dialog.close('cancel'); };
    close.addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', event => { if (confirm.disabled) event.preventDefault(); });
    confirm.addEventListener('click', async () => {
      confirm.setBusy(true); cancel.disabled = true; close.disabled = true;
      try { await onConfirm?.(dialog, body); }
      catch (error) { body.replaceChildren(make('div', 'report-dialog-error', error.message || 'Не удалось выполнить действие.')); confirm.setBusy(false); cancel.disabled = false; close.disabled = false; }
    });
    dialog.openFor = trigger => { dialog._trigger = trigger; dialog.showModal(); requestAnimationFrame(() => cancel.focus()); };
    dialog.addEventListener('close', () => dialog._trigger?.isConnected && dialog._trigger.focus());
    return { dialog, body, confirm, cancel, close };
  };

  api.createReportDeleteDialog = ({ onDeleted } = {}) => {
    let report = null;
    const control = createDecisionDialog({
      title: 'Удалить отчёт?',
      description: 'Отчёт будет удалён без возможности восстановления.',
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: async dialog => {
        await new Promise(resolve => setTimeout(resolve, 320));
        api.deleteReport(report.id);
        dialog.close('deleted');
        onDeleted?.(report);
      },
    });
    control.dialog.openForReport = (nextReport, trigger) => {
      report = nextReport;
      const facts = make('div', 'report-delete-facts');
      facts.append(
        globalThis.VseApp.createInfoField({ label: 'Лаборатория', value: report.laboratoryName, wide: true }),
        globalThis.VseApp.createInfoField({ label: 'Отчётное полугодие', value: report.periodLabel }),
      );
      control.body.replaceChildren(facts, make('p', 'report-delete-warning', 'После удаления это полугодие снова станет доступно для формирования отчёта.'));
      control.dialog.openFor(trigger);
    };
    return control.dialog;
  };

  const downloadSpreadsheet = report => api.downloadOfficialXlsx(report, fileName(report, 'xlsx'));

  const reportAction = ({ label, iconName, href, onClick, danger = false }) => {
    const control = href ? make('a', `report-menu-action${danger ? ' danger' : ''}`) : make('button', `report-menu-action${danger ? ' danger' : ''}`);
    if (href) control.href = href; else control.type = 'button';
    control.append(icon(iconName), make('span', '', label));
    if (onClick) control.addEventListener('click', onClick);
    return control;
  };

  api.createActionsMenu = ({ items = [], label = 'Действия' } = {}) => {
    const details = make('details', 'report-actions-menu');
    const summary = make('summary', 'admin-icon-button');
    summary.setAttribute('aria-label', label); summary.dataset.tooltip = label; summary.append(icon('admin-more'));
    const popover = make('div', 'report-actions-popover');
    const close = () => details.removeAttribute('open');
    items.forEach(item => popover.append(reportAction({ ...item, onClick: item.onClick ? event => { close(); item.onClick(event); } : undefined })));
    details.append(summary, popover);
    details.addEventListener('toggle', () => {
      if (!details.open || matchMedia('(max-width: 760px)').matches) {
        details.classList.remove('flip');
        return;
      }
      requestAnimationFrame(() => {
        const triggerRect = summary.getBoundingClientRect();
        const popoverHeight = popover.offsetHeight;
        const roomBelow = innerHeight - triggerRect.bottom;
        details.classList.toggle('flip', roomBelow < popoverHeight + 18 && triggerRect.top > popoverHeight + 18);
      });
    });
    details.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); summary.focus(); } });
    return details;
  };

  api.createReportActionsMenu = ({ report, viewHref, printHref, onDelete, onFeedback }) => api.createActionsMenu({ items: [
    { label: 'Посмотреть', iconName: 'admin-view', href: viewHref },
    { label: 'Скачать Excel', iconName: 'admin-download', onClick: () => { downloadSpreadsheet(report); onFeedback?.('Excel сформирован по официальной структуре формы 5-вет.'); } },
    { label: 'Скачать PDF', iconName: 'admin-download', href: `${printHref}&mode=pdf` },
    { label: 'Распечатать', iconName: 'admin-print', href: `${printHref}&print=1` },
    { label: 'Удалить', iconName: 'admin-delete', danger: true, onClick: event => onDelete?.(report, event.currentTarget) },
  ] });

  api.createReportsList = ({ reports = api.createDemoReports(), initialState = 'ready', links = {}, restoreState = true } = {}) => {
    const root = make('section', 'admin-reports-list');
    const feedback = make('div', 'report-feedback'); feedback.dataset.reportFeedback = ''; feedback.hidden = true;
    const controls = make('section', 'report-list-controls'); controls.setAttribute('aria-label', 'Фильтры отчётов');
    const typeField = api.createReportTypeFilter({ active: '5-vet-iii', links: { form5Vet: links.list || 'admin-reports.html', samples: links.samples || 'sample-accounting.html' } });
    const searchField = make('label', 'report-filter report-search-filter'); searchField.append(make('span', '', 'Поиск по лаборатории'));
    const searchControl = make('div', 'report-search-control');
    const search = make('input'); search.type = 'search'; search.placeholder = 'Введите название лаборатории'; search.autocomplete = 'off';
    const searchIcon = icon('admin-search');
    const clearSearch = make('button', 'report-clear-search'); clearSearch.type = 'button'; clearSearch.setAttribute('aria-label', 'Очистить поиск'); clearSearch.append(icon('admin-clear')); clearSearch.hidden = true;
    searchControl.append(searchIcon, search, clearSearch); searchField.append(searchControl);
    const yearField = make('label', 'report-filter'); yearField.append(make('span', '', 'Год'));
    const year = make('select'); year.append(new Option('Все годы', '')); [...new Set(reports.map(item => item.year))].sort((a, b) => b - a).forEach(value => year.append(new Option(String(value), String(value)))); yearField.append(year);
    const halfField = make('label', 'report-filter'); halfField.append(make('span', '', 'Полугодие'));
    const half = make('select'); [['Все', ''], ['I полугодие', '1'], ['II полугодие', '2']].forEach(([label, value]) => half.append(new Option(label, value))); halfField.append(half);
    const sortField = make('label', 'report-filter'); sortField.append(make('span', '', 'Сортировка'));
    const sort = make('select'); sort.append(new Option('Сначала новые', 'desc'), new Option('Сначала старые', 'asc')); sortField.append(sort);
    const reset = make('button', 'report-reset', 'Сбросить'); reset.type = 'button'; reset.hidden = true;
    controls.append(typeField, searchField, yearField, halfField, sortField, reset);
    const content = make('div', 'report-list-content');
    const pagination = make('nav', 'report-pagination'); pagination.setAttribute('aria-label', 'Страницы отчётов');
    const state = { query: '', year: '', half: '', sort: 'desc', page: 1 };
    if (restoreState) {
      try { Object.assign(state, JSON.parse(sessionStorage.getItem(LIST_STATE_KEY) || '{}')); } catch { /* Default state remains. */ }
    }
    search.value = state.query || ''; year.value = state.year || ''; half.value = state.half || ''; sort.value = state.sort || 'desc';
    let viewState = initialState;
    let currentReports = reports;
    let deleteTrigger = null;
    const deleteDialog = api.createReportDeleteDialog({ onDeleted: report => {
      currentReports = currentReports.filter(item => item.id !== report.id);
      state.page = Math.min(state.page, Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));
      render(); announce(root, 'Отчёт удалён. Полугодие снова доступно для формирования.');
      requestAnimationFrame(() => deleteTrigger?.isConnected ? deleteTrigger.focus() : root.querySelector('.report-row-link, #create-report-inline')?.focus());
    } });
    root.append(feedback, controls, content, pagination, deleteDialog);

    const persist = () => { if (restoreState) try { sessionStorage.setItem(LIST_STATE_KEY, JSON.stringify({ ...state, scrollY })); } catch { /* State remains in memory. */ } };
    const filtered = () => currentReports.filter(report => {
      const matchesQuery = report.laboratoryName.toLocaleLowerCase('ru').includes(state.query.trim().toLocaleLowerCase('ru'));
      return matchesQuery && (!state.year || String(report.year) === state.year) && (!state.half || String(report.half) === state.half);
    }).sort((a, b) => state.sort === 'asc' ? a.formedAtSort.localeCompare(b.formedAtSort) : b.formedAtSort.localeCompare(a.formedAtSort));
    const renderState = (kind, title, description, actionLabel = '') => {
      const panel = make('div', `report-list-state ${kind}`);
      panel.append(icon(kind === 'error' ? 'admin-retry' : 'admin-reports'), make('h2', '', title), make('p', '', description));
      if (actionLabel) {
        const action = appButton({ label: actionLabel, variant: kind === 'empty' ? 'primary' : 'secondary' });
        if (kind === 'empty') action.addEventListener('click', () => { location.href = links.create || 'admin-report-create.html'; });
        else if (kind === 'no-results') action.addEventListener('click', () => {
          search.value = ''; year.value = ''; half.value = ''; sort.value = 'desc';
          state.query = ''; state.year = ''; state.half = ''; state.sort = 'desc'; state.page = 1;
          viewState = 'ready'; render(); search.focus();
        });
        else action.addEventListener('click', () => { viewState = 'ready'; render(); });
        panel.append(action);
      }
      content.replaceChildren(panel); pagination.hidden = true;
    };
    const renderLoading = () => {
      const shell = make('div', 'report-list-table-shell report-loading-shell');
      const table = make('table', 'report-list-table');
      table.setAttribute('aria-label', 'Загрузка отчётов');
      table.setAttribute('aria-busy', 'true');
      const thead = make('thead'); const head = make('tr');
      ['Отчётное полугодие', 'Лаборатория', 'Количество проведённых ВСЭ', 'Дата и время формирования', ''].forEach(label => {
        const th = make('th', '', label); th.scope = 'col'; head.append(th);
      });
      thead.append(head);
      const tbody = make('tbody');
      for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
        const row = make('tr');
        for (let cellIndex = 0; cellIndex < 5; cellIndex += 1) {
          const cell = make('td');
          const line = make('span', 'report-skeleton-line');
          line.style.setProperty('--skeleton-width', cellIndex === 1 ? `${78 - rowIndex * 5}%` : `${64 + ((rowIndex + cellIndex) % 3) * 9}%`);
          cell.append(line); row.append(cell);
        }
        tbody.append(row);
      }
      table.append(thead, tbody); shell.append(table); content.replaceChildren(shell); pagination.hidden = true;
    };
    const render = () => {
      clearSearch.hidden = !search.value; reset.hidden = !(state.query || state.year || state.half || state.sort !== 'desc');
      if (viewState === 'loading') { renderLoading(); return; }
      if (viewState === 'error') { renderState('error', 'Не удалось загрузить отчёты', 'Проверьте подключение и повторите попытку.', 'Повторить'); return; }
      if (!currentReports.length) { renderState('empty', 'Отчётов пока нет', 'Создайте первый отчёт по завершённому полугодию.', 'Создать отчёт'); return; }
      const items = filtered();
      if (!items.length) { renderState('no-results', 'Отчёты не найдены', 'Измените запрос или сбросьте фильтры.', 'Сбросить фильтры'); return; }
      const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE)); state.page = Math.min(Math.max(1, Number(state.page) || 1), pages);
      const start = (state.page - 1) * PAGE_SIZE; const pageItems = items.slice(start, start + PAGE_SIZE);
      const shell = make('div', 'report-list-table-shell');
      const table = make('table', 'report-list-table'); table.append(make('caption', '', 'Сохранённые отчёты по форме 5-вет'));
      const thead = make('thead'); const trHead = make('tr');
      ['Отчётное полугодие', 'Лаборатория', 'Количество проведённых ВСЭ', 'Дата и время формирования', ''].forEach((label, index) => { const th = make('th', '', label); th.scope = 'col'; if (index === 4) th.append(make('span', 'sr-only', 'Действия')); trHead.append(th); });
      thead.append(trHead); const tbody = make('tbody');
      pageItems.forEach(report => {
        const tr = make('tr');
        const firstCell = make('td'); const link = make('a', 'report-row-link', report.periodLabel); link.href = `${links.view || 'admin-report-view.html'}?id=${encodeURIComponent(report.id)}`; firstCell.append(link);
        const labCell = make('td'); labCell.append(make('span', 'report-laboratory-name', report.laboratoryName));
        const actionsCell = make('td', 'report-actions-cell');
        actionsCell.append(api.createReportActionsMenu({ report, viewHref: link.href, printHref: `${links.print || 'admin-report-print.html'}?id=${encodeURIComponent(report.id)}`, onDelete: (item, trigger) => { deleteTrigger = trigger; deleteDialog.openForReport(item, trigger); }, onFeedback: message => announce(root, message) }));
        const countCell = make('td', 'report-count', String(report.vseCount));
        const dateCell = make('td', 'report-date', report.formedAt);
        [[firstCell, 'Отчётное полугодие'], [labCell, 'Лаборатория'], [countCell, 'Количество проведённых ВСЭ'], [dateCell, 'Дата и время формирования'], [actionsCell, 'Действия']].forEach(([cell, label]) => { cell.dataset.label = label; });
        tr.append(firstCell, labCell, countCell, dateCell, actionsCell);
        tbody.append(tr);
      });
      table.append(thead, tbody); shell.append(table); content.replaceChildren(shell);
      pagination.hidden = false; pagination.replaceChildren();
      const range = make('span', 'report-pagination-count', `${start + 1}–${Math.min(start + PAGE_SIZE, items.length)} из ${items.length}`);
      const actions = make('div', 'report-pagination-actions');
      const previous = make('button', 'report-page-button'); previous.type = 'button'; previous.disabled = state.page === 1; previous.setAttribute('aria-label', 'Предыдущая страница'); previous.append(icon('chevron-left'));
      const current = make('span', 'report-page-current', `${state.page} из ${pages}`); current.setAttribute('aria-current', 'page');
      const next = make('button', 'report-page-button'); next.type = 'button'; next.disabled = state.page === pages; next.setAttribute('aria-label', 'Следующая страница'); next.append(icon('chevron-right'));
      previous.addEventListener('click', () => { state.page -= 1; persist(); render(); root.scrollIntoView({ block: 'start' }); });
      next.addEventListener('click', () => { state.page += 1; persist(); render(); root.scrollIntoView({ block: 'start' }); });
      actions.append(previous, current, next); pagination.append(range, actions); persist();
    };
    const update = () => { state.query = search.value; state.year = year.value; state.half = half.value; state.sort = sort.value; state.page = 1; render(); };
    search.addEventListener('input', update); year.addEventListener('change', update); half.addEventListener('change', update); sort.addEventListener('change', update);
    clearSearch.addEventListener('click', () => { search.value = ''; update(); search.focus(); });
    reset.addEventListener('click', () => { search.value = ''; year.value = ''; half.value = ''; sort.value = 'desc'; update(); search.focus(); });
    document.addEventListener('pointerdown', event => root.querySelectorAll('.report-actions-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.removeAttribute('open'); }));
    root.setViewState = value => { viewState = value; render(); };
    root.setReports = value => { currentReports = value; render(); };
    root.announce = message => announce(root, message);
    render();
    globalThis.MilkVseSelects?.enhance(root);
    return root;
  };

  api.createReportCreate = ({ links = {} } = {}) => {
    const root = make('div', 'report-create');
    const feedback = make('div', 'report-feedback'); feedback.dataset.reportFeedback = ''; feedback.hidden = true;
    const step = make('section', 'report-parameters');
    const heading = make('div', 'report-section-heading'); heading.append(icon('admin-reports'));
    const headingCopy = make('div'); headingCopy.append(make('h2', '', 'Параметры отчёта'), make('p', '', 'Выберите лабораторию и завершённое полугодие.'));
    heading.append(headingCopy);
    const form = make('form', 'report-parameters-form'); form.noValidate = true;
    const laboratoryField = make('label', 'report-form-field'); laboratoryField.append(make('span', '', 'Лаборатория *'));
    const laboratory = make('select'); laboratory.id = 'report-laboratory'; laboratory.required = true; laboratory.append(new Option('Выберите лабораторию', '', true, true)); laboratory.options[0].disabled = true;
    api.laboratories.forEach(item => laboratory.append(new Option(item.name, item.id))); laboratoryField.append(laboratory);
    const periodField = make('label', 'report-form-field'); periodField.append(make('span', '', 'Отчётное полугодие *'));
    const period = make('select'); period.id = 'report-period'; period.required = true; period.disabled = true; period.append(new Option('Сначала выберите лабораторию', '')); periodField.append(period);
    const formError = make('div', 'report-form-error'); formError.hidden = true; formError.setAttribute('role', 'alert');
    const generate = appButton({ label: 'Сформировать отчёт', busyLabel: 'Формируем…', variant: 'primary', type: 'submit', icon: icon('admin-reports') });
    form.append(laboratoryField, periodField, formError, make('div', 'report-parameters-actions'));
    form.querySelector('.report-parameters-actions').append(generate);
    step.append(heading, form);
    const preview = make('div', 'report-preview'); preview.hidden = true;
    root.append(feedback, step, preview);
    let currentPreview = null; let dirty = false; let generated = false; let pendingHref = '';
    const navigationGuard = createDecisionDialog({
      title: 'Изменения не сохранены',
      description: 'Несохранённый отчёт будет потерян при переходе на другую страницу.',
      confirmLabel: 'Выйти без сохранения',
      onConfirm: dialog => {
        dirty = false; generated = false;
        dialog.close('leave');
        if (pendingHref) location.href = pendingHref;
      },
    });
    root.append(navigationGuard.dialog);

    const updatePeriods = () => {
      period.replaceChildren();
      const periods = api.getAvailablePeriods(laboratory.value);
      if (!laboratory.value) { period.append(new Option('Сначала выберите лабораторию', '')); period.disabled = true; return; }
      if (!periods.length) { period.append(new Option('Все завершённые периоды уже сформированы', '')); period.disabled = true; return; }
      periods.forEach((item, index) => period.append(new Option(api.periodLabel(item), `${item.year}-${item.half}`, index === 0, index === 0)));
      period.disabled = false;
    };
    laboratory.addEventListener('change', () => { updatePeriods(); formError.hidden = true; });
    updatePeriods();

    const renderPreview = report => {
      generated = true; currentPreview = report; step.hidden = true; preview.hidden = false; preview.replaceChildren();
      const previewHead = make('div', 'report-preview-head');
      const copy = make('div'); copy.append(make('h2', '', 'Предварительный просмотр'), make('p', '', 'Расчёт зафиксирован для текущего заполнения. Проверьте сведения и заполните коды.'));
      const change = make('button', 'report-change-parameters', 'Изменить параметры'); change.type = 'button';
      previewHead.append(copy, change);
      const summary = api.createReportSummary(report);
      const organization = api.createOrganizationHeader(report, { editableCodes: true });
      const matrix = api.createReportMatrix(report);
      const actionBar = make('div', 'report-sticky-actions');
      const cancel = appButton({ label: 'Отмена', variant: 'secondary' });
      const save = appButton({ label: 'Сохранить отчёт', busyLabel: 'Сохраняем…', variant: 'primary', icon: icon('admin-save') }); save.setDisabled(true);
      actionBar.append(cancel, save);
      preview.append(previewHead, summary, organization, matrix, actionBar);
      const controls = [...organization.codeControls.values()];
      const updateSave = () => { dirty = controls.some(({ input }) => input.value !== ''); save.setDisabled(!controls.every(({ input }) => input.value.trim())); };
      controls.forEach(({ input, error }) => input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); error.hidden = true; updateSave(); }));
      const discard = createDecisionDialog({ title: 'Изменения не сохранены', description: 'Предварительный расчёт и введённые коды будут потеряны.', confirmLabel: 'Выйти без сохранения', onConfirm: dialog => { dialog.close('discard'); dirty = false; generated = false; currentPreview = null; preview.hidden = true; step.hidden = false; preview.replaceChildren(); } });
      root.append(discard.dialog);
      change.addEventListener('click', event => { if (dirty) discard.dialog.openFor(event.currentTarget); else { dirty = false; generated = false; currentPreview = null; preview.hidden = true; step.hidden = false; preview.replaceChildren(); } });
      cancel.addEventListener('click', event => { if (dirty || generated) { const control = createDecisionDialog({ title: 'Изменения не сохранены', description: 'Несохранённый отчёт будет потерян.', confirmLabel: 'Выйти без сохранения', onConfirm: () => { dirty = false; generated = false; location.href = links.list || 'admin-reports.html'; } }); root.append(control.dialog); control.dialog.openFor(event.currentTarget); } else location.href = links.list || 'admin-reports.html'; });
      save.addEventListener('click', async () => {
        let firstInvalid = null; const codes = {};
        organization.codeControls.forEach(({ input, error }, key) => {
          const value = input.value.trim(); codes[key] = value;
          if (!value) { error.textContent = 'Заполните обязательный код.'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', error.id); firstInvalid ||= input; }
        });
        if (firstInvalid) { firstInvalid.focus(); return; }
        save.setBusy(true); cancel.disabled = true; change.disabled = true;
        try {
          await new Promise(resolve => setTimeout(resolve, 420));
          const saved = api.saveReport({ ...currentPreview, codes });
          dirty = false; generated = false;
          location.href = `${links.view || 'admin-report-view.html'}?id=${encodeURIComponent(saved.id)}`;
        } catch (error) {
          save.setBusy(false); cancel.disabled = false; change.disabled = false;
          if (error.code === 'DUPLICATE') announce(root, 'Отчёт за этот период уже создан. Откройте существующий отчёт из списка.', 'error');
          else announce(root, 'Не удалось сохранить отчёт. Введённые данные сохранены на странице.', 'error');
        }
      });
      updateSave();
    };

    form.addEventListener('submit', async event => {
      event.preventDefault(); formError.hidden = true;
      if (!laboratory.value || !period.value) { formError.textContent = 'Выберите лабораторию и отчётное полугодие.'; formError.hidden = false; (!laboratory.value ? laboratory : period).focus(); return; }
      generate.setBusy(true); laboratory.disabled = true; period.disabled = true;
      try {
        await new Promise(resolve => setTimeout(resolve, 420));
        const [year, half] = period.value.split('-').map(Number);
        renderPreview(api.buildPreview({ laboratoryId: laboratory.value, year, half }));
      } catch (error) {
        formError.textContent = error.code === 'NO_DATA' ? 'Нет данных для формирования отчёта.' : error.message || 'Не удалось сформировать отчёт. Повторите попытку.';
        formError.hidden = false;
      } finally { generate.setBusy(false); laboratory.disabled = false; updatePeriods(); }
    });
    document.addEventListener('click', event => {
      if (!root.isConnected || (!dirty && !generated) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download') || link.target === '_blank') return;
      const href = link.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript:')) return;
      event.preventDefault();
      pendingHref = link.href;
      navigationGuard.dialog.openFor(link);
    }, true);
    window.addEventListener('beforeunload', event => { if (!dirty && !generated) return; event.preventDefault(); event.returnValue = ''; });
    return root;
  };

  api.createReportView = ({ report, links = {} } = {}) => {
    const root = make('div', 'report-view');
    const feedback = make('div', 'report-feedback'); feedback.dataset.reportFeedback = ''; feedback.hidden = true;
    if (!report) {
      const state = make('section', 'report-list-state error'); state.append(icon('admin-warning'), make('h2', '', 'Отчёт не найден'), make('p', '', 'Возможно, он был удалён или ссылка устарела.'));
      const back = make('a', 'vse-app app-button secondary', 'К списку отчётов'); back.href = links.list || 'admin-reports.html'; state.append(back); root.append(state); return root;
    }
    const actions = make('div', 'report-view-actions');
    const excel = appButton({ label: 'Скачать Excel', variant: 'secondary', icon: icon('admin-download'), onClick: () => { downloadSpreadsheet(report); announce(root, 'Excel сформирован по официальной структуре формы 5-вет.'); } });
    const pdf = make('a', 'vse-app app-button secondary'); pdf.href = `${links.print || 'admin-report-print.html'}?id=${encodeURIComponent(report.id)}&mode=pdf`; pdf.append(icon('admin-download'), make('span', '', 'Скачать PDF'));
    const print = make('a', 'vse-app app-button primary'); print.href = `${links.print || 'admin-report-print.html'}?id=${encodeURIComponent(report.id)}&print=1`; print.append(icon('admin-print'), make('span', '', 'Распечатать'));
    const remove = appButton({ label: 'Удалить', variant: 'danger', icon: icon('admin-delete') });
    actions.append(excel, pdf, print, remove);
    const dialog = api.createReportDeleteDialog({ onDeleted: () => { location.href = links.list || 'admin-reports.html'; } });
    remove.addEventListener('click', event => dialog.openForReport(report, event.currentTarget));
    root.append(feedback, actions, api.createReportSummary(report), api.createOrganizationHeader(report), api.createReportMatrix(report), dialog);
    return root;
  };

  api.createPrintView = report => {
    const root = make('main', 'report-print-page');
    if (!report) { root.append(make('h1', '', 'Отчёт не найден')); return root; }
    root.append(api.createOfficialReport(report));
    return root;
  };
})();
