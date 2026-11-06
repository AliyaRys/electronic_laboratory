(() => {
  const admin = globalThis.VseAdmin ||= {};
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const statusLabel = status => admin.statuses?.[status] || status;
  const operationId = () => globalThis.crypto?.randomUUID?.() || `delete-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  /** Shared deletion dialog. Linked documents are checked before the destructive action becomes available. */
  admin.createUserDeleteDialog = ({
    adapter = globalThis.VseAdminDemo,
    onDeleted = () => {},
    onRequestBlock = () => {},
  } = {}) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'admin-user-delete-dialog';
    dialog.setAttribute('aria-labelledby', 'admin-user-delete-title');
    dialog.setAttribute('aria-describedby', 'admin-user-delete-description');
    const box = make('div', 'admin-user-delete-box');
    const head = make('div', 'admin-user-delete-head');
    const title = make('h2');
    title.id = 'admin-user-delete-title';
    const close = make('button', 'admin-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.append(globalThis.VseIcons.create('admin-clear', { className: 'admin-icon' }));
    head.append(title, close);
    const description = make('p', 'admin-user-delete-description');
    description.id = 'admin-user-delete-description';
    const facts = make('div', 'admin-user-delete-facts');
    const message = make('div', 'admin-user-delete-message');
    message.setAttribute('role', 'alert');
    message.hidden = true;
    const actions = make('div', 'admin-user-delete-actions');
    const safe = globalThis.VseApp.createButton({ label: 'Отмена', variant: 'secondary' });
    const primarySlot = make('span', 'admin-user-delete-primary-slot');
    actions.append(safe, primarySlot);
    box.append(head, description, facts, message, actions);
    dialog.append(box);

    let currentUser = null;
    let returnFocus = null;
    let state = 'checking';
    let requestToken = 0;
    let busy = false;
    let currentOperationId = null;
    let checkOptions = {};
    let deleteOptions = {};

    const resultText = () => {
      if (state === 'checking') return 'Проверка выполняется';
      if (state === 'allowed' || state === 'delete-error') return 'Связанных рабочих документов не найдено';
      if (state === 'linked') {
        const count = Number(currentUser.linkedDocumentCount) || 1;
        const suffix = count % 10 === 1 && count % 100 !== 11
          ? 'связанный рабочий документ'
          : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
            ? 'связанных рабочих документа'
            : 'связанных рабочих документов';
        return `${count} ${suffix}`;
      }
      return 'Проверка не завершена';
    };
    const renderFacts = () => {
      facts.replaceChildren(
        globalThis.VseApp.createInfoField({ label: 'Фамилия и имя', value: currentUser.name, wide: true }),
        globalThis.VseApp.createInfoField({ label: 'Логин', value: currentUser.login }),
        globalThis.VseApp.createInfoField({ label: 'Статус', value: statusLabel(currentUser.status) }),
        globalThis.VseApp.createInfoField({ label: 'Связанные документы', value: resultText(), wide: true }),
      );
    };
    const actionButton = options => {
      const button = globalThis.VseApp.createButton(options);
      primarySlot.replaceChildren(button);
      return button;
    };
    const render = () => {
      safe.setDisabled(busy);
      safe.querySelector('span').textContent = state === 'linked' ? 'Закрыть' : 'Отмена';
      close.disabled = busy;
      message.hidden = true;
      primarySlot.replaceChildren();
      if (state === 'checking') {
        title.textContent = 'Проверяем связанные документы…';
        description.textContent = 'Подтверждение станет доступно после проверки.';
      } else if (state === 'allowed' || state === 'delete-error') {
        title.textContent = 'Удалить пользователя?';
        description.textContent = 'Учётная запись будет удалена, вход станет недоступен. Отменить удаление в интерфейсе нельзя. История административных изменений сохранится.';
        const button = actionButton({
          label: 'Удалить пользователя', busyLabel: 'Удаляем…', variant: 'danger',
          icon: globalThis.VseIcons.create('admin-delete', { className: 'admin-icon' }),
          onClick: submitDelete,
        });
        button.setBusy(busy);
        if (state === 'delete-error') {
          message.textContent = 'Не удалось удалить пользователя. Проверьте соединение и повторите попытку.';
          message.hidden = false;
        }
      } else if (state === 'linked') {
        title.textContent = 'Пользователя нельзя удалить';
        description.textContent = 'У пользователя есть связанные рабочие документы. Заблокируйте учётную запись, чтобы закрыть доступ и сохранить авторство.';
        if (currentUser.status === 'blocked') {
          message.textContent = 'Пользователь уже заблокирован.';
          message.hidden = false;
        } else {
          actionButton({
            label: 'Заблокировать', variant: 'primary',
            icon: globalThis.VseIcons.create('admin-lock', { className: 'admin-icon' }),
            onClick: requestBlock,
          });
        }
      } else {
        title.textContent = 'Не удалось проверить связанные документы';
        description.textContent = 'Без результата проверки удаление недоступно.';
        actionButton({
          label: 'Повторить проверку', variant: 'primary',
          icon: globalThis.VseIcons.create('admin-retry', { className: 'admin-icon' }),
          onClick: runCheck,
        });
        if (state === 'conflict') {
          message.textContent = 'Данные пользователя изменились. Выполните проверку ещё раз.';
          message.hidden = false;
        }
      }
      renderFacts();
    };
    const finishClose = ({ restoreFocus = true } = {}) => {
      requestToken += 1;
      if (dialog.open) dialog.close();
      const target = returnFocus;
      currentUser = null;
      currentOperationId = null;
      if (restoreFocus && target?.isConnected) target.focus();
      returnFocus = null;
    };
    async function runCheck() {
      if (!currentUser || busy) return;
      const token = ++requestToken;
      state = 'checking';
      render();
      try {
        const result = await adapter.checkUserDeletion(currentUser.id, checkOptions);
        if (token !== requestToken || !dialog.open) return;
        currentUser = { ...result.user, linkedDocumentCount: result.linkedDocumentCount };
        state = result.linkedDocumentCount > 0 ? 'linked' : 'allowed';
        render();
      } catch (error) {
        if (token !== requestToken || !dialog.open) return;
        state = error.code === 'version-conflict' ? 'conflict' : 'check-error';
        render();
      }
    }
    async function submitDelete() {
      if (!currentUser || busy) return;
      busy = true;
      currentOperationId ||= operationId();
      render();
      try {
        const result = await adapter.deleteUser(currentUser.id, {
          ...deleteOptions,
          operationId: currentOperationId,
          expectedVersion: currentUser.version,
        });
        const deletedUser = result.user;
        const focusTarget = returnFocus;
        finishClose({ restoreFocus: false });
        onDeleted(deletedUser, { message: 'Пользователь удалён', focusTarget });
      } catch (error) {
        currentOperationId = null;
        if (error.code === 'linked-documents') {
          currentUser = { ...error.user, linkedDocumentCount: error.linkedDocumentCount };
          state = 'linked';
        } else if (error.code === 'version-conflict') {
          currentUser = error.user || currentUser;
          state = 'conflict';
        } else if (error.code === 'not-found' || error.code === 'forbidden') {
          state = 'check-error';
          message.textContent = error.message;
        } else state = 'delete-error';
      } finally {
        busy = false;
        if (dialog.open) render();
      }
    }
    function requestBlock() {
      const user = currentUser;
      const trigger = returnFocus;
      finishClose({ restoreFocus: false });
      requestAnimationFrame(() => onRequestBlock(user, trigger));
    }

    dialog.openFor = ({ user, trigger = document.activeElement, check = {}, deletion = {} } = {}) => {
      if (!user) throw new TypeError('Для диалога требуется пользователь');
      currentUser = { ...user, products: [...(user.products || [])], permissions: [...(user.permissions || [])] };
      returnFocus = trigger;
      checkOptions = check;
      deleteOptions = deletion;
      currentOperationId = null;
      busy = false;
      if (!dialog.open) dialog.showModal();
      render();
      requestAnimationFrame(() => safe.focus());
      runCheck();
    };
    dialog.closeDialog = finishClose;
    dialog.getState = () => state;
    safe.addEventListener('click', () => { if (!busy) finishClose(); });
    close.addEventListener('click', () => { if (!busy) finishClose(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) finishClose(); });
    dialog.addEventListener('click', event => { if (event.target === dialog && !busy) finishClose(); });
    return dialog;
  };
})();
