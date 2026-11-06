(() => {
  const ui = globalThis.VseAuth ||= {};

  /** Основная кнопка варианта login. Busy блокирует повторное действие и сохраняет ширину. */
  ui.createButton = ({ label = 'Войти', busyLabel = 'Входим…', type = 'button', icon = true, disabled = false, busy = false, onClick } = {}) => {
    const button = document.createElement('button');
    button.className = 'vse-auth auth-button';
    button.type = type;
    const text = document.createElement('span');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('aria-hidden', 'true');
    for (const d of ['M5 12h14', 'm13 6 6 6-6 6']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      arrow.append(path);
    }
    const spinner = document.createElement('span');
    spinner.className = 'auth-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    button.append(text, arrow, spinner);
    let isDisabled = disabled;
    let isBusy = busy;
    const update = () => {
      button.disabled = isDisabled || isBusy;
      button.setAttribute('aria-busy', String(isBusy));
      text.textContent = isBusy ? busyLabel : label;
      arrow.toggleAttribute('hidden', !icon || isBusy);
      spinner.hidden = !isBusy;
    };
    button.setBusy = value => { isBusy = Boolean(value); update(); };
    button.setDisabled = value => { isDisabled = Boolean(value); update(); };
    if (onClick) button.addEventListener('click', onClick);
    update();
    return button;
  };
})();
