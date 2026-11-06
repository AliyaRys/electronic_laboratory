(() => {
  const id = new URLSearchParams(location.search).get('id');
  const report = id ? VseReports.getReport(id) : (VseReports.createDemoReports()[0] || null);
  document.querySelector('[data-back-icon]')?.replaceWith(VseIcons.create('chevron-left', { className: 'admin-icon' }));
  if (report) {
    document.getElementById('report-view-title').textContent = 'Отчёт по форме 5-вет (раздел III)';
    document.getElementById('report-view-subtitle').textContent = `${report.periodLabel} · ${report.laboratoryName}`;
    document.title = `${report.periodLabel} — Отчёты ВСЭ`;
  }
  document.getElementById('admin-report-view-root')?.append(VseReports.createReportView({ report, links: { list: 'admin-reports.html', print: 'admin-report-print.html' } }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
})();
