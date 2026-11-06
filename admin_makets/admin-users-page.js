(() => {
  const root = document.getElementById('admin-users-root');
  const params = new URLSearchParams(location.search);
  const requestedState = params.get('state');
  const users = requestedState === 'empty' ? [] : VseAdminDemo.getUsers();
  const list = VseAdmin.createUsersList({
    users,
    initialState: ['loading', 'error'].includes(requestedState) ? requestedState : 'ready',
    enabledUsers: ['u-1001', 'u-1002', 'u-1004'],
    links: {
      card: 'admin-user-edit.html',
      edit: 'admin-user-edit.html',
      history: 'admin-user-history.html',
    },
    onRetry: component => component.setViewState('ready'),
  });
  root.append(list);
  try {
    const flash = sessionStorage.getItem('vse-admin-feedback');
    if (flash) {
      sessionStorage.removeItem('vse-admin-feedback');
      list.announce(flash);
    }
  } catch { /* Без sessionStorage сообщение остаётся на исходной странице. */ }

  const iconSlot = document.querySelector('[data-admin-create-icon]');
  iconSlot.replaceWith(VseIcons.create('admin-user-add', { className: 'admin-icon' }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });

  try {
    const saved = JSON.parse(sessionStorage.getItem('vse-admin-users-list-state-v1') || '{}');
    if (Number.isFinite(saved.scrollY)) requestAnimationFrame(() => scrollTo({ top: saved.scrollY }));
  } catch { /* В режиме без sessionStorage список остаётся рабочим в текущей вкладке. */ }
})();
