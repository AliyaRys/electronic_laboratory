(() => {
  const params = new URLSearchParams(location.search);
  const stateParam = params.get('state');
  const STATES = {
    idle: { label: 'Продукция не назначена', note: 'Пользователь может войти, открыть профиль и выйти, но не увидит рабочие записи.' },
    checking: { label: 'Проверка идёт', note: 'Кнопка блокирует повторы на время проверки.' },
    unchanged: { label: 'Проверка без изменений', note: 'Отсутствие изменений не выдаётся за успех.' },
    network: { label: 'Ошибка проверки', note: 'Старое безопасное состояние остаётся, повтор доступен.' },
    assigned: { label: 'Тип назначен', note: 'Проверка перечитывает сессию: при назначении обновляются модель и шапка.' },
    unimplemented: { label: 'Неготовое направление', note: 'Полное название типа показано без создания пустого псевдожурнала.' },
    revoked: { label: 'Последний тип отозван', note: 'Сначала отброшены несохранённые изменения по экрану 09, затем показано это состояние.' },
  };
  const state = STATES[stateParam] ? stateParam : 'idle';
  const permissions = stateParam === 'unimplemented' || stateParam === 'revoked'
    ? ['vse_write', 'vse_delete']
    : [];

  const header = VseAppHeader.create({
    mode: 'no-products',
    logoSrc: '../vse-lab-icon-transparent.png',
    userName: 'Анна Кузнецова',
    userInitials: 'АК',
    links: { brand: 'no-products.html', profile: '../profile.html' },
    onLogout: () => { location.href = '../login.html'; },
  });
  document.body.prepend(header);

  const nav = document.createElement('nav');
  nav.className = 'no-products-demo-nav';
  nav.setAttribute('aria-label', 'Демонстрационные состояния');
  Object.entries(STATES).forEach(([code, config]) => {
    const link = document.createElement('a');
    link.href = `no-products.html?state=${code}`;
    link.textContent = config.label;
    link.classList.toggle('active', code === state);
    nav.append(link);
  });
  document.body.append(nav);

  const note = document.createElement('p');
  note.className = 'no-products-demo-note';
  note.textContent = STATES[state].note;
  document.body.append(note);

  const screen = VseAppHeader.createNoProducts({
    state,
    permissions,
    unimplementedLabel: 'Мёд, перга и молочко маточное пчелиное',
    links: { profile: '../profile.html' },
    onCheck: async () => {
      await new Promise(resolve => setTimeout(resolve, 700));
      if (state === 'network') return { error: true };
      if (state === 'assigned') {
        note.textContent = 'Доступ перечитан: тип назначен, модель и шапка обновлены.';
        return { message: 'Администратор назначил тип продукции. Открываем доступный раздел.' };
      }
      return {};
    },
  });
  document.body.append(screen);
})();
