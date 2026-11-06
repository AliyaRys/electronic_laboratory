(() => {
  const params = new URLSearchParams(location.search);
  const requestedState = params.get('state') || '';
  const userId = params.get('user') || params.get('id') || 'u-1001';
  const root = document.getElementById('admin-history-root');
  const cardLink = document.getElementById('back-to-user');
  const icon = (slot, name) => slot?.replaceWith(VseIcons.create(name, { className: 'admin-icon' }));
  icon(document.querySelector('[data-back-list-icon]'), 'chevron-left');
  icon(document.querySelector('[data-back-card-icon]'), 'chevron-left');
  document.querySelector('[data-history-icon]')?.append(VseIcons.create('admin-history', { className: 'admin-icon' }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });

  const gate = (kind, title, description, retry = false) => {
    const panel = document.createElement('section');
    panel.className = `admin-history-gate ${kind}`;
    panel.append(VseIcons.create(kind === 'error' ? 'admin-retry' : 'admin-history', { className: 'admin-icon' }));
    const heading = document.createElement('h2');
    heading.textContent = title;
    const text = document.createElement('p');
    text.textContent = description;
    panel.append(heading, text);
    if (retry) {
      const button = VseApp.createButton({ label: 'Повторить', variant: 'secondary', onClick: load });
      panel.append(button);
    }
    root.replaceChildren(panel);
  };

  const load = async () => {
    cardLink.hidden = true;
    gate('loading', 'Загружаем историю', 'Проверяем доступ и получаем сохранённые изменения.');
    try {
      const result = await VseAdminDemo.getUserHistory(requestedState === 'forbidden' ? 'admin-root' : userId, { fail: requestedState === 'error' });
      const user = requestedState === 'long' ? {
        ...result.user,
        name: 'Алексеева-Миронова Марина Викторовна-Станиславовна',
        login: 'alekseeva-mironova.marina-viktorovna',
      } : { ...result.user };
      let events = requestedState === 'empty' ? [] : result.events;
      if (requestedState === 'deleted') {
        user.deleted = true;
        events = [{ id: 'fixture-deleted', type: 'deleted', at: '2026-10-21T08:15:00+03:00', actor: 'Елена Морозова', previousStatus: 'active', userId: user.id, userName: user.name }, ...events];
      }
      if (!user.deleted) {
        cardLink.href = `admin-user-edit.html?user=${encodeURIComponent(user.id)}`;
        cardLink.hidden = false;
      }
      root.replaceChildren(VseAdmin.createUserHistory({ user, events }));
    } catch (error) {
      const forbidden = error.code === 'forbidden';
      gate(forbidden ? 'forbidden' : 'error', forbidden ? 'История недоступна' : 'Не удалось загрузить историю', forbidden ? 'У вас нет доступа к истории этой учётной записи.' : 'Проверьте соединение и повторите попытку.', !forbidden);
    }
  };

  load();
})();
