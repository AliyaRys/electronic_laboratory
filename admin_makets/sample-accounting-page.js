(() => {
  const root = document.getElementById('sample-accounting-root');
  const params = new URLSearchParams(location.search);
  const requestedState = params.get('state');
  root.append(VseSampleAccounting.createScreen({
    initialLaboratoryId: params.get('laboratory') || 'lab-kazan-1',
    initialState: ['loading', 'error', 'empty'].includes(requestedState) ? requestedState : 'ready',
    canDispose: true,
  }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
})();
