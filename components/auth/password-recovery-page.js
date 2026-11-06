(() => {
  const storageKey = 'vse-password-recovery-email';
  const readEmail = () => { try { return sessionStorage.getItem(storageKey) || ''; } catch { return ''; } };
  const clearEmail = () => { try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable for local files. */ } };
  const mode = document.body.dataset.recoveryView === 'sent' ? 'sent' : 'form';
  const screen = globalThis.VseAuth.createRecoveryScreen({
    mode,
    idPrefix: 'recovery',
    email: readEmail(),
    onSubmit: async ({ email }) => {
      try { sessionStorage.setItem(storageKey, email); } catch { /* Confirmation still works without the address. */ }
      await new Promise(resolve => setTimeout(resolve, 350));
      window.location.href = 'password-recovery-sent.html';
    },
    onBack: clearEmail,
  });
  document.body.prepend(screen);
  window.addEventListener?.('pageshow', event => {
    if (event.persisted) screen.form?.setBusy(false);
  });
})();
