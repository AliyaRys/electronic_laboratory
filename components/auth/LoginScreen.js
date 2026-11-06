(() => {
  const ui = globalThis.VseAuth ||= {};

  /** Полный экран исходного login; зависимости и стили общие со Storybook. */
  ui.createLoginScreen = ({ logoSrc = 'vse-lab-icon-transparent.png', ...formOptions } = {}) => {
    const main = ui.createAuthPage();
    const shell = document.createElement('section');
    shell.className = 'auth-shell';
    shell.setAttribute('aria-label', 'Экран входа');
    const welcome = document.createElement('div');
    welcome.className = 'auth-welcome';
    const brand = document.createElement('div');
    brand.className = 'auth-brand';
    const logo = document.createElement('div');
    logo.className = 'auth-logo';
    const image = document.createElement('img');
    image.src = logoSrc;
    image.alt = '';
    image.width = 78;
    image.height = 78;
    image.decoding = 'sync';
    image.fetchPriority = 'high';
    logo.append(image);
    const name = document.createElement('strong');
    name.textContent = 'Электронная лаборатория ВСЭ';
    brand.append(logo, name);
    const heading = document.createElement('h1');
    heading.append('Добро пожаловать в систему ');
    const accent = document.createElement('span');
    accent.className = 'auth-accent';
    accent.textContent = '«Электронная лаборатория ВСЭ»';
    heading.append(accent);
    const description = document.createElement('p');
    description.className = 'auth-welcome-text';
    description.textContent = 'Единая система для работы лабораторий: прием партий продукции, учет данных ветеринарно-санитарных экспертиз.';
    welcome.append(brand, heading, description);
    const form = ui.createLoginForm(formOptions);
    shell.append(welcome, form);
    main.append(shell);
    main.form = form;
    return main;
  };
})();
