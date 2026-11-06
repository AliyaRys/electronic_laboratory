(() => {
  const ui = globalThis.VseAuth ||= {};
  let sequence = 0;

  /** Поле варианта login. Пароль использует type=password; значения не сохраняются в хранилище. */
  ui.createTextField = ({ id, label = 'Логин', type = 'text', name, value = '', placeholder = '', autocomplete, required = false, disabled = false, error = '', hint = '', labelAction } = {}) => {
    if (!['text', 'password', 'email'].includes(type)) throw new TypeError('Неподдерживаемый тип поля');
    const field = document.createElement('div');
    field.className = 'vse-auth auth-field';
    const heading = document.createElement('div');
    heading.className = 'auth-field-heading';
    const caption = document.createElement('label');
    const input = document.createElement('input');
    input.id = id || `auth-field-${++sequence}`;
    input.name = name || input.id;
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.required = required;
    input.disabled = disabled;
    input.autocomplete = autocomplete || ({ password: 'current-password', email: 'email' }[type] || 'username');
    if (type === 'email') {
      input.inputMode = 'email';
      input.autocapitalize = 'none';
      input.spellcheck = false;
    }
    caption.htmlFor = input.id;
    caption.textContent = label;
    heading.append(caption);
    if (labelAction) heading.append(labelAction);
    const help = document.createElement('p');
    help.id = `${input.id}-hint`;
    help.className = 'auth-field-message';
    help.textContent = hint;
    help.hidden = !hint;
    const message = document.createElement('p');
    message.id = `${input.id}-error`;
    message.className = 'auth-field-message auth-field-error';
    message.setAttribute('aria-live', 'polite');
    field.append(heading, input, help, message);
    field.input = input;
    field.setError = text => {
      message.textContent = text;
      message.hidden = !text;
      if (text) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      const describedBy = [hint && help.id, text && message.id].filter(Boolean).join(' ');
      if (describedBy) input.setAttribute('aria-describedby', describedBy);
      else input.removeAttribute('aria-describedby');
    };
    field.setError(error);
    input.addEventListener('input', () => field.setError(''));
    return field;
  };

  /** Демонстрационная политика пароля. Утверждённые требования определяет бэкенд. */
  ui.demoPasswordPolicy = Object.freeze({
    minLength: 10,
    needsLetter: /[а-яёa-z]/i,
    needsDigit: /\d/,
    description: 'Демонстрационное требование: не менее 10 символов, есть буквы и цифры.',
    describe: value => {
      if (!value) return 'Укажите пароль.';
      if (value.length < ui.demoPasswordPolicy.minLength) return 'Пароль короче 10 символов.';
      if (!ui.demoPasswordPolicy.needsLetter.test(value)) return 'Добавьте в пароль буквы.';
      if (!ui.demoPasswordPolicy.needsDigit.test(value)) return 'Добавьте в пароль цифры.';
      return '';
    },
  });
})();
