(() => {
  const api = globalThis.VseAppHeader ||= {};

  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const STATES = ['idle', 'checking', 'unchanged', 'network-error', 'assigned', 'unimplemented', 'revoked'];

  /**
   * Экран состояния «Типы продукции не назначены» для активного обычного пользователя.
   * Шапку в режиме no-products создаёт вызывающий код.
   */
  api.createNoProducts = ({
    state = 'idle',
    permissions = [],
    unimplementedLabel = '',
    otherProducts = [],
    links = {},
    onCheck,
  } = {}) => {
    if (!STATES.includes(state)) throw new TypeError('Неизвестное состояние экрана без продукции');
    const main = make('main', 'vse-access-denied vse-no-products');
    const card = make('section', 'vse-access-card');
    const title = make('h1', 'vse-access-title', 'Типы продукции не назначены');
    const text = make('p', 'vse-access-text', 'Для работы с поступлениями, журналом ВСЭ и справочниками администратор должен назначить вам доступные типы продукции. Обратитесь к администратору вашей лаборатории.');

    const messageBlock = make('div', 'vse-access-message');
    messageBlock.setAttribute('role', 'status');
    messageBlock.append(title, text);

    if (state === 'revoked') {
      const revoked = make('p', 'vse-access-note', 'Доступ был отозван во время работы. Несохранённые изменения не сохранены, сохранённые версии записей остались без изменений.');
      messageBlock.append(revoked);
    }

    if (permissions.length) {
      const rights = make('p', 'vse-no-products-rights', 'Дополнительные права сохранены, но сами по себе не заменяют доступ к продукции.');
      messageBlock.append(rights);
    }

    const actions = make('div', 'vse-access-actions');
    const profile = make('a', 'vse-app app-button secondary');
    profile.href = links.profile ?? 'profile.html';
    profile.append(make('span', '', 'Открыть профиль'));
    actions.append(profile);

    const check = make('button', 'vse-app app-button primary');
    check.type = 'button';
    const checkLabel = make('span', '', 'Проверить доступ');
    check.append(checkLabel);
    actions.append(check);

    const checkMessage = make('p', 'vse-no-products-check-message');
    checkMessage.setAttribute('role', 'status');
    let isChecking = state === 'checking';

    const updateCheck = () => {
      check.disabled = isChecking;
      check.setAttribute('aria-busy', String(isChecking));
      checkLabel.textContent = isChecking ? 'Проверяем…' : 'Проверить доступ';
    };
    updateCheck();

    check.addEventListener('click', async () => {
      if (isChecking) return;
      isChecking = true;
      checkMessage.textContent = '';
      updateCheck();
      const result = await onCheck?.() ?? {};
      isChecking = false;
      updateCheck();
      checkMessage.textContent = result.error
        ? 'Не удалось проверить доступ. Попробуйте ещё раз.'
        : result.message ?? 'Доступные типы продукции пока не назначены.';
      checkMessage.classList.toggle('error', Boolean(result.error));
    });

    if (state === 'checking') {
      isChecking = true;
      updateCheck();
    }
    if (state === 'unchanged') checkMessage.textContent = 'Доступные типы продукции пока не назначены.';
    if (state === 'network-error') checkMessage.textContent = 'Не удалось проверить доступ. Попробуйте ещё раз.';

    if (state === 'unimplemented') {
      const unimplemented = make('p', 'vse-no-products-unimplemented');
      unimplemented.append('Доступ назначен. Раздел для выбранного типа продукции ещё не реализован: ');
      const label = make('strong', '', unimplementedLabel || 'выбранный тип продукции');
      unimplemented.append(label, '.');
      messageBlock.append(unimplemented);
      if (otherProducts.length) {
        const hint = make('p', 'vse-access-note', 'Другие назначенные типы продукции остаются доступны через переключатель в шапке.');
        messageBlock.append(hint);
      }
    }

    card.append(messageBlock, actions, checkMessage);
    main.append(card);
    main.dataset.noProductsState = state;
    return main;
  };
})();
