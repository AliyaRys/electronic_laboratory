(() => {
  const params = new URLSearchParams(location.search);
  const state = params.get('state') || '';
  const defaultId = state === 'blocked-linked' ? 'u-1004' : state === 'linked' ? 'u-1005' : 'u-1001';
  let user = VseAdminDemo.getUsers().find(item => item.id === (params.get('id') || defaultId)) || VseAdminDemo.getUsers()[0];
  if (state === 'blocked-linked') user = { ...user, status: 'blocked' };
  const card = document.querySelector('.admin-status-card');
  const feedback = document.getElementById('delete-feedback');
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-login').textContent = user.login;
  document.getElementById('user-email').textContent = user.email;
  const status = document.getElementById('user-status');
  status.textContent = VseAdmin.statuses[user.status];
  status.className = `admin-status ${user.status}`;

  const statusDialog = VseAdmin.createUserStatusDialog({
    adapter: VseAdminDemo,
    onSuccess: updated => {
      user = updated;
      status.textContent = VseAdmin.statuses[user.status];
      status.className = `admin-status ${user.status}`;
      feedback.textContent = 'Пользователь заблокирован';
      feedback.hidden = false;
    },
  });
  const deleteDialog = VseAdmin.createUserDeleteDialog({
    adapter: VseAdminDemo,
    onDeleted: () => {
      feedback.textContent = 'Пользователь удалён';
      feedback.hidden = false;
      card.hidden = true;
      document.querySelector('.admin-status-back').focus();
    },
    onRequestBlock: (target, trigger) => statusDialog.openFor({ user: target, trigger }),
  });
  document.body.append(statusDialog, deleteDialog);
  const action = VseApp.createButton({
    label: 'Удалить пользователя', variant: 'secondary',
    icon: VseIcons.create('admin-delete', { className: 'admin-icon' }),
    onClick: event => deleteDialog.openFor({
      user, trigger: event.currentTarget,
      check: { fail: state === 'check-error' },
      deletion: { fail: state === 'delete-error', documentAppeared: state === 'race' },
    }),
  });
  action.classList.add('danger');
  const slot = document.getElementById('delete-action');
  slot.replaceWith(action);
  action.id = 'delete-action';
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
  if (params.get('open') !== '0') requestAnimationFrame(() => action.click());
})();
