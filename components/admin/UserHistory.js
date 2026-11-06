(() => {
  const api = globalThis.VseAdmin ||= {};
  const PAGE_SIZE = 20;
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const icon = name => globalThis.VseIcons.create(name, { className: 'admin-icon' });
  const statusLabel = value => api.statuses[value] || value || 'Не назначено';
  const listText = values => values?.length ? values.join(', ') : 'Не назначено';
  const dateText = value => new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(value)).replace(',', '');
  const filters = Object.freeze([
    ['', 'Все события'], ['creation', 'Создание'], ['data', 'Данные пользователя'],
    ['permissions', 'Права'], ['products', 'Продукция'], ['status', 'Статус'],
    ['deletion', 'Удаление'],
  ]);
  const categoriesOf = event => {
    if (event.type === 'created') return ['creation'];
    if (event.type === 'blocked' || event.type === 'unblocked') return ['status'];
    if (event.type === 'deleted') return ['deletion'];
    if (event.type === 'update') {
      const result = [];
      if (event.changes?.some(change => change.kind === 'field')) result.push('data');
      if (event.changes?.some(change => change.kind === 'permissions')) result.push('permissions');
      if (event.changes?.some(change => change.kind === 'products')) result.push('products');
      return result;
    }
    return [];
  };
  const titleOf = event => ({
    created: 'Пользователь создан', update: 'Данные пользователя изменены',
    blocked: 'Пользователь заблокирован', unblocked: 'Пользователь разблокирован',
    deleted: 'Пользователь удалён',
  })[event.type] || 'Изменение пользователя';

  const detail = (label, value, tone = '') => {
    const row = make('div', `admin-history-detail${tone ? ` ${tone}` : ''}`);
    row.append(make('dt', '', label), make('dd', '', value || 'Не назначено'));
    return row;
  };
  const detailsOf = event => {
    if (event.type === 'created') return [
      detail('Исходные права', listText(event.permissions)),
      detail('Исходная продукция', listText(event.products)),
    ];
    if (event.type === 'update') return (event.changes || []).flatMap(change => {
      if (change.kind === 'field') return [detail(change.label, `${change.before || 'Не назначено'} → ${change.after || 'Не назначено'}`)];
      const name = change.kind === 'permissions' ? 'Права' : 'Продукция';
      return [
        detail(`${name} · добавлено`, listText(change.added), change.added?.length ? 'added' : ''),
        detail(`${name} · отозвано`, listText(change.removed), change.removed?.length ? 'removed' : ''),
      ];
    });
    if (event.type === 'blocked' || event.type === 'unblocked') return [
      detail('Статус', `${statusLabel(event.previousStatus)} → ${statusLabel(event.status)}`),
    ];
    if (event.type === 'deleted') return [
      detail('Прежний ID', event.userId), detail('Отображаемое имя', event.userName),
      detail('Прежний статус', statusLabel(event.previousStatus)),
    ];
    return [detail('Детали', 'Не назначено')];
  };

  /** Одна неизменяемая запись административной истории. */
  api.createUserHistoryEvent = event => {
    const article = make('article', 'admin-history-event');
    article.dataset.eventId = event.id || '';
    const marker = make('span', 'admin-history-marker');
    marker.append(icon('admin-history'));
    const head = make('div', 'admin-history-event-head');
    const title = make('h3', '', titleOf(event));
    const time = document.createElement('time');
    time.dateTime = event.at;
    time.textContent = dateText(event.at);
    head.append(title, time);
    const actor = make('p', 'admin-history-actor', `Исполнитель: ${event.actor || 'Система'}`);
    const rows = detailsOf(event);
    const list = make('dl', 'admin-history-details');
    rows.forEach((row, index) => { if (index >= 3) row.hidden = true; list.append(row); });
    article.append(marker, head, actor, list);
    if (rows.length > 3) {
      const toggle = make('button', 'admin-history-toggle', 'Показать изменения');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        rows.slice(3).forEach(row => { row.hidden = expanded; });
        toggle.textContent = expanded ? 'Показать изменения' : 'Скрыть изменения';
      });
      article.append(toggle);
    }
    return article;
  };

  /** Read only история пользователя с фильтром и пагинацией. */
  api.createUserHistory = ({
    user = {}, events = [], initialState = 'ready', restoreState = true, onRetry,
  } = {}) => {
    const key = `vse-admin-user-history-state-v1:${user.id || 'unknown'}`;
    let saved = {};
    if (restoreState) try { saved = JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { saved = {}; }
    const state = { filter: saved.filter || '', page: Math.max(1, Number(saved.page) || 1), view: initialState };
    const root = make('section', 'admin-user-history');
    root.setAttribute('aria-label', 'История изменений пользователя');
    const summary = make('div', 'admin-history-summary');
    summary.append(
      globalThis.VseApp.createInfoField({ label: 'Фамилия и имя', value: user.name || '—' }),
      globalThis.VseApp.createInfoField({ label: 'Логин', value: user.login || '—' }),
    );
    if (user.deleted) summary.append(make('span', 'admin-history-deleted', 'Пользователь удалён'));
    const timezone = make('p', 'admin-history-timezone', 'Время указано по Москве (МСК)');
    const controls = make('div', 'admin-history-controls');
    const field = make('div', 'admin-filter');
    const label = make('label', '', 'Событие');
    label.htmlFor = 'admin-history-filter';
    const select = document.createElement('select');
    select.id = 'admin-history-filter';
    filters.forEach(([value, text]) => select.add(new Option(text, value, false, state.filter === value)));
    const reset = make('button', 'admin-reset', 'Сбросить');
    reset.type = 'button';
    field.append(label, select);
    controls.append(field, reset);
    const content = make('div', 'admin-history-content');
    const pagination = make('nav', 'admin-pagination');
    pagination.setAttribute('aria-label', 'Страницы истории изменений');
    root.append(summary, timezone, controls, content, pagination);
    const persist = () => { if (restoreState) try { sessionStorage.setItem(key, JSON.stringify({ filter: state.filter, page: state.page })); } catch { /* session-only */ } };
    const statePanel = (kind, title, description, action = '') => {
      const panel = make('div', `admin-list-state ${kind}`);
      panel.append(icon(kind === 'error' ? 'admin-retry' : 'admin-history'), make('h2', '', title), make('p', '', description));
      if (action) {
        const button = make('button', 'app-button secondary', action);
        button.type = 'button';
        button.addEventListener('click', () => onRetry ? onRetry(root) : root.setViewState('ready'));
        panel.append(button);
      }
      return panel;
    };
    const filtered = () => events.filter(event => !state.filter || categoriesOf(event).includes(state.filter))
      .sort((a, b) => new Date(b.at) - new Date(a.at) || String(b.id).localeCompare(String(a.id), 'ru'));
    const renderPagination = total => {
      pagination.replaceChildren();
      if (!total) return;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      state.page = Math.min(state.page, pages);
      const from = (state.page - 1) * PAGE_SIZE + 1;
      const to = Math.min(state.page * PAGE_SIZE, total);
      const count = make('span', 'admin-pagination-count', `Показано ${from}–${to} из ${total}`);
      const actions = make('div', 'admin-pagination-actions');
      const pageButton = (iconName, name, page, disabled) => {
        const button = make('button', 'admin-page-button');
        button.type = 'button';
        button.disabled = disabled;
        button.setAttribute('aria-label', name);
        button.append(icon(iconName));
        button.addEventListener('click', () => { state.page = page; persist(); render(); root.scrollIntoView({ block: 'start' }); });
        return button;
      };
      actions.append(
        pageButton('chevron-left', 'Предыдущая страница', state.page - 1, state.page === 1),
        make('span', 'admin-page-current', `${state.page} из ${pages}`),
        pageButton('chevron-right', 'Следующая страница', state.page + 1, state.page === pages),
      );
      pagination.append(count, actions);
    };
    const render = () => {
      content.replaceChildren();
      pagination.replaceChildren();
      controls.hidden = state.view !== 'ready';
      if (state.view === 'loading') {
        const loading = make('div', 'admin-loading');
        loading.setAttribute('role', 'status');
        loading.setAttribute('aria-label', 'Загрузка истории');
        loading.append(make('span'), make('span'), make('span'));
        content.append(loading);
        return;
      }
      if (state.view === 'error') {
        content.append(statePanel('error', 'Не удалось загрузить историю', 'Проверьте соединение и повторите попытку.', 'Повторить'));
        return;
      }
      const result = filtered();
      if (!events.length) {
        content.append(statePanel('empty', 'История пока пуста', 'Для этого пользователя ещё нет сохранённых изменений.'));
        return;
      }
      if (!result.length) {
        content.append(statePanel('empty', 'События не найдены', 'По выбранному фильтру событий нет.'));
        return;
      }
      const from = (state.page - 1) * PAGE_SIZE;
      result.slice(from, from + PAGE_SIZE).forEach(event => content.append(api.createUserHistoryEvent(event)));
      renderPagination(result.length);
    };
    select.addEventListener('change', () => { state.filter = select.value; state.page = 1; persist(); render(); });
    reset.addEventListener('click', () => { state.filter = ''; state.page = 1; select.value = ''; persist(); render(); select.focus(); });
    root.setViewState = value => { state.view = value; render(); };
    root.setEvents = value => { events = [...value]; state.page = 1; render(); };
    root.controls = { filter: select, reset };
    render();
    return root;
  };
})();
