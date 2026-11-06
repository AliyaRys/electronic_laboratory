(() => {
  document.querySelector('[data-back-icon]')?.replaceWith(VseIcons.create('chevron-left', { className: 'admin-icon' }));
  document.getElementById('admin-report-create-root')?.append(VseReports.createReportCreate({ links: { list: 'admin-reports.html', view: 'admin-report-view.html' } }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
})();
