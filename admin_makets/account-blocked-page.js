/* Макет состояния «Учётная запись заблокирована» (ТЗ 10). Демонстрационный адаптер входа,
   не словарь реальных заблокированных логинов: пароль любой непустой, пароль «demo» имитирует верные данные. */
(() => {
  const params = new URLSearchParams(location.search);
  const state = params.get('state');
  const blockedMessage = 'Учётная запись заблокирована. Обратитесь к администратору лаборатории.';
  const genericMessage = 'Неверный логин или пароль.';
  const blockedLogin = 'gavrilova.olga';

  const demoCheck = async ({ login, password }) => {
    await new Promise(resolve => setTimeout(resolve, 700));
    if (password !== 'demo') return { error: genericMessage };
    if (login.toLocaleLowerCase('ru-RU') === blockedLogin) return { error: blockedMessage };
    return {};
  };

  const screen = VseAuth.createLoginScreen({
    logoSrc: '../vse-lab-icon-transparent.png',
    idPrefix: 'login',
    onSubmit: async credentials => {
      const result = await demoCheck(credentials);
      if (result.error) {
        if (result.error === blockedMessage) form.fields.password.input.value = '';
        return result;
      }
      window.location.href = '../journal.html';
      return new Promise(() => {});
    },
  });
  document.body.prepend(screen);
  const form = screen.form;
  form.fields.password.input.value = '';

  if (state === 'blocked') {
    form.setStatus('');
    form.setError(blockedMessage);
    form.fields.password.input.focus();
  } else if (state === 'session-ended') {
    form.setError(blockedMessage);
  } else if (state === 'network') {
    form.setError('Не удалось войти. Попробуйте ещё раз.');
  }
})();
