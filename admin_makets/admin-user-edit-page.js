(() => {
  const params = new URLSearchParams(location.search);
  const userId = params.get('user') || params.get('id') || '';
  const stateFlags = {
    failSave: params.get('state') === 'error',
    staleVersion: params.get('state') === 'conflict',
    deletedElsewhere: params.get('state') === 'deleted',
    loadError: params.get('state') === 'load-error',
  };
  const root = document.getElementById('admin-edit-root');
  const feedbackSlot = document.getElementById('admin-feedback-slot');
  const heading = document.getElementById('edit-title');
  const subtitle = document.getElementById('edit-subtitle');
  const unsaved = document.getElementById('unsaved-dialog');
  const unsavedText = document.getElementById('unsaved-text');
  const stay = document.getElementById('stay-editing');
  const leave = document.getElementById('leave-without-save');
  let targetAfterDiscard = 'admin-users.html';
  let returnFocus = null;
  let formApi = null;

  const actor = 'Елена Морозова';

  const announce = (message, kind = 'success') => {
    feedbackSlot.replaceChildren();
    if (!message) return;
    const note = document.createElement('div');
    note.className = `admin-edit-feedback ${kind}`;
    note.setAttribute('role', 'status');
    note.textContent = message;
    feedbackSlot.append(note);
    window.setTimeout(() => note.remove(), 6000);
  };

  const replaceChildrenOf = node => { while (node.firstChild) node.firstChild.remove(); };

  const renderState = (kind, title, description, actionLabel, href) => {
    heading.textContent = kind === 'deleted' ? 'Пользователь удалён' : 'Пользователь';
    subtitle.textContent = '';
    replaceChildrenOf(root);
    const panel = document.createElement('div');
    panel.className = `admin-edit-state ${kind}`;
    panel.append(globalThis.VseIcons.create(kind === 'not-found' ? 'admin-users' : 'admin-retry', { className: 'admin-icon' }));
    panel.append(document.createElement('h2'));
    panel.lastChild.textContent = title;
    panel.append(document.createElement('p'));
    panel.lastChild.textContent = description;
    if (actionLabel) {
      const link = document.createElement('a');
      link.className = 'app-button primary';
      link.href = href || 'admin-users.html';
      link.textContent = actionLabel;
      panel.append(link);
    }
    root.append(panel);
  };

  const requestLeave = (href, trigger, extraText) => {
    if (!formApi?.form.isDirty() || formApi.form.isSubmitting()) { location.href = href; return; }
    targetAfterDiscard = href;
    returnFocus = trigger;
    unsavedText.textContent = extraText || 'Введённые данные и выбранный доступ будут потеряны.';
    unsaved.showModal();
    stay.focus();
  };
  stay.addEventListener('click', () => { unsaved.close(); returnFocus?.focus(); });
  leave.addEventListener('click', () => { unsaved.close(); location.href = targetAfterDiscard; });
  unsaved.addEventListener('cancel', event => { event.preventDefault(); unsaved.close(); returnFocus?.focus(); });
  unsaved.addEventListener('click', event => { if (event.target === unsaved) { unsaved.close(); returnFocus?.focus(); } });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !formApi?.form.isDirty() || formApi.form.isSubmitting() || link.target === '_blank') return;
    event.preventDefault();
    requestLeave(link.href, link);
  }, true);
  addEventListener('beforeunload', event => {
    if (formApi?.form.isDirty() && !formApi.form.isSubmitting()) event.preventDefault();
  });
  document.getElementById('logout')?.addEventListener('click', () => requestLeave('../login.html', document.getElementById('logout')));

  const initialsOf = name => name.split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('ru-RU') || '').join('');
  const permissionLabel = code => globalThis.VseAdmin.permissions.find(item => item.code === code)?.label || code;
  const productLabel = code => globalThis.VseAdmin.products.find(item => item.code === code)?.label || code;

  const buildSummary = (user, savedPermissions, savedProducts) => {
    const wrap = document.createElement('div');
    wrap.className = 'admin-edit-summary';
    const summary = globalThis.VseProfile.createSummary({
      name: user.name,
      login: user.login,
      initials: initialsOf(user.name) || '—',
      permissions: savedPermissions.map(permissionLabel),
      products: savedProducts.map(code => ({ label: productLabel(code) })),
    });
    summary.querySelector('.profile-avatar-picker input')?.remove();
    summary.querySelector('.profile-camera')?.remove();
    wrap.append(summary);
    if (user.status === 'blocked') {
      const note = document.createElement('p');
      note.className = 'profile-status-note';
      note.textContent = 'Учётная запись заблокирована. Вход закрыт до разблокировки.';
      wrap.append(note);
    }
    return wrap;
  };

  const buildCardActions = user => {
    const actions = document.createElement('div');
    actions.className = 'admin-edit-card-actions';
    const link = (label, iconName, href, danger = false) => {
      const node = document.createElement('a');
      node.className = `app-button secondary${danger ? ' danger' : ''}`;
      node.href = href;
      node.append(globalThis.VseIcons.create(iconName, { className: 'admin-icon' }), document.createElement('span'));
      node.lastChild.textContent = label;
      return node;
    };
    actions.append(link('История изменений', 'admin-history', `admin-user-history.html?user=${encodeURIComponent(user.id)}`));
    if (user.status === 'blocked') {
      const unlock = globalThis.VseApp.createButton({
        label: 'Разблокировать', variant: 'secondary',
        icon: globalThis.VseIcons.create('admin-unlock', { className: 'admin-icon' }),
        onClick: event => openStatusDialog(user, false, event.currentTarget),
      });
      actions.append(unlock);
    } else {
      const block = globalThis.VseApp.createButton({
        label: 'Заблокировать', variant: 'secondary',
        icon: globalThis.VseIcons.create('admin-lock', { className: 'admin-icon' }),
        onClick: event => openStatusDialog(user, true, event.currentTarget),
      });
      actions.append(block);
    }
    const remove = globalThis.VseApp.createButton({
      label: 'Удалить пользователя', variant: 'secondary',
      icon: globalThis.VseIcons.create('admin-delete', { className: 'admin-icon' }),
      onClick: event => openDeleteDialog(user, event.currentTarget),
    });
    remove.classList.add('danger');
    actions.append(remove);
    return actions;
  };

  const statusDialog = globalThis.VseAdmin.createUserStatusDialog({
    adapter: globalThis.VseAdminDemo,
    onSuccess: (updatedUser, detail) => {
      announce(detail.message);
      rerender(updatedUser, { keepNotice: true });
    },
  });
  const deleteDialog = globalThis.VseAdmin.createUserDeleteDialog({
    adapter: globalThis.VseAdminDemo,
    onDeleted: () => {
      try { sessionStorage.setItem('vse-admin-feedback', 'Пользователь удалён'); } catch { /* Переход остаётся доступным без sessionStorage. */ }
      location.href = 'admin-users.html';
    },
    onRequestBlock: (user, trigger) => statusDialog.openFor({ user, trigger }),
  });
  document.body.append(statusDialog, deleteDialog);

  const openStatusDialog = (user, _willBlock, trigger) => statusDialog.openFor({ user, trigger });
  const openDeleteDialog = (user, trigger) => deleteDialog.openFor({ user, trigger });

  const rerender = (user, { keepNotice = false } = {}) => {
    if (!keepNotice) announce('');
    replaceChildrenOf(root);
    heading.textContent = `Пользователь: ${user.name}`;
    subtitle.textContent = `${user.login} · ${globalThis.VseAdmin.statuses[user.status]} · версия записи ${user.version}`;
    const shell = document.createElement('div');
    shell.className = 'admin-edit-shell';
    shell.append(buildSummary(user, [...(user.permissions || [])], [...user.products]));

    const built = globalThis.VseAdmin.createUserEditForm({
      user: { ...user, permissions: [...(user.permissions || [])], products: [...user.products], version: user.version },
      adapter: globalThis.VseAdminDemo,
      failSave: stateFlags.failSave,
      staleVersion: stateFlags.staleVersion,
      deletedElsewhere: stateFlags.deletedElsewhere,
      onDirtyChange: dirty => { if (dirty) announce(''); },
      onCancel: () => requestLeave('admin-users.html', document.querySelector('.admin-form-actions .secondary')),
      onSaved: (saved, form, before) => {
        formApi?.form.rewriteSaved(saved);
        user.version = saved.version;
        user.permissions = saved.permissions;
        user.products = saved.products;
        user.name = saved.name;
        user.email = saved.email;
        user.position = saved.position;
        const notices = [];
        if (saved.changes.some(change => change.kind === 'permissions' || change.kind === 'products')) {
          const reduced = saved.products.length < before.products.length || saved.permissions.length < (before.permissions || []).length;
          notices.push(reduced
            ? 'Изменения сохранены. После сохранения доступ изменится; несохранённые изменения в недоступных разделах теряются.'
            : 'Изменения сохранены.');
        } else {
          notices.push('Изменения сохранены.');
        }
        if (user.status !== 'blocked') notices.push('Изменения не снимают блокировку.');
        rerender(user, { keepNotice: true });
        announce(notices.join(' '));
      },
    });
    formApi = built;
    if (user.status === 'blocked') {
      const note = document.createElement('p');
      note.className = 'admin-blocked-note';
      note.textContent = 'Изменения не снимают блокировку: вход возвращается только действием разблокировки.';
      built.form.prepend(note);
    }
    const mainColumn = document.createElement('div');
    mainColumn.className = 'admin-edit-form-column';
    mainColumn.append(built.form);
    const headingActions = document.querySelector('.admin-edit-heading .admin-edit-card-actions');
    headingActions?.replaceWith(buildCardActions(user));
    shell.append(mainColumn);
    root.append(shell);
  };

  (async () => {
    const demoEnabledUsers = ['u-1001', 'u-1002', 'u-1004'];
    if (!demoEnabledUsers.includes(userId)) {
      renderState('not-found', 'Пользователь не найден', 'В демонстрации карточка открыта для пользователей с разными статусами; эта запись недоступна.', 'К списку пользователей');
      document.querySelector('[data-back-icon]')?.replaceWith(globalThis.VseIcons.create('chevron-left', { className: 'admin-icon' }));
      return;
    }
    try {
      const user = await globalThis.VseAdminDemo.getUser(userId, { forceError: stateFlags.loadError });
      const actions = document.createElement('div');
      actions.className = 'admin-edit-card-actions';
      document.querySelector('.admin-edit-heading').append(actions);
      rerender(user);
      document.querySelector('[data-back-icon]')?.replaceWith(globalThis.VseIcons.create('chevron-left', { className: 'admin-icon' }));
      if (params.get('notice') === 'created') announce('Пользователь создан. Данные для входа выдаются администратором.');
      else if (params.get('notice') === 'saved') announce('Изменения сохранены.');
    } catch (error) {
      if (error?.code === 'not-found') renderState('not-found', 'Пользователь не найден', 'Запись не существует или указан неверный идентификатор.', 'К списку пользователей');
      else renderState('error', 'Не удалось загрузить пользователя', 'Проверьте соединение и повторите попытку.', 'Повторить', location.href);
    }
  })();
})();
