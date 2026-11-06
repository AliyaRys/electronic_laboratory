(() => {
  const ui = globalThis.VseAuth ||= {};

  /** Общий фон экранов входа и восстановления пароля. */
  ui.createAuthPage = ({ className = '' } = {}) => {
    const main = document.createElement('main');
    main.className = `vse-auth vse-auth-page${className ? ` ${className}` : ''}`;
    for (const placement of ['one', 'two', 'three']) {
      const orb = document.createElement('span');
      orb.className = `auth-orb ${placement}`;
      orb.setAttribute('aria-hidden', 'true');
      main.append(orb);
    }
    return main;
  };
})();
