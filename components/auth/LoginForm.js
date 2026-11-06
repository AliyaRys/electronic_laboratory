(() => {
  const ui = globalThis.VseAuth ||= {};
  let sequence = 0;

  /** Форма из общих поля, кнопки и ссылки. onSubmit задаётся владельцем экрана; реальной авторизации внутри нет. */
  ui.createLoginForm = ({ idPrefix, disabled = false, busy = false, error = '', onSubmit, onRecover } = {}) => {
    const prefix = idPrefix || `login-${++sequence}`;
    const form = document.createElement('form');
    form.className = 'vse-auth auth-card';
    form.noValidate = true;
    form.setAttribute('aria-labelledby', `${prefix}-title`);
    const header = document.createElement('div');
    const title = document.createElement('h2');
    title.id = `${prefix}-title`;
    title.textContent = 'Вход в систему';
    const hint = document.createElement('p');
    hint.className = 'auth-hint';
    hint.textContent = 'Введите логин и пароль пользователя';
    header.append(title, hint);
    const fields = document.createElement('div');
    fields.className = 'auth-form-fields';
    const recovery = ui.createTextLink({ onClick: onRecover });
    const login = ui.createTextField({ id: `${prefix}-login`, name: 'login', label: 'Логин', placeholder: 'Например, Kuznetsova.Anna@tatar.ru', required: true });
    const password = ui.createTextField({ id: `${prefix}-password`, name: 'password', label: 'Пароль', type: 'password', placeholder: 'Введите пароль', required: true, labelAction: recovery });
    const feedback = document.createElement('p');
    feedback.className = 'auth-form-message auth-form-error';
    feedback.setAttribute('role', 'alert');
    const status = document.createElement('p');
    status.className = 'auth-form-message';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const submit = ui.createButton({ type: 'submit' });
    fields.append(login, password, feedback, status, submit);
    form.append(header, fields);
    let isBusy = busy;
    form.setError = text => { feedback.textContent = text; feedback.hidden = !text; };
    form.setStatus = text => { status.textContent = text; status.hidden = !text; };
    form.setBusy = value => {
      isBusy = Boolean(value);
      form.setAttribute('aria-busy', String(isBusy));
      login.input.disabled = disabled || isBusy;
      password.input.disabled = disabled || isBusy;
      submit.setDisabled(disabled);
      submit.setBusy(isBusy);
    };
    form.fields = { login, password };
    form.submitButton = submit;
    form.setError(error);
    form.setBusy(busy);
    form.addEventListener('input', () => { form.setError(''); form.setStatus(''); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (isBusy || disabled) return;
      const missingLogin = !login.input.value.trim();
      const missingPassword = !password.input.value;
      login.setError(missingLogin ? 'Введите логин' : '');
      password.setError(missingPassword ? 'Введите пароль' : '');
      if (missingLogin || missingPassword) {
        (missingLogin ? login : password).input.focus();
        return;
      }
      form.setError('');
      form.setStatus('');
      form.setBusy(true);
      try {
        const result = await onSubmit?.({ login: login.input.value.trim(), password: password.input.value });
        if (result?.error) form.setError(result.error);
        if (result?.message) form.setStatus(result.message);
      } catch {
        form.setError('Не удалось войти. Попробуйте ещё раз.');
      } finally {
        form.setBusy(false);
      }
    });
    return form;
  };
})();
