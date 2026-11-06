(() => {
  if (!globalThis.VseAppHeader) throw new Error('components/shell/AppHeader.js должен быть подключён перед app-shell.js');
  globalThis.VseAppHeader.mountPage(document);
  document.querySelectorAll('#send-max, .conclusion-max, #milk-max, #max-modal').forEach(element => element.remove());
})();
