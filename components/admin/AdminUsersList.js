(() => {
  const api = globalThis.VseAdmin ||= {};
  const PAGE_SIZE = 20;
  const stateKey = 'vse-admin-users-list-state-v1';
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const icon = name => globalThis.VseIcons.create(name, { className: 'admin-icon' });
  const productLabel = code => api.products.find(item => item.code === code)?.label || code;
  const productCount = count => {
    if (!count) return 'Не назначена';
    const suffix = count === 1 ? 'тип' : count < 5 ? 'типа' : 'типов';
    return `${count} ${suffix}`;
  };
  const dateText = value => new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(value)).replace(',', '');

  const readState = () => {
    try { return JSON.parse(sessionStorage.getItem(stateKey) || '{}'); } catch { return {}; }
  };
  const saveState = state => {
    try { sessionStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* session-only fallback */ }
  };

  api.createUsersList = ({
    users = api.createDemoUsers(),
    initialState = 'ready',
    restoreState = true,
    enabledUsers = null,
    links = {},
    adapter = globalThis.VseAdminDemo,
    onRetry,
  } = {}) => {
    const isDemoEnabled = id => !enabledUsers || enabledUsers.includes(id);
    let source = users.map(user => ({ ...user, products: [...user.products] }));
    const saved = restoreState ? readState() : {};
    const state = {
      query: saved.query || '', status: saved.status || '', product: saved.product || '',
      sort: saved.sort || 'newest', page: Math.max(1, Number(saved.page) || 1),
    };
    const root = make('section', 'admin-users-list');
    root.setAttribute('aria-label', 'Список пользователей лаборатории');
    const feedback = make('div', 'admin-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.hidden = true;

    const controls = make('div', 'admin-list-controls');
    const searchField = make('div', 'admin-filter admin-search-field');
    const searchLabel = make('label', '', 'Поиск');
    searchLabel.htmlFor = 'admin-user-search';
    const searchWrap = make('div', 'admin-search-control');
    searchWrap.append(icon('admin-search'));
    const search = document.createElement('input');
    search.id = 'admin-user-search';
    search.type = 'search';
    search.placeholder = 'ФИО, логин или email';
    search.value = state.query;
    search.autocomplete = 'off';
    const clearSearch = make('button', 'admin-clear-search');
    clearSearch.type = 'button';
    clearSearch.setAttribute('aria-label', 'Очистить поиск');
    clearSearch.append(icon('admin-clear'));
    searchWrap.append(search, clearSearch);
    searchField.append(searchLabel, searchWrap);

    const createSelect = (id, labelText, options, value) => {
      const field = make('div', 'admin-filter');
      const label = make('label', '', labelText);
      label.htmlFor = id;
      const select = document.createElement('select');
      select.id = id;
      options.forEach(([optionValue, optionLabel]) => {
        const option = new Option(optionLabel, optionValue, false, optionValue === value);
        select.add(option);
      });
      field.append(label, select);
      return { field, select };
    };
    const statusFilter = createSelect('admin-status-filter', 'Статус', [
      ['', 'Все статусы'], ...Object.entries(api.statuses),
    ], state.status);
    const productFilter = createSelect('admin-product-filter', 'Тип продукции', [
      ['', 'Все типы'], ...api.products.map(item => [item.code, item.label]),
    ], state.product);
    const sortControl = createSelect('admin-sort', 'Сортировка', [
      ['newest', 'Сначала новые'], ['name', 'По имени А–Я'],
    ], state.sort);
    const reset = make('button', 'admin-reset', 'Сбросить фильтры');
    reset.type = 'button';
    controls.append(searchField, statusFilter.field, productFilter.field, sortControl.field, reset);

    const content = make('div', 'admin-list-content');
    const pagination = make('nav', 'admin-pagination');
    pagination.setAttribute('aria-label', 'Страницы списка пользователей');
    root.append(feedback, controls, content, pagination);

    const announce = message => {
      feedback.textContent = message;
      feedback.hidden = false;
      window.clearTimeout(feedback.hideTimer);
      feedback.hideTimer = window.setTimeout(() => { feedback.hidden = true; }, 4500);
    };
    const statusDialog = api.createUserStatusDialog({
      adapter,
      onSuccess: (updatedUser, detail) => {
        source = source.map(item => item.id === updatedUser.id ? { ...updatedUser, products: [...updatedUser.products] } : item);
        announce(detail.message);
        render();
      },
    });
    const deleteDialog = api.createUserDeleteDialog({
      adapter,
      onDeleted: deletedUser => {
        const visibleBefore = getFiltered();
        const deletedIndex = visibleBefore.findIndex(item => item.id === deletedUser.id);
        const nextId = visibleBefore[deletedIndex + 1]?.id || visibleBefore[deletedIndex - 1]?.id;
        source = source.filter(item => item.id !== deletedUser.id);
        announce('Пользователь удалён');
        render();
        const nextTarget = nextId && root.querySelector(`tr[data-user-id="${CSS.escape(nextId)}"] .admin-user-name`);
        (nextTarget || search).focus();
      },
      onRequestBlock: (user, trigger) => statusDialog.openFor({ user, trigger }),
    });
    root.append(statusDialog, deleteDialog);
    const persist = () => saveState({ ...state, scrollY: window.scrollY });
    const closeMenus = except => {
      root.querySelectorAll('details[open]').forEach(menu => { if (menu !== except) menu.removeAttribute('open'); });
    };
    const statePanel = (kind, title, description, actionLabel = '') => {
      const panel = make('div', `admin-list-state ${kind}`);
      panel.append(icon(kind === 'error' ? 'admin-retry' : 'admin-users'), make('h2', '', title), make('p', '', description));
      if (actionLabel) {
        const action = make('button', 'app-button secondary', actionLabel);
        action.type = 'button';
        action.addEventListener('click', () => onRetry ? onRetry(root) : render('ready'));
        panel.append(action);
      }
      return panel;
    };

    const renderPagination = total => {
      pagination.replaceChildren();
      if (!total) return;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const from = (state.page - 1) * PAGE_SIZE + 1;
      const to = Math.min(state.page * PAGE_SIZE, total);
      const count = make('span', 'admin-pagination-count', `Показано ${from}–${to} из ${total}`);
      const actions = make('div', 'admin-pagination-actions');
      const pageButton = (direction, label, disabled, nextPage) => {
        const button = make('button', 'admin-page-button');
        button.type = 'button';
        button.disabled = disabled;
        button.setAttribute('aria-label', label);
        button.append(icon(direction));
        button.addEventListener('click', () => { state.page = nextPage; persist(); render(); root.scrollIntoView({ block: 'start' }); });
        return button;
      };
      actions.append(
        pageButton('chevron-left', 'Предыдущая страница', state.page === 1, state.page - 1),
        make('span', 'admin-page-current', `${state.page} из ${pages}`),
        pageButton('chevron-right', 'Следующая страница', state.page === pages, state.page + 1),
      );
      pagination.append(count, actions);
    };

    const getFiltered = () => {
      const query = state.query.trim().toLocaleLowerCase('ru-RU');
      const result = source.filter(user => {
        const searchable = `${user.name} ${user.login} ${user.email}`.toLocaleLowerCase('ru-RU');
        return (!query || searchable.includes(query)) &&
          (!state.status || user.status === state.status) &&
          (!state.product || user.products.includes(state.product));
      });
      result.sort((a, b) => {
        const primary = state.sort === 'name'
          ? a.name.localeCompare(b.name, 'ru')
          : new Date(b.createdAt) - new Date(a.createdAt);
        return primary || a.id.localeCompare(b.id);
      });
      return result;
    };

    const actionItem = (label, iconName, handler, danger = false) => {
      const button = make('button', `admin-menu-action${danger ? ' danger' : ''}`);
      button.type = 'button';
      button.append(icon(iconName), make('span', '', label));
      button.addEventListener('click', handler);
      return button;
    };

    const userRow = user => {
      const row = document.createElement('tr');
      row.dataset.userId = user.id;
      const demoEnabled = isDemoEnabled(user.id);
      const userCell = document.createElement('td');
      userCell.dataset.label = 'Пользователь';
      if (demoEnabled) {
        const name = make('a', 'admin-user-name', user.name);
        name.href = `${links.card || 'admin-user-edit.html'}?id=${encodeURIComponent(user.id)}`;
        name.addEventListener('click', persist);
        userCell.append(name);
      } else {
        userCell.append(make('span', 'admin-user-name disabled', user.name));
      }
      userCell.append(make('span', 'admin-user-login', user.login));

      const productsCell = document.createElement('td');
      productsCell.dataset.label = 'Продукция';
      if (demoEnabled) {
        const productLink = make('a', `admin-product-count${user.products.length ? '' : ' empty'}`, productCount(user.products.length));
        productLink.href = `${links.card || 'admin-user-edit.html'}?id=${encodeURIComponent(user.id)}#access`;
        productLink.title = user.products.length ? user.products.map(productLabel).join('\n') : 'Типы продукции не назначены';
        productLink.addEventListener('click', persist);
        productsCell.append(productLink);
      } else {
        productsCell.append(make('span', `admin-product-count${user.products.length ? '' : ' empty'} disabled`, productCount(user.products.length)));
      }

      const statusCell = document.createElement('td');
      statusCell.dataset.label = 'Статус';
      statusCell.append(make('span', `admin-status ${user.status}`, api.statuses[user.status]));
      const dateCell = document.createElement('td');
      dateCell.dataset.label = 'Дата создания';
      const time = document.createElement('time');
      time.dateTime = user.createdAt;
      time.textContent = dateText(user.createdAt);
      dateCell.append(time);

      const actionsCell = document.createElement('td');
      actionsCell.dataset.label = 'Действия';
      const actions = make('div', 'admin-row-actions');
      let edit;
      if (demoEnabled) {
        edit = make('a', 'admin-icon-button');
        edit.href = `${links.edit || 'admin-user-edit.html'}?id=${encodeURIComponent(user.id)}`;
        edit.setAttribute('aria-label', `Редактировать пользователя ${user.name}`);
        edit.dataset.tooltip = 'Редактировать';
        edit.append(icon('admin-edit'));
        edit.addEventListener('click', persist);
        actions.append(edit);
      } else {
        edit = make('button', 'admin-icon-button disabled');
        edit.type = 'button';
        edit.disabled = true;
        edit.setAttribute('aria-label', `Редактирование пользователя ${user.name} недоступно в демонстрации`);
        edit.dataset.tooltip = 'Недоступно в демонстрации';
        edit.append(icon('admin-edit'));
        actions.append(edit);
      }
      const menu = document.createElement('details');
      menu.className = 'admin-actions-menu';
      const trigger = document.createElement('summary');
      trigger.className = 'admin-icon-button';
      trigger.setAttribute('aria-label', `Дополнительные действия для пользователя ${user.name}`);
      trigger.dataset.tooltip = 'Дополнительные действия';
      trigger.append(icon('admin-more'));
      const popover = make('div', 'admin-actions-popover');
      if (demoEnabled) {
        const history = make('a', 'admin-menu-action');
        history.href = `${links.history || 'admin-user-history.html'}?id=${encodeURIComponent(user.id)}`;
        history.append(icon('admin-history'), make('span', '', 'История изменений'));
        history.addEventListener('click', persist);
        popover.append(history);
      }
      popover.append(actionItem(user.status === 'blocked' ? 'Разблокировать' : 'Заблокировать', user.status === 'blocked' ? 'admin-unlock' : 'admin-lock', event => {
        menu.removeAttribute('open');
        statusDialog.openFor({ user, trigger });
      }));
      popover.append(actionItem('Удалить пользователя', 'admin-delete', () => {
        menu.removeAttribute('open');
        deleteDialog.openFor({ user, trigger });
      }, true));
      menu.append(trigger, popover);
      menu.addEventListener('toggle', () => { if (menu.open) closeMenus(menu); });
      actions.append(edit, menu);
      actionsCell.append(actions);
      row.append(userCell, productsCell, statusCell, dateCell, actionsCell);
      return row;
    };

    const render = forcedState => {
      const mode = forcedState || initialState;
      clearSearch.hidden = !state.query;
      reset.hidden = !(state.query || state.status || state.product);
      content.replaceChildren();
      pagination.replaceChildren();
      if (mode === 'loading') {
        const skeleton = make('div', 'admin-loading');
        skeleton.setAttribute('role', 'status');
        skeleton.setAttribute('aria-label', 'Загрузка пользователей');
        skeleton.setAttribute('aria-busy', 'true');
        for (let index = 0; index < 6; index += 1) skeleton.append(make('span'));
        content.append(skeleton);
        return;
      }
      if (mode === 'error') {
        content.append(statePanel('error', 'Не удалось загрузить пользователей', 'Проверьте соединение и повторите попытку.', 'Повторить'));
        return;
      }
      const filtered = getFiltered();
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      if (!source.length) {
        const panel = statePanel('empty', 'Пользователей ещё нет', 'Создайте первого пользователя лаборатории.');
        const createLink = make('a', 'app-button primary', 'Создать пользователя');
        createLink.href = links.create || 'admin-user-create.html';
        panel.append(createLink);
        content.append(panel);
        return;
      }
      if (!filtered.length) {
        const panel = statePanel('empty', 'Пользователи не найдены', 'Измените поиск или сбросьте активные фильтры.');
        const button = make('button', 'app-button secondary', 'Сбросить фильтры');
        button.type = 'button';
        button.addEventListener('click', resetFilters);
        panel.append(button);
        content.append(panel);
        return;
      }
      const shell = make('div', 'admin-table-shell');
      const table = document.createElement('table');
      table.className = 'admin-users-table';
      const caption = document.createElement('caption');
      caption.textContent = 'Обычные пользователи Лаборатории ВСЭ №1 г. Казань';
      const head = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Пользователь', 'Продукция', 'Статус', 'Дата создания', 'Действия'].forEach(label => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        headerRow.append(cell);
      });
      head.append(headerRow);
      const body = document.createElement('tbody');
      filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).forEach(user => body.append(userRow(user)));
      table.append(caption, head, body);
      shell.append(table);
      content.append(shell);
      renderPagination(filtered.length);
      persist();
    };

    function resetFilters() {
      state.query = ''; state.status = ''; state.product = ''; state.page = 1;
      search.value = ''; statusFilter.select.value = ''; productFilter.select.value = '';
      render('ready'); search.focus();
    }
    const update = () => {
      state.query = search.value;
      state.status = statusFilter.select.value;
      state.product = productFilter.select.value;
      state.sort = sortControl.select.value;
      state.page = 1;
      render('ready');
    };
    search.addEventListener('input', update);
    [statusFilter.select, productFilter.select, sortControl.select].forEach(select => select.addEventListener('change', update));
    clearSearch.addEventListener('click', () => { search.value = ''; update(); search.focus(); });
    reset.addEventListener('click', resetFilters);
    document.addEventListener('pointerdown', event => { if (root.isConnected && !event.target.closest('.admin-actions-menu')) closeMenus(); });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const open = root.querySelector('details[open]');
        if (open) { event.preventDefault(); open.removeAttribute('open'); open.querySelector('summary')?.focus(); }
      }
    });
    render();
    root.setViewState = nextState => render(nextState);
    root.announce = announce;
    return root;
  };
})();
