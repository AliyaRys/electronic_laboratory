(() => {
  const profile = globalThis.VseProfile;
  const screen = profile.createScreen({
    title: 'Профиль аналитика',
    user: {
      name: 'Марат Хусаинов',
      login: 'Husainov.Marat@tatar.ru',
      initials: 'МХ',
      city: 'Республика Татарстан',
      role: 'Аналитик',
      registeredAt: '20.01.2024',
      permissions: [
        'Просмотр записей всех лабораторий',
        'Формирование отчётов',
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
