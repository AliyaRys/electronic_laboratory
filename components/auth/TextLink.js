(() => {
  const ui = globalThis.VseAuth ||= {};

  /** Навигационная ссылка варианта login. По умолчанию ведёт на существующий макет восстановления. */
  ui.createTextLink = ({ label = 'Забыли пароль?', href = 'password-recovery.html', variant = 'default', onClick } = {}) => {
    if (!['default', 'back'].includes(variant)) throw new TypeError('Неподдерживаемый вариант ссылки');
    const link = document.createElement('a');
    link.className = `vse-auth auth-link${variant === 'back' ? ' auth-back-link' : ''}`;
    link.href = href;
    if (variant === 'back') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'm14 6-6 6 6 6');
      icon.append(path);
      link.append(icon);
    }
    const text = document.createElement('span');
    text.textContent = label;
    link.append(text);
    if (onClick) link.addEventListener('click', onClick);
    return link;
  };
})();
