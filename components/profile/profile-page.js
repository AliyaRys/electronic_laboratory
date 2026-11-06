(() => {
  const profile = globalThis.VseProfile;
  const screen = profile.createScreen({
    onPhotoSelect: () => {},
    onPasswordSubmit: async () => {},
  });
  document.getElementById('profile-root')?.replaceWith(screen);
  document.getElementById('logout')?.addEventListener('click', () => { window.location.href = 'login.html'; });
})();
