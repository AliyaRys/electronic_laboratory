(() => {
  const app = globalThis.VseApp ||= {};
  const profile = globalThis.VseProfile ||= {};

  const defaultUser = {
    name: 'Анна Кузнецова',
    login: 'Kuznetsova.Anna@tatar.ru',
    initials: 'АК',
    institution: 'Лаборатория ВСЭ №1 г. Казань',
    position: 'Ветеринарный врач',
    registeredAt: '12.03.2024',
    permissions: ['Создание ВСЭ', 'Редактирование ВСЭ', 'Просмотр ВСЭ', 'Создание справочников'],
    products: [{ label: 'Мясо и продукты убоя', icon: 'meat' }, { label: 'Молоко и молочная продукция', icon: 'milk' }],
  };

  /** Main profile content. The established application header remains owned by app-shell. */
  profile.createScreen = ({ user = {}, title = 'Профиль пользователя', passwordOpen = false, passwordBusy = false, passwordError = '', onPhotoSelect, onPasswordSubmit } = {}) => {
    const data = { ...defaultUser, ...user };
    const main = document.createElement('main');
    main.className = 'vse-app profile-main';
    const heading = document.createElement('h1');
    heading.textContent = title;
    const shell = document.createElement('section');
    shell.className = 'profile-shell';
    shell.setAttribute('aria-label', 'Профиль пользователя');
    const summary = profile.createSummary({ ...data, onPhotoSelect });
    const details = document.createElement('section');
    details.className = 'profile-details-card';
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'profile-section-title';
    const icon = document.createElement('span');
    icon.className = 'profile-section-icon';
    icon.append(app.createIcon('user'));
    const titleText = document.createElement('h2');
    titleText.textContent = 'Данные пользователя';
    sectionTitle.append(icon, titleText);
    const grid = document.createElement('div');
    grid.className = 'profile-info-grid';
    const contextField = data.city
      ? app.createInfoField({ label: 'Город/МО', value: data.city, wide: true })
      : app.createInfoField({ label: 'Учреждение', value: data.institution, wide: true });
    const roleField = data.role
      ? app.createInfoField({ label: 'Роль', value: data.role })
      : app.createInfoField({ label: 'Должность', value: data.position });
    grid.append(
      app.createInfoField({ label: 'Фамилия и имя', value: data.name }),
      app.createInfoField({ label: 'Логин', value: data.login }),
      contextField,
      roleField,
      app.createInfoField({ label: 'Дата регистрации', value: data.registeredAt }),
    );
    const passwordForm = profile.createPasswordChangeForm({ open: passwordOpen, busy: passwordBusy, error: passwordError, onSubmit: onPasswordSubmit });
    details.append(sectionTitle, grid, passwordForm);
    shell.append(summary, details);
    main.append(heading, shell);
    main.summary = summary;
    main.passwordForm = passwordForm;
    return main;
  };
})();
