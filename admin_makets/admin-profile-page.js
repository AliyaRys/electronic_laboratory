(() => {
  const profile = globalThis.VseProfile;
  const screen = profile.createScreen({
    title: 'Профиль администратора',
    user: {
      name: 'Елена Морозова',
      login: 'Morozova.Elena@tatar.ru',
      initials: 'ЕМ',
      city: 'г. Казань',
      role: 'Администратор',
      registeredAt: '05.02.2024',
      permissions: [
        'Создание и редактирование пользователей',
        'Блокировка и разблокировка',
        'Сброс паролей',
        'Редактирование справочников',
      ],
      products: [],
    },
    onPhotoSelect: () => {},
    onPasswordSubmit: async () => {},
  });
  document.getElementById('profile-root')?.replaceWith(screen);
  document.getElementById('logout')?.addEventListener('click', () => { window.location.href = '../login.html'; });
})();
