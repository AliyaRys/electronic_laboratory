(() => {
  const ui = globalThis.VseApp ||= {};

  /** Canonical button for working screens; authentication keeps its own larger variant. */
  ui.createButton = ({ label = 'Продолжить', busyLabel = 'Выполняется…', variant = 'secondary', type = 'button', icon, iconOnly = false, disabled = false, busy = false, onClick } = {}) => {
    if (!['primary', 'secondary', 'danger'].includes(variant)) throw new TypeError('Неподдерживаемый вариант кнопки');
    const button = document.createElement('button');
    button.className = `vse-app app-button ${variant}${iconOnly ? ' icon-only' : ''}`;
    button.type = type;
    const contentIcon = typeof icon === 'string' ? ui.createIcon(icon) : icon;
    if (contentIcon) button.append(contentIcon);
    const text = document.createElement('span');
    text.textContent = label;
    if (!iconOnly) button.append(text);
    else button.setAttribute('aria-label', label);
    const spinner = document.createElement('span');
    spinner.className = 'app-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    spinner.hidden = true;
    button.append(spinner);
    let isDisabled = disabled;
    let isBusy = busy;
    const update = () => {
      button.disabled = isDisabled || isBusy;
      button.setAttribute('aria-busy', String(isBusy));
      if (!iconOnly) text.textContent = isBusy ? busyLabel : label;
      if (contentIcon) contentIcon.toggleAttribute('hidden', isBusy);
      spinner.hidden = !isBusy;
    };
    button.setBusy = value => { isBusy = Boolean(value); update(); };
    button.setDisabled = value => { isDisabled = Boolean(value); update(); };
    if (onClick) button.addEventListener('click', onClick);
    update();
    return button;
  };
})();
