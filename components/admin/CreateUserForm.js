(() => {
  const api = globalThis.VseAdmin ||= {};
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  api.createUserForm = ({
    laboratory = 'Лаборатория ВСЭ №1 г. Казань',
    values = {},
    access = {},
    adapter = globalThis.VseAdminDemo,
    onCreated,
    onCancel,
    onDirtyChange,
    failCreate = false,
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
    basicCopy.append(make('h2', '', 'Основные сведения'), make('p', '', 'Данные для учётной записи и входа пользователя.'));
    basicHead.append(basicCopy);
    const grid = make('div', 'admin-form-grid');
    const name = api.createTextField({ id: 'user-name', label: 'Фамилия и имя', required: true, autocomplete: 'name', maxLength: api.formLimits.name, wide: true });
    const login = api.createTextField({ id: 'user-login', label: 'Логин', required: true, autocomplete: 'username', maxLength: api.formLimits.login, hint: 'Можно использовать логин, который не является email.' });
    const password = api.createTextField({
      id: 'user-password', label: 'Пароль пользователя', required: true, type: 'password',
      autocomplete: 'new-password', hint: globalThis.VseAuth?.demoPasswordPolicy?.description || '',
    });
    const passwordRepeat = api.createTextField({
      id: 'user-password-repeat', label: 'Повторите пароль', required: true, type: 'password',
      autocomplete: 'new-password',
    });
    const email = api.createTextField({ id: 'user-email', label: 'Email', required: true, type: 'email', autocomplete: 'email', maxLength: api.formLimits.email, hint: 'Служит контактом для связи, вход выполняется по логину и паролю.' });
    const position = api.createTextField({ id: 'user-position', label: 'Должность', autocomplete: 'organization-title', maxLength: api.formLimits.position });
    const labWrap = make('div', 'admin-lab-field');
    labWrap.append(globalThis.VseApp.createInfoField({ label: 'Лаборатория', value: laboratory }));
    grid.append(name, login, password, passwordRepeat, email, position, labWrap);
    basicCard.append(basicHead, grid);

    const accessCard = make('section', 'admin-form-card admin-access-card');
    const accessHead = make('div', 'admin-form-card-head');
    const accessCopy = make('div');
    accessCopy.append(make('h2', '', 'Доступ пользователя'), make('p', '', 'Дополнительные действия и типы продукции, доступные в рабочей системе.'));
    accessHead.append(accessCopy);
    const editor = api.createAccessEditor({ permissions: access.permissions || [], products: access.products || [], onChange: () => markDirty() });
    accessCard.append(accessHead, editor);

    const actions = make('div', 'admin-form-actions');
    const cancel = globalThis.VseApp.createButton({ label: 'Отмена', variant: 'secondary', onClick: () => onCancel?.(form) });
    const submit = globalThis.VseApp.createButton({ label: 'Создать пользователя', busyLabel: 'Создаём…', variant: 'primary', type: 'submit', icon: globalThis.VseIcons.create('admin-user-add', { className: 'app-icon' }) });
    actions.append(cancel, submit);
    form.append(generalError, basicCard, accessCard, actions);

    const fields = { name, login, password, passwordRepeat, email, position };
    name.input.value = values.name || '';
    login.input.value = values.login || '';
    email.input.value = values.email || '';
    position.input.value = values.position || '';
    let operationId = null;
    let dirty = false;
    let submitting = false;

    const payload = () => ({
      name: name.input.value,
      login: login.input.value,
      password: password.input.value,
      email: email.input.value,
      position: position.input.value,
      ...editor.getValue(),
    });
    const initial = JSON.stringify(payload());
    const markDirty = () => {
      const next = JSON.stringify(payload()) !== initial;
      if (next !== dirty) { dirty = next; onDirtyChange?.(dirty, form); }
    };
    Object.values(fields).forEach(field => field.input.addEventListener('input', markDirty));

    const showGeneralError = message => {
      generalError.textContent = message || '';
      generalError.hidden = !message;
    };
    const validate = () => {
      Object.values(fields).forEach(field => field.setError(''));
      showGeneralError('');
      name.input.value = name.input.value.trim();
      login.input.value = login.input.value.trim();
      email.input.value = email.input.value.trim();
      const policy = globalThis.VseAuth?.demoPasswordPolicy;
      const policyError = policy?.describe(password.input.value) || '';
      const errors = [];
      if (!name.input.value) errors.push([name, 'Укажите фамилию и имя.']);
      if (!login.input.value) errors.push([login, 'Укажите логин.']);
      if (policyError) errors.push([password, policyError]);
      if (!passwordRepeat.input.value) errors.push([passwordRepeat, 'Повторите пароль пользователя.']);
      else if (!policyError && passwordRepeat.input.value !== password.input.value) errors.push([passwordRepeat, 'Пароли не совпадают.']);
      if (!email.input.value) errors.push([email, 'Укажите email.']);
      else if (email.input.validity.typeMismatch) errors.push([email, 'Введите корректный email.']);
      errors.forEach(([field, message]) => field.setError(message));
      if (errors.length) {
        showGeneralError('Проверьте обязательные поля.');
        errors[0][0].input.focus();
        return false;
      }
      return true;
    };
    const setBusy = busy => {
      submitting = busy;
      Object.values(fields).forEach(field => field.setBusy(busy));
      editor.setDisabled(busy);
      submit.setBusy(busy);
      cancel.setDisabled(busy);
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submitting || !validate()) return;
      setBusy(true);
      operationId ||= globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      try {
        const result = await adapter.createUser(payload(), { operationId, failCreate });
        dirty = false;
        onDirtyChange?.(false, form);
        onCreated?.(result, form);
      } catch (error) {
        if (error.fields) {
          Object.entries(error.fields).forEach(([key, message]) => fields[key]?.setError(message));
          Object.keys(error.fields).map(key => fields[key]).find(Boolean)?.input.focus();
        }
        showGeneralError(error.message || 'Не удалось создать пользователя. Повторите попытку.');
        setBusy(false);
      }
    });

    form.isDirty = () => dirty;
    form.isSubmitting = () => submitting;
    form.getValue = payload;
    form.focusFirst = () => name.input.focus();
    form.showCreateError = message => { showGeneralError(message); setBusy(false); };
    return form;
  };
})();
