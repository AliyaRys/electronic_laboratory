(() => {
  const app = globalThis.VseApp ||= {};
  const profile = globalThis.VseProfile ||= {};
  let sequence = 0;

  /** Disclosure form for a prototype password change. It never stores or logs password values. */
  profile.createPasswordChangeForm = ({ idPrefix, open = false, disabled = false, busy = false, error = '', onSubmit } = {}) => {
    const prefix = idPrefix || `profile-password-${++sequence}`;
    const section = document.createElement('section');
    section.className = 'vse-app profile-security';
    const toggle = app.createButton({ label: 'Сменить пароль', icon: 'key', disabled });
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', `${prefix}-form`);
    const form = document.createElement('form');
    form.id = `${prefix}-form`;
    form.className = 'profile-password-form';
    form.noValidate = true;
    form.setAttribute('aria-label', 'Смена пароля');
    form.hidden = !open;
    const createPasswordField = ({ id, label, autocomplete, placeholder }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'profile-password-field';
      const caption = document.createElement('label');
      caption.htmlFor = id;
      caption.textContent = label;
      const input = document.createElement('input');
      input.id = id;
      input.name = id;
      input.type = 'password';
      input.autocomplete = autocomplete;
      input.placeholder = placeholder;
      input.required = true;
      input.disabled = disabled;
      const message = document.createElement('p');
      message.id = `${id}-error`;
      message.className = 'profile-field-error';
      message.setAttribute('aria-live', 'polite');
      message.hidden = true;
      wrapper.append(caption, input, message);
      wrapper.input = input;
      wrapper.setError = text => {
        message.textContent = text;
        message.hidden = !text;
        input.toggleAttribute('aria-invalid', Boolean(text));
        if (text) input.setAttribute('aria-describedby', message.id);
        else input.removeAttribute('aria-describedby');
      };
      input.addEventListener('input', () => wrapper.setError(''));
      return wrapper;
    };
    const current = createPasswordField({ id: `${prefix}-current`, label: 'Старый пароль', autocomplete: 'current-password', placeholder: 'Введите старый пароль' });
    const next = createPasswordField({ id: `${prefix}-new`, label: 'Новый пароль', autocomplete: 'new-password', placeholder: 'Введите новый пароль' });
    const feedback = document.createElement('p');
    feedback.className = 'profile-form-error';
    feedback.setAttribute('role', 'alert');
    feedback.hidden = true;
    const submit = app.createButton({ label: 'Сохранить новый пароль', busyLabel: 'Сохраняем…', variant: 'primary', type: 'submit', icon: 'check', iconOnly: true, disabled, busy });
    form.append(current, next, submit, feedback);
    section.append(toggle, form);
    let isBusy = busy;
    const setOpen = (value, focus = false) => {
      const expanded = Boolean(value);
      form.hidden = !expanded;
      toggle.setAttribute('aria-expanded', String(expanded));
      if (expanded && focus) current.input.focus();
    };
    section.setOpen = setOpen;
    section.setError = text => { feedback.textContent = text; feedback.hidden = !text; };
    section.setBusy = value => {
      isBusy = Boolean(value);
      form.setAttribute('aria-busy', String(isBusy));
      current.input.disabled = disabled || isBusy;
      next.input.disabled = disabled || isBusy;
      toggle.setDisabled(disabled || isBusy);
      submit.setDisabled(disabled);
      submit.setBusy(isBusy);
    };
    section.fields = { current, next };
    section.toggleButton = toggle;
    section.submitButton = submit;
    section.form = form;
    section.setError(error);
    section.setBusy(busy);
    toggle.addEventListener('click', () => setOpen(form.hidden, form.hidden));
    form.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        toggle.focus();
      }
    });
    form.addEventListener('input', () => section.setError(''));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (isBusy || disabled) return;
      const missingCurrent = !current.input.value;
      const missingNext = !next.input.value;
      current.setError(missingCurrent ? 'Введите старый пароль.' : '');
      next.setError(missingNext ? 'Введите новый пароль.' : '');
      if (missingCurrent || missingNext) {
        (missingCurrent ? current : next).input.focus();
        return;
      }
      section.setError('');
      section.setBusy(true);
      let succeeded = false;
      try {
        const result = await onSubmit?.({ currentPassword: current.input.value, newPassword: next.input.value });
        if (result?.error) section.setError(result.error);
        else {
          current.input.value = '';
          next.input.value = '';
          succeeded = true;
        }
      } catch {
        section.setError('Не удалось сменить пароль. Попробуйте ещё раз.');
      } finally {
        section.setBusy(false);
      }
      if (succeeded) {
        setOpen(false);
        toggle.focus();
      }
    });
    return section;
  };
})();
