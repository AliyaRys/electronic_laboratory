(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const report = id ? VseReports.getReport(id) : (VseReports.createDemoReports()[0] || null);
  document.getElementById('admin-report-print-root')?.append(VseReports.createPrintView(report));
  if (report) document.title = `5-вет — ${report.periodLabel} — ${report.laboratoryName}`;
  if (params.has('print') || params.get('mode') === 'pdf') requestAnimationFrame(() => setTimeout(() => print(), 180));
})();
