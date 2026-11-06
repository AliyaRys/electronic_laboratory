(() => {
  const ui = globalThis.VseAuth ||= {};
  let sequence = 0;

  /** Форма восстановления из общих поля email и кнопки. Отправку задаёт владелец экрана. */
  ui.createRecoveryForm = ({ idPrefix, email = '', disabled = false, busy = false, error = '', onSubmit } = {}) => {
    const prefix = idPrefix || `recovery-${++sequence}`;
    const form = document.createElement('form');
    form.className = 'vse-auth auth-recovery-form';
    form.noValidate = true;
    form.setAttribute('aria-label', 'Форма восстановления пароля');
    const field = ui.createTextField({
      id: `${prefix}-email`,
      name: 'email',
      label: 'Электронная почта',
      type: 'email',
      value: email,
      required: true,
      disabled,
    });
    const submit = ui.createButton({
      label: 'Восстановить пароль',
      busyLabel: 'Отправляем…',
      type: 'submit',
      icon: false,
      disabled,
      busy,
    });
    form.append(field, submit);
    let isBusy = busy;
    form.field = field;
    form.submitButton = submit;
    form.setError = text => field.setError(text);
    form.setBusy = value => {
      isBusy = Boolean(value);
      form.setAttribute('aria-busy', String(isBusy));
      field.input.disabled = disabled || isBusy;
      submit.setDisabled(disabled);
      submit.setBusy(isBusy);
    };
    form.setError(error);
    form.setBusy(busy);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (isBusy || disabled) return;
      field.input.value = field.input.value.trim();
      if (!field.input.validity.valid) {
        field.setError(field.input.validity.valueMissing ? 'Укажите электронную почту.' : 'Проверьте адрес электронной почты.');
        field.input.focus();
        return;
      }
      field.setError('');
      form.setBusy(true);
      try {
        const result = await onSubmit?.({ email: field.input.value });
        if (result?.error) field.setError(result.error);
      } catch {
        field.setError('Не удалось отправить письмо. Попробуйте ещё раз.');
      } finally {
        form.setBusy(false);
      }
    });
    return form;
  };
})();
