(() => {
  const params = new URLSearchParams(location.search);
  const reason = params.get('reason');
  const mode = params.get('mode') === 'admin' ? 'admin' : 'work';
  const hasProducts = params.get('products') !== '0';
  const savedView = params.get('saved') === '1';
  const checkState = { check: 'checking', network: 'network-error' }[params.get('state')] ?? undefined;

  const REASONS = {
    'no-permission': { label: 'Нет права', note: 'Причина передаётся кодом, не текстом URL.' },
    changed: { label: 'Доступ отозван', note: 'Несохранённые изменения отброшены, сохранённые версии не тронуты. Ссылка «Открыть сохранённую версию» есть только когда чтение объекта разрешено.' },
    'product-denied': { label: 'Тип продукции', note: hasProducts ? 'Реквизиты чужой партии не показываются.' : 'Доступной продукции не осталось: следующий шаг — экран «Нет доступной продукции».' },
    'admin-page': { label: 'Рабочая страница', note: 'Шапка административная, доступен только список пользователей.' },
  };

  const workLinks = {
    brand: '../journal.html',
    arrivals: '../arrivals.html',
    journal: '../journal.html',
    directories: '../directories.html',
    profile: '../profile.html',
  };
  const adminLinks = { brand: 'admin-users.html', adminUsers: 'admin-users.html', profile: 'admin-profile.html' };

  const header = VseAppHeader.create({
    mode,
    product: 'meat',
    active: mode === 'admin' ? 'users' : '',
    logoSrc: '../vse-lab-icon-transparent.png',
    institution: mode === 'admin' ? 'Лаборатория ВСЭ №1 г. Казань' : 'Лаборатория ВСЭ №1 г. Казань',
    userName: mode === 'admin' ? 'Елена Морозова' : 'Анна Кузнецова',
    userInitials: mode === 'admin' ? 'ЕМ' : 'АК',
    links: mode === 'admin' ? adminLinks : workLinks,
    onLogout: () => { location.href = '../login.html'; },
  });
  document.body.prepend(header);

  const nav = document.createElement('nav');
  nav.className = 'access-denied-demo-nav';
  nav.setAttribute('aria-label', 'Демонстрационные причины отказа');
  Object.entries(REASONS).forEach(([code, config]) => {
    const link = document.createElement('a');
    link.href = `access-denied.html?reason=${code}`;
    if (code === 'admin-page') link.href += '&mode=admin';
    if (code === 'product-denied') link.href += '&products=0';
    if (code === 'changed') link.href += '&saved=1';
    link.textContent = config.label;
    link.classList.toggle('active', code === reason);
    nav.append(link);
  });
  document.body.append(nav);

  const note = document.createElement('p');
  note.className = 'access-denied-demo-note';
  note.textContent = (checkState === 'checking' ? 'Данные не открываются, пока проверка не завершена. ' : checkState === 'network-error' ? 'При отказе проверки запрещённые данные не показываются. ' : '') + (REASONS[reason]?.note ?? '');
  document.body.append(note);

  const screen = VseAppHeader.createAccessDenied({
    reason,
    checkState,
    hasAvailableProducts: hasProducts,
    savedView,
    links: {
      available: '../journal.html',
      profile: mode === 'admin' ? 'admin-profile.html' : '../profile.html',
      products: '../journal.html',
      adminUsers: 'admin-users.html',
      saved: '../journal.html',
    },
    onRetryCheck: () => {
      note.textContent = 'Проверка доступа выполняется повторно.';
    },
  });
  document.body.append(screen);
})();
