(() => {
  const api = globalThis.VseAdmin ||= {};
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const dateText = value => value ? new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(value)).replace(',', '') : 'Не указано';

  api.createUserEditForm = ({
    user,
    adapter = globalThis.VseAdminDemo,
    onSaved,
    onCancel,
    onDirtyChange,
    onUnsavedNavigation,
    failSave = false,
    staleVersion = false,
    deletedElsewhere = false,
  } = {}) => {
    const form = document.createElement('form');
    form.className = 'admin-user-form';
    form.noValidate = true;
    const generalError = make('div', 'admin-form-message error');
    generalError.setAttribute('role', 'alert');
    generalError.hidden = true;

    const basicCard = make('section', 'admin-form-card');
    const basicHead = make('div', 'admin-form-card-head');
    const basicCopy = make('div');
    basicCopy.append(
      make('h2', '', 'Основные сведения'),
      make('p', '', 'Логин неизменяем; email служит контактом для связи.'),
    );
    basicHead.append(basicCopy);
    const grid = make('div', 'admin-form-grid');
    const name = api.createTextField({ id: 'edit-name', label: 'Фамилия и имя', required: true, autocomplete: 'name', maxLength: api.formLimits.name, wide: true, value: user.name });
    const email = api.createTextField({
      id: 'edit-email', label: 'Email', required: true, type: 'email', autocomplete: 'email', maxLength: api.formLimits.email,
      value: user.email,
      hint: 'Служит контактом для связи, вход выполняется по логину и паролю.',
    });
    const position = api.createTextField({ id: 'edit-position', label: 'Должность', autocomplete: 'organization-title', maxLength: api.formLimits.position, value: user.position });
    const loginInfo = make('div', 'admin-lab-field');
    loginInfo.append(globalThis.VseApp.createInfoField({ label: 'Логин', value: user.login }));
    const labInfo = make('div', 'admin-lab-field');
    labInfo.append(globalThis.VseApp.createInfoField({ label: 'Лаборатория', value: 'Лаборатория ВСЭ №1 г. Казань' }));
    const createdInfo = make('div', 'admin-lab-field');
    createdInfo.append(globalThis.VseApp.createInfoField({ label: 'Дата создания', value: dateText(user.createdAt) }));
    grid.append(name, email, position, loginInfo, labInfo, createdInfo);
    basicCard.append(basicHead, grid);

    const accessCard = make('section', 'admin-form-card admin-access-card');
    accessCard.id = 'access';
    const accessHead = make('div', 'admin-form-card-head');
    const accessCopy = make('div');
    accessCopy.append(
      make('h2', '', 'Доступ пользователя'),
      make('p', '', 'Дополнительные действия и типы продукции, доступные в рабочей системе.'),
    );
    accessHead.append(accessCopy);
    const editor = api.createAccessEditor({
      permissions: [...(user.permissions || [])],
      products: [...user.products],
      onChange: () => markDirty(),
    });
    accessCard.append(accessHead, editor);

    const actions = make('div', 'admin-form-actions');
    const cancel = globalThis.VseApp.createButton({ label: 'Отмена', variant: 'secondary', onClick: () => onCancel?.(form) });
    const submit = globalThis.VseApp.createButton({ label: 'Сохранить изменения', busyLabel: 'Сохраняем…', variant: 'primary', type: 'submit', disabled: true });
    actions.append(cancel, submit);
    form.append(generalError, basicCard, accessCard, actions);

    const fields = { name, email, position };
    const snapshot = () => JSON.stringify({
      name: name.input.value.trim(),
      email: email.input.value.trim(),
      position: position.input.value.trim(),
      ...editor.getValue(),
    });
    const initial = snapshot();
    let dirty = false;
    let submitting = false;
    const statusNote = make('p', 'admin-form-status-note');
    statusNote.hidden = true;

    const markDirty = () => {
      const next = snapshot() !== initial;
      if (next !== dirty) { dirty = next; submit.setDisabled(!next); onDirtyChange?.(dirty, form); }
    };
    Object.values(fields).forEach(field => field.input.addEventListener('input', markDirty));

    const showGeneralError = message => {
      generalError.textContent = message || '';
      generalError.hidden = !message;
    };
    const validate = () => {
      Object.values(fields).forEach(field => field.setError(''));
      showGeneralError('');
      const errors = [];
      if (!name.input.value.trim()) errors.push([name, 'Укажите фамилию и имя.']);
      if (!email.input.value.trim()) errors.push([email, 'Укажите email.']);
      else if (email.input.validity.typeMismatch) errors.push([email, 'Введите корректный email.']);
      errors.forEach(([field, message]) => field.setError(message));
      if (errors.length) {
        showGeneralError('Проверьте обязательные поля.');
        errors[0][0].input.focus();
        return false;
      }
      return true;
    };
    const payload = () => ({
      name: name.input.value.trim(),
      email: email.input.value.trim(),
      position: position.input.value.trim(),
      ...editor.getValue(),
    });

    const setBusy = busy => {
      submitting = busy;
      Object.values(fields).forEach(field => field.setBusy(busy));
      editor.setDisabled(busy);
      submit.setBusy(busy);
      cancel.setDisabled(busy);
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !dirty || !validate()) return;
      setBusy(true);
      const before = { ...user, permissions: [...(user.permissions || [])], products: [...user.products] };
      try {
        const result = await adapter.updateUser(user.id, payload(), {
          expectedVersion: user.version,
          failSave,
          staleVersion,
          deletedElsewhere,
        });
        dirty = false;
        submit.setDisabled(true);
        onDirtyChange?.(false, form);
        onSaved?.(result, form, before);
      } catch (error) {
        if (error.fields) {
          Object.entries(error.fields).forEach(([key, message]) => fields[key]?.setError(message));
          Object.keys(error.fields).map(key => fields[key]).find(Boolean)?.input.focus();
        }
        showGeneralError(error.message || 'Не удалось сохранить изменения. Повторите попытку.');
        setBusy(false);
      }
    });

    form.isDirty = () => dirty;
    form.isSubmitting = () => submitting;
    form.getValue = payload;
    form.getSavedUser = () => user;
    form.showSaveError = message => { showGeneralError(message); setBusy(false); };
    form.rewriteSaved = saved => {
      user.version = saved.version;
      user.permissions = saved.permissions;
      user.products = saved.products;
      user.name = saved.name;
      user.email = saved.email;
      user.position = saved.position;
      user.status = saved.status;
    };
    form.focusFirst = () => name.input.focus();
    return { form, submit, cancel, editor, fields };
  };
})();
