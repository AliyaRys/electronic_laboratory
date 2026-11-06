(() => {
  const root = document.getElementById('admin-reports-root');
  const params = new URLSearchParams(location.search);
  const state = params.get('state');
  const reports = state === 'empty' ? [] : VseReports.createDemoReports();
  const list = VseReports.createReportsList({
    reports,
    initialState: ['loading', 'error'].includes(state) ? state : 'ready',
    links: { create: 'admin-report-create.html', view: 'admin-report-view.html', print: 'admin-report-print.html', samples: 'sample-accounting.html' },
  });
  root.append(list);
  document.querySelector('[data-report-create-icon]')?.replaceWith(VseIcons.create('admin-reports', { className: 'admin-icon' }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
  try {
    const saved = JSON.parse(sessionStorage.getItem('vse-admin-reports-list-state-v1') || '{}');
    if (Number.isFinite(saved.scrollY)) requestAnimationFrame(() => scrollTo({ top: saved.scrollY }));
  } catch { /* Список остаётся доступным без восстановления позиции. */ }
})();
