(() => {
  const params = new URLSearchParams(location.search);
  const requestedId = params.get('id') || 'u-1001';
  let user = VseAdminDemo.getUsers().find(item => item.id === requestedId) || VseAdminDemo.getUsers()[0];
  const name = document.getElementById('user-name');
  const login = document.getElementById('user-login');
  const email = document.getElementById('user-email');
  const status = document.getElementById('user-status');
  let actionSlot = document.getElementById('status-action');
  const feedback = document.getElementById('status-feedback');
  const card = document.querySelector('.admin-status-card');

  const dialog = VseAdmin.createUserStatusDialog({
    adapter: VseAdminDemo,
    onSuccess: (updatedUser, detail) => {
      user = updatedUser;
      feedback.textContent = detail.message;
      feedback.hidden = false;
      render();
    },
  });
  document.body.append(dialog);

  function render() {
    name.textContent = user.name;
    login.textContent = user.login;
    email.textContent = user.email;
    status.textContent = VseAdmin.statuses[user.status];
    status.className = `admin-status ${user.status}`;
    const blocking = user.status !== 'blocked';
    const action = VseApp.createButton({
      label: blocking ? 'Заблокировать' : 'Разблокировать',
      variant: blocking ? 'danger' : 'primary',
      icon: VseIcons.create(blocking ? 'admin-lock' : 'admin-unlock', { className: 'admin-icon' }),
      onClick: event => dialog.openFor({ user, trigger: event.currentTarget }),
    });
    actionSlot.replaceWith(action);
    action.id = 'status-action';
    actionSlot = action;
  }

  render();
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
  if (params.get('open') !== '0') requestAnimationFrame(() => document.getElementById('status-action')?.click());
})();
