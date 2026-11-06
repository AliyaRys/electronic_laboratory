(() => {
  const params = new URLSearchParams(location.search);
  const laboratoryId = params.get('laboratory') || 'lab-kazan-1';
  document.getElementById('sample-accounting-print-root')?.append(VseSampleAccounting.createPrintView(laboratoryId));
  if (params.has('print') || params.get('mode') === 'pdf') requestAnimationFrame(() => setTimeout(() => print(), 180));
})();
