(() => {
  const admin = globalThis.VseAdmin ||= {};
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const statusLabel = status => admin.statuses?.[status] || status;
  const operationId = () => globalThis.crypto?.randomUUID?.() || `status-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  /** Shared block/unblock dialog. The adapter commits the status; the component never updates optimistically. */
  admin.createUserStatusDialog = ({
    adapter = globalThis.VseAdminDemo,
    onSuccess = () => {},
    onUnavailable = () => {},
  } = {}) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'admin-user-status-dialog';
    dialog.setAttribute('aria-labelledby', 'admin-user-status-title');
    dialog.setAttribute('aria-describedby', 'admin-user-status-description');

    const box = make('div', 'admin-user-status-box');
    const head = make('div', 'admin-user-status-head');
    const title = make('h2');
    title.id = 'admin-user-status-title';
    const close = make('button', 'admin-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.append(globalThis.VseIcons.create('admin-clear', { className: 'admin-icon' }));
    head.append(title, close);

    const description = make('p', 'admin-user-status-description');
    description.id = 'admin-user-status-description';
    const facts = make('div', 'admin-user-status-facts');
    const message = make('div', 'admin-user-status-message');
    message.setAttribute('role', 'alert');
    message.hidden = true;
    const actions = make('div', 'admin-user-status-actions');
    const cancel = globalThis.VseApp.createButton({ label: 'Отмена', variant: 'secondary' });
    let confirm = null;
    actions.append(cancel);
    box.append(head, description, facts, message, actions);
    dialog.append(box);

    let currentUser = null;
    let returnFocus = null;
    let busy = false;
    let currentOperationId = null;

    const mode = () => currentUser?.status === 'blocked' ? 'unblock' : 'block';
    const explanation = () => {
      if (mode() === 'block') return 'Пользователь не сможет работать в системе. Открытые сеансы будут завершены. Несохранённые изменения будут потеряны. Сохранённые документы останутся.';
      return 'Пользователь снова сможет войти. Сохранятся ранее назначенные права и типы продукции.';
    };
    const renderFacts = () => {
      facts.replaceChildren(
        globalThis.VseApp.createInfoField({ label: 'Фамилия и имя', value: currentUser.name, wide: true }),
        globalThis.VseApp.createInfoField({ label: 'Логин', value: currentUser.login }),
        globalThis.VseApp.createInfoField({ label: 'Текущий статус', value: statusLabel(currentUser.status) }),
      );
    };
    const setBusy = value => {
      busy = Boolean(value);
      cancel.setDisabled(busy);
      close.disabled = busy;
      confirm?.setBusy(busy);
    };
    const replaceConfirm = () => {
      confirm?.remove();
      const blocking = mode() === 'block';
      confirm = globalThis.VseApp.createButton({
        label: blocking ? 'Заблокировать' : 'Разблокировать',
        busyLabel: blocking ? 'Блокируем…' : 'Разблокируем…',
        variant: blocking ? 'danger' : 'primary',
        icon: globalThis.VseIcons.create(blocking ? 'admin-lock' : 'admin-unlock', { className: 'admin-icon' }),
        onClick: submit,
      });
      actions.append(confirm);
    };
    const render = () => {
      const blocking = mode() === 'block';
      title.textContent = blocking ? 'Заблокировать пользователя?' : 'Разблокировать пользователя?';
      description.textContent = explanation();
      message.hidden = true;
      message.textContent = '';
      renderFacts();
      replaceConfirm();
    };
    const finishClose = () => {
      if (dialog.open) dialog.close();
      const target = returnFocus;
      currentUser = null;
      currentOperationId = null;
      returnFocus = null;
      if (target?.isConnected) target.focus();
    };
    async function submit() {
      if (busy || !currentUser) return;
      const expectedStatus = currentUser.status;
      const blocking = mode() === 'block';
      currentOperationId ||= operationId();
      setBusy(true);
      message.hidden = true;
      try {
        const result = await adapter.setUserBlocked(currentUser.id, blocking, {
          operationId: currentOperationId,
          expectedStatus,
        });
        currentUser = result.user;
        finishClose();
        onSuccess(result.user, {
          mode: blocking ? 'block' : 'unblock',
          message: blocking ? 'Пользователь заблокирован' : 'Пользователь разблокирован',
        });
      } catch (error) {
        currentOperationId = null;
        if (error.code === 'status-conflict' && error.user) {
          currentUser = error.user;
          render();
          message.textContent = 'Состояние пользователя изменилось. Проверьте новые сведения и выберите действие снова.';
          message.hidden = false;
        } else if (error.code === 'not-found' || error.code === 'unavailable') {
          message.textContent = 'Пользователь больше недоступен. Закройте окно, чтобы обновить список.';
          message.hidden = false;
          confirm.setDisabled(true);
          onUnavailable(error);
        } else {
          message.textContent = error.message || 'Не удалось изменить статус. Повторите попытку.';
          message.hidden = false;
        }
      } finally {
        setBusy(false);
      }
    }

    dialog.openFor = ({ user, trigger = document.activeElement } = {}) => {
      if (!user) throw new TypeError('Для диалога требуется пользователь');
      currentUser = { ...user, products: [...(user.products || [])], permissions: [...(user.permissions || [])] };
      returnFocus = trigger;
      currentOperationId = null;
      render();
      if (!dialog.open) dialog.showModal();
      requestAnimationFrame(() => cancel.focus());
    };
    dialog.closeDialog = finishClose;
    dialog.getUser = () => currentUser && ({ ...currentUser });
    close.addEventListener('click', () => { if (!busy) finishClose(); });
    cancel.addEventListener('click', () => { if (!busy) finishClose(); });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (!busy) finishClose();
    });
    dialog.addEventListener('click', event => { if (event.target === dialog && !busy) finishClose(); });
    return dialog;
  };
})();
