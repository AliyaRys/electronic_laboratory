/* Classic script keeps login.html usable over HTTP and when opened from disk. */
document.body.prepend(globalThis.VseAuth.createLoginScreen({
  idPrefix: 'login',
  onSubmit: () => { window.location.href = 'journal.html'; },
}));
