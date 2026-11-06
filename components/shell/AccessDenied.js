(() => {
  const api = globalThis.VseAppHeader ||= {};

  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const REASONS = ['no-permission', 'changed', 'product-denied', 'admin-page'];

  /**
   * Общий экран состояния «Нет доступа / доступ отозван».
   * Причина задаётся только кодом из REASONS, не произвольным текстом URL.
   */
  api.createAccessDenied = ({
    reason = 'no-permission',
    checkState, // 'checking' | 'network-error' — приоритетнее reason для demo-состояний
    hasAvailableProducts = true,
    savedView = false,
    links = {},
    onRetryCheck,
  } = {}) => {
    if (!REASONS.includes(reason)) throw new TypeError('Неизвестная причина отказа в доступе');
    if (checkState && !['checking', 'network-error'].includes(checkState)) throw new TypeError('Неизвестное состояние проверки доступа');

    const main = make('main', 'vse-access-denied');
    const card = make('section', 'vse-access-card');

    const actions = make('div', 'vse-access-actions');
    const primary = make('a', 'vse-app app-button primary');
    const secondary = make('a', 'vse-app app-button secondary');
    const messageBlock = make('div', 'vse-access-message');
    messageBlock.setAttribute('role', 'alert');
    const title = make('h1', 'vse-access-title');
    const text = make('p', 'vse-access-text');
    messageBlock.append(title, text);

    const savedLink = make('a', 'vse-access-saved-link');
    const note = make('p', 'vse-access-note');

    if (checkState === 'checking') {
      title.textContent = 'Проверяем доступ…';
      text.textContent = 'Убеждаемся, что раздел остаётся доступным для вашей учётной записи.';
      card.append(messageBlock);
      main.append(card);
      main.dataset.accessState = 'checking';
      return main;
    }
    if (checkState === 'network-error') {
      title.textContent = 'Не удалось проверить доступ';
      text.textContent = 'Сервер недоступен, поэтому данные раздела не открываются. Повторите проверку.';
      card.append(messageBlock);
      const retry = make('button', 'vse-app app-button secondary');
      retry.type = 'button';
      retry.append(make('span', '', 'Повторить проверку'));
      retry.addEventListener('click', () => onRetryCheck?.());
      actions.append(retry);
      card.append(actions);
      main.append(card);
      main.dataset.accessState = 'network-error';
      return main;
    }

    if (reason === 'no-permission') {
      title.textContent = 'Нет доступа';
      text.textContent = 'У вас нет доступа к этому разделу. Обратитесь к администратору лаборатории.';
      primary.href = links.available ?? 'journal.html';
      primary.append(make('span', '', 'Перейти в доступный раздел'));
      secondary.href = links.profile ?? 'profile.html';
      secondary.append(make('span', '', 'Открыть профиль'));
      actions.append(primary, secondary);
      if (savedView) {
        savedLink.href = links.saved ?? 'journal.html';
        savedLink.append('Открыть сохранённую версию');
      }
    } else if (reason === 'changed') {
      title.textContent = 'Доступ изменён';
      text.textContent = 'Администратор изменил ваш доступ. Несохранённые изменения не сохранены.';
      primary.href = links.available ?? 'journal.html';
      primary.append(make('span', '', 'Перейти в доступный раздел'));
      secondary.href = links.profile ?? 'profile.html';
      secondary.append(make('span', '', 'Открыть профиль'));
      actions.append(primary, secondary);
      if (savedView) {
        savedLink.href = links.saved ?? 'journal.html';
        savedLink.append('Открыть сохранённую версию');
      }
    } else if (reason === 'product-denied') {
      title.textContent = 'Нет доступа к этому типу продукции';
      text.textContent = 'Тип продукции больше не доступен для вашей учётной записи. Обратитесь к администратору лаборатории.';
      if (hasAvailableProducts) {
        primary.href = links.products ?? 'journal.html';
        primary.append(make('span', '', 'Выбрать доступную продукцию'));
        actions.append(primary);
      } else {
        title.textContent = 'Типы продукции не назначены';
        text.textContent = 'Доступные типы продукции закончились. Пользователь сможет войти, но не увидит рабочие записи.';
        secondary.href = links.profile ?? 'profile.html';
        secondary.append(make('span', '', 'Открыть профиль'));
        actions.append(secondary);
        note.textContent = 'Следующий шаг: экран «Нет доступной продукции».';
      }
    } else if (reason === 'admin-page') {
      title.textContent = 'Этот раздел недоступен для административной учётной записи';
      text.textContent = 'Рабочие поступления, журнал ВСЭ и справочники остаются доступны специалистам лаборатории.';
      primary.href = links.adminUsers ?? 'admin-users.html';
      primary.append(make('span', '', 'К управлению пользователями'));
      actions.append(primary);
    }

    card.append(messageBlock, actions);
    if (savedLink.textContent) card.append(savedLink);
    if (note.textContent) card.append(note);
    main.append(card);
    main.dataset.accessState = reason;
    return main;
  };
})();
