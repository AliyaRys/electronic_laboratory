(() => {
  const params = new URLSearchParams(location.search);
  const unsaved = document.getElementById('unsaved-dialog');
  const stay = document.getElementById('stay-editing');
  const leave = document.getElementById('leave-without-save');
  let targetAfterDiscard = 'admin-users.html';
  let returnFocus = null;

  const form = VseAdmin.createUserForm({
    laboratory: 'Лаборатория ВСЭ №1 г. Казань',
    failCreate: params.get('state') === 'error',
    onCancel: () => requestLeave('admin-users.html', document.querySelector('.admin-form-actions .secondary')),
    onCreated: result => {
      location.href = `admin-user-edit.html?user=${encodeURIComponent(result.user.id)}&notice=created`;
    },
  });
  document.getElementById('admin-create-root').append(form);
  document.querySelector('[data-back-icon]').replaceWith(VseIcons.create('chevron-left', { className: 'admin-icon' }));

  function requestLeave(href, trigger) {
    if (!form.isDirty() || form.isSubmitting()) { location.href = href; return; }
    targetAfterDiscard = href;
    returnFocus = trigger;
    unsaved.showModal();
    stay.focus();
  }
  stay.addEventListener('click', () => { unsaved.close(); returnFocus?.focus(); });
  leave.addEventListener('click', () => { unsaved.close(); location.href = targetAfterDiscard; });
  unsaved.addEventListener('cancel', event => { event.preventDefault(); unsaved.close(); returnFocus?.focus(); });
  unsaved.addEventListener('click', event => { if (event.target === unsaved) { unsaved.close(); returnFocus?.focus(); } });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || !form.isDirty() || link.target === '_blank') return;
    event.preventDefault();
    requestLeave(link.href, link);
  }, true);
  addEventListener('beforeunload', event => {
    if (form.isDirty() && !form.isSubmitting()) event.preventDefault();
  });
  document.getElementById('logout')?.addEventListener('click', () => requestLeave('../login.html', document.getElementById('logout')));
  form.focusFirst();
})();
