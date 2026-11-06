(() => {
  const api = globalThis.VseAdmin ||= {};

  api.createTextField = ({
    id,
    label,
    value = '',
    type = 'text',
    required = false,
    autocomplete = 'off',
    hint = '',
    disabled = false,
    maxLength,
    wide = false,
  }) => {
    const field = document.createElement('div');
    field.className = `admin-text-field${wide ? ' wide' : ''}`;
    const caption = document.createElement('label');
    caption.htmlFor = id;
    caption.textContent = label;
    if (required) {
      const marker = document.createElement('span');
      marker.className = 'admin-required';
      marker.textContent = ' *';
      marker.setAttribute('aria-hidden', 'true');
      caption.append(marker);
    }
    const input = document.createElement('input');
    Object.assign(input, { id, name: id, type, value, required, autocomplete, disabled });
    if (maxLength) input.maxLength = maxLength;
    const hintNode = document.createElement('div');
    hintNode.className = 'admin-field-hint';
    hintNode.id = `${id}-hint`;
    hintNode.textContent = hint;
    hintNode.hidden = !hint;
    const error = document.createElement('div');
    error.className = 'admin-field-error';
    error.id = `${id}-error`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    input.setAttribute('aria-describedby', [hint ? hintNode.id : '', error.id].filter(Boolean).join(' '));
    field.append(caption, input, hintNode, error);
    field.input = input;
    field.setError = message => {
      error.textContent = message || '';
      error.hidden = !message;
      input.setAttribute('aria-invalid', String(Boolean(message)));
    };
    field.setBusy = busy => { input.disabled = disabled || Boolean(busy); };
    input.addEventListener('input', () => field.setError(''));
    return field;
  };
})();
