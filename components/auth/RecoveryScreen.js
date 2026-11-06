(() => {
  const ui = globalThis.VseAuth ||= {};
  let sequence = 0;

  /** Экран восстановления: форма ввода email или нейтральное подтверждение отправки. */
  ui.createRecoveryScreen = ({ mode = 'form', idPrefix, email = '', busy = false, error = '', onSubmit, onBack } = {}) => {
    if (!['form', 'sent'].includes(mode)) throw new TypeError('Неподдерживаемое состояние восстановления');
    const prefix = idPrefix || `recovery-screen-${++sequence}`;
    const main = ui.createAuthPage({ className: 'auth-recovery-page' });
    const card = document.createElement('section');
    card.className = 'auth-recovery-card';
    card.setAttribute('aria-labelledby', `${prefix}-title`);
    const title = document.createElement('h1');
    title.id = `${prefix}-title`;
    title.textContent = 'Восстановление пароля';
    card.append(title);
    if (mode === 'form') {
      const description = document.createElement('p');
      description.className = 'auth-recovery-description';
      description.textContent = 'Отправим ссылку для восстановления на почту, указанную при регистрации.';
      const form = ui.createRecoveryForm({ idPrefix: prefix, email, busy, error, onSubmit });
      card.append(description, form);
      main.form = form;
    } else {
      const notice = document.createElement('div');
      notice.className = 'auth-recovery-success';
      notice.setAttribute('role', 'status');
      const message = document.createElement('p');
      message.append('Если учётная запись ');
      if (email) {
        const address = document.createElement('strong');
        address.textContent = `с адресом «${email}»`;
        message.append(address, ' ');
      }
      message.append('существует, на указанный адрес будет отправлено письмо с инструкцией по восстановлению пароля.');
      notice.append(message);
      card.append(notice);
    }
    const back = ui.createTextLink({ label: 'Вернуться ко входу', href: 'login.html', variant: 'back', onClick: onBack });
    card.append(back);
    main.append(card);
    main.backLink = back;
    return main;
  };
})();
