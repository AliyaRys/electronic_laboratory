(() => {
  const api = globalThis.VseAppHeader ||= {};
  const STORAGE_KEY = 'vse-product-type';

  const products = {
    meat: { label: 'Мясо и продукты убоя', shortLabel: 'Мясо' },
    milk: { label: 'Молоко и молочная продукция', shortLabel: 'Молоко' },
  };

  /* Canonical shell icons. Change a path here, never inside an individual page. */
  const icons = {
    arrivals: [
      ['path', { d: 'M4.5 8.2 12 4l7.5 4.2-7.5 4.2-7.5-4.2Z' }],
      ['path', { d: 'M4.5 8.2v7.9L12 20l7.5-3.9V8.2' }],
      ['path', { d: 'M12 12.4V20' }],
    ],
    'journal-classic': [
      ['rect', { x: '4', y: '3', width: '16', height: '18', rx: '2' }],
      ['path', { d: 'M9 3v18M12.5 8H17M12.5 12H17M12.5 16H16' }],
    ],
    'directories-classic': [
      ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z' }],
      ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
    meat: [
      ['path', { d: 'M12.7 3.3c4.8-.5 8.1 2.5 8.1 6.8 0 5.5-4.4 10.5-9.8 10.5-4.4 0-7.8-2.7-7.8-6.7 0-3.1 1.9-5.7 4.7-7.1 1.7-.9 2.5-3.2 4.8-3.5Z' }],
      ['path', { d: 'M12.6 7.3c2.7-.4 4.6 1.2 4.6 3.4 0 2.7-2.5 5-5.2 5-2.2 0-3.8-1.4-3.8-3.5 0-1.8 1.7-3.3 4.4-4.9Z' }],
    ],
    milk: [
      ['path', { d: 'M9 3h6v3l1.5 2.5V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V8.5L9 6V3Z' }],
      ['path', { d: 'M9 6h6M7.5 11h9M7.5 16h9' }],
    ],
    caret: [['path', { d: 'm7 10 5 5 5-5' }]],
  };

  const counterpartRoutes = [
    { meat: 'journal.html', milk: 'journal-milk.html' },
    { meat: 'arrivals.html', milk: 'arrivals-milk.html' },
    { meat: 'arrivals-work.html', milk: 'arrivals-work-milk.html' },
    { meat: 'arrivals-accepted.html', milk: 'arrivals-accepted-milk.html' },
    { meat: 'additional-vet-inspection-create.html', milk: 'additional-vet-inspection-create-milk.html' },
    { meat: 'directory-price-edit.html', milk: 'directory-price-edit-milk.html' },
    { meat: 'directory-paid-services-edit.html', milk: 'directory-paid-services-edit-milk.html' },
    { meat: 'directory-repeat-price-edit.html', milk: 'directory-repeat-price-edit-milk.html' },
    { meat: 'directory-norms-edit.html', milk: 'directory-norms-edit-milk.html' },
  ];

  const create = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  api.createIcon = (name, className = '') => {
    if ((name === 'admin-users' || name === 'admin-reports') && globalThis.VseIcons) {
      return globalThis.VseIcons.create(name, { className });
    }
    if (!icons[name]) throw new Error(`Неизвестная иконка шапки: ${name}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.appHeaderIcon = name;
    if (className) svg.setAttribute('class', className);
    icons[name].forEach(([tag, attributes]) => {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, value));
      svg.append(child);
    });
    return svg;
  };

  const iconSlot = (name, className = 'icon') => {
    const slot = create('span', className);
    slot.setAttribute('aria-hidden', 'true');
    slot.append(api.createIcon(name));
    return slot;
  };

  const navLink = ({ id, href, label, icon, active }) => {
    const link = create('a', `navlink${active ? ' active' : ''}`);
    link.id = id;
    link.href = href;
    if (active) link.setAttribute('aria-current', 'page');
    link.append(iconSlot(icon), create('span', 'navtext', label));
    return link;
  };

  const readStoredProduct = () => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  };

  const saveProduct = product => {
    try { localStorage.setItem(STORAGE_KEY, product); } catch { /* URL remains the source of truth. */ }
  };

  const pageName = () => location.pathname.split('/').pop() || '';
  const detectPageProduct = name => {
    const direct = counterpartRoutes.find(route => Object.values(route).includes(name));
    if (direct) return direct.milk === name ? 'milk' : 'meat';
    if (/(?:^|-)milk(?:-|\.)/.test(name) || name === 'journal-milk.html') return 'milk';
    if (name === 'directory-norms-edit.html') return 'meat';
    if (/^(?:arrivals|journal|evsd-check|electronic-vse|vse-view|additional-vet)/.test(name)) return 'meat';
    return null;
  };

  const targetForProduct = (name, product, active) => {
    const direct = counterpartRoutes.find(route => Object.values(route).includes(name));
    if (direct) return direct[product];
    if (/^directory-norms-edit-milk-[a-z0-9-]+\.html$/.test(name)) return product === 'milk' ? name : 'directory-norms-edit.html';
    if (/^evsd-check-milk-(?:ak-bars|nur|sadykova|tan)(?:-complete)?\.html$/.test(name)) {
      return product === 'milk' ? name : 'evsd-check-usmanov.html';
    }
    if (name === 'electronic-vse-journal-milk.html') return product === 'milk' ? name : 'electronic-vse-journal-biektau.html';
    if (name === 'electronic-vse-journal-biektau.html' || name === 'electronic-vse-journal-kazan-bacon.html') {
      return product === 'meat' ? name : 'electronic-vse-journal-milk.html';
    }
    if (active === 'journal') return product === 'milk' ? 'journal-milk.html' : 'journal.html';
    if (active === 'arrivals') return product === 'milk' ? 'arrivals-milk.html' : 'arrivals.html';
    return name;
  };

  api.spec = Object.freeze({
    height: 76,
    maxContentWidth: 1440,
    minInlinePadding: 24,
    logoSize: 43,
    brandWidth: 295,
    headerGap: 12,
    navOffset: 8,
    navGap: 6,
    controlHeight: 42,
    controlRadius: 10,
    controlInlinePadding: 12,
    controlGap: 9,
    navigationIconSize: 19,
    productSwitcherWidth: 310,
    productIconSize: 20,
    caretSize: 14,
    avatarSize: 32,
    userGap: 5,
  });

  api.create = ({
    mode = 'work',
    product = 'meat',
    active = 'arrivals',
    logoSrc = 'vse-lab-icon-transparent.png',
    institution = 'Лаборатория ВСЭ №1 г. Казань',
    userName = 'Анна Кузнецова',
    userInitials = 'АК',
    menuOpen = false,
    links = {},
    onProductChange,
    onLogout,
  } = {}) => {
    if (!['work', 'admin', 'analyst', 'no-products'].includes(mode)) throw new TypeError('Неизвестный режим шапки');
    if (!products[product]) product = 'meat';
    const header = create('header', 'topbar');
    header.dataset.appHeader = '';
    header.dataset.appHeaderMode = mode;
    if (mode === 'work') header.dataset.product = product;

    const brand = create('a', 'brand');
    brand.id = 'brand-home';
    brand.href = links.brand || (mode === 'admin' ? 'admin-users.html' : mode === 'analyst' ? 'analyst-reports.html' : (product === 'milk' ? 'journal-milk.html' : 'journal.html'));
    if (mode === 'no-products') brand.href = links.brand || 'profile.html';
    brand.setAttribute('aria-label', 'Электронная лаборатория ВСЭ — главная');
    const logo = document.createElement('img');
    Object.assign(logo, { src: logoSrc, alt: '', width: 43, height: 43, loading: 'eager', decoding: 'sync', fetchPriority: 'high' });
    const brandText = create('div', 'brand-copy');
    brandText.append(create('strong', '', 'Электронная лаборатория ВСЭ'), create('span', '', institution));
    brand.append(logo, brandText);

    const nav = create('nav', 'topnav');
    nav.setAttribute('aria-label', 'Основная навигация');
    if (mode === 'no-products') nav.setAttribute('aria-label', 'Рабочие разделы недоступны');
    if (mode === 'admin') {
      nav.append(
        navLink({
          id: 'admin-users-link',
          href: links.adminUsers || 'admin-users.html',
          label: 'Управление пользователями',
          icon: 'admin-users',
          active: active === 'users',
        }),
        navLink({
          id: 'admin-reports-link',
          href: links.adminReports || 'admin-reports.html',
          label: 'Отчёты',
          icon: 'admin-reports',
          active: active === 'reports',
        }),
      );
    } else if (mode === 'analyst') {
      nav.append(
        navLink({ id: 'arrivals-link', href: links.arrivals || 'analyst-arrivals.html', label: 'Поступления', icon: 'arrivals', active: active === 'arrivals' }),
        navLink({ id: 'journal-home', href: links.journal || 'analyst-journal.html', label: 'Журнал ВСЭ', icon: 'journal-classic', active: active === 'journal' }),
        navLink({ id: 'directories', href: links.directories || 'analyst-directories.html', label: 'Справочники', icon: 'directories-classic', active: active === 'directories' }),
        navLink({ id: 'analyst-reports-link', href: links.reports || 'analyst-reports.html', label: 'Отчёты', icon: 'admin-reports', active: active === 'reports' }),
      );
    } else if (mode === 'work') {
      nav.append(
        navLink({ id: 'arrivals-link', href: links.arrivals || (product === 'milk' ? 'arrivals-milk.html' : 'arrivals.html'), label: 'Поступления', icon: 'arrivals', active: active === 'arrivals' }),
        navLink({ id: 'journal-home', href: links.journal || (product === 'milk' ? 'journal-milk.html' : 'journal.html'), label: 'Журнал ВСЭ', icon: 'journal-classic', active: active === 'journal' }),
        navLink({ id: 'directories', href: links.directories || 'directories.html', label: 'Справочники', icon: 'directories-classic', active: active === 'directories' }),
      );
    }

    const switcher = create('div', `nav-item product-switcher${menuOpen ? ' open' : ''}`);
    const trigger = create('button', 'navlink product-trigger');
    trigger.id = 'product-switcher';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', String(menuOpen));
    const productIcon = iconSlot(product, 'product-icon');
    productIcon.dataset.productIcon = product;
    const productLabel = create('span', 'navtext', products[product].label);
    productLabel.dataset.productLabel = '';
    trigger.append(productIcon, productLabel, api.createIcon('caret', 'nav-caret'));
    const menu = create('div', 'journal-menu product-menu');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Тип продукции');
    Object.entries(products).forEach(([key, config]) => {
      const option = create('button', key === product ? 'active' : '', config.label);
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(key === product));
      option.dataset.productOption = key;
      option.prepend(iconSlot(key, 'product-icon'));
      menu.append(option);
    });
    switcher.append(trigger, menu);
    if (mode === 'work') nav.append(switcher);
    if (mode === 'no-products' && !nav.childElementCount) nav.hidden = true;

    const userArea = create('div', 'user-area');
    const userLink = create('a', 'user-link');
    userLink.id = 'profile';
    userLink.href = links.profile || (mode === 'admin' ? 'admin-profile.html' : mode === 'analyst' ? 'analyst-profile.html' : 'profile.html');
    userLink.append(create('span', 'avatar', userInitials), create('span', 'user-name', userName));
    const logout = create('button', 'logout', 'Выйти');
    logout.id = 'logout';
    logout.type = 'button';
    userArea.append(userLink, logout);
    header.append(brand, nav, userArea);

    const setOpen = (open, returnFocus = false) => {
      switcher.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (returnFocus) trigger.focus();
    };

    const setProduct = nextProduct => {
      if (!products[nextProduct]) return;
      header.dataset.product = nextProduct;
      productLabel.textContent = products[nextProduct].label;
      trigger.setAttribute('aria-label', `Тип продукции: ${products[nextProduct].label}`);
      trigger.dataset.shortLabel = products[nextProduct].shortLabel;
      productIcon.replaceChildren(api.createIcon(nextProduct));
      productIcon.dataset.productIcon = nextProduct;
      menu.querySelectorAll('[data-product-option]').forEach(option => {
        const selected = option.dataset.productOption === nextProduct;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-selected', String(selected));
      });
    };

    trigger.addEventListener('click', () => setOpen(!switcher.classList.contains('open')));
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      setOpen(true);
      menu.querySelector('[aria-selected="true"]')?.focus();
    });
    [...menu.querySelectorAll('[data-product-option]')].forEach((option, index, optionsList) => {
      option.addEventListener('click', () => {
        const nextProduct = option.dataset.productOption;
        if (onProductChange) onProductChange(nextProduct, header);
        else setProduct(nextProduct);
        setOpen(false, true);
      });
      option.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false, true);
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          optionsList[(index + direction + optionsList.length) % optionsList.length].focus();
        }
      });
    });
    logout.addEventListener('click', event => onLogout?.(event, header));
    header.addEventListener('keydown', event => {
      if (event.key === 'Escape' && switcher.classList.contains('open')) setOpen(false, true);
    });
    header.addEventListener('focusout', event => {
      if (!header.contains(event.relatedTarget)) setOpen(false);
    });
    if (mode === 'work') {
      document.addEventListener('pointerdown', event => {
        if (header.isConnected && !switcher.contains(event.target)) setOpen(false);
      });
    }

    if (mode === 'work') setProduct(product);
    header.setProduct = setProduct;
    header.setMenuOpen = setOpen;
    return header;
  };

  const activeFromHeader = header => {
    const active = header?.querySelector('.navlink.active');
    if (active?.id === 'journal-home' || active?.id === 'journal-link') return 'journal';
    if (active?.id === 'directories') return 'directories';
    if (active?.id === 'arrivals-link') return 'arrivals';
    if (active?.id === 'admin-users-link') return 'users';
    if (active?.id === 'admin-reports-link' || active?.id === 'analyst-reports-link') return 'reports';
    return '';
  };

  api.mountPage = (root = document) => {
    const current = root.querySelector('.topbar');
    if (!current || current.dataset.appHeaderMounted === 'true') return current;
    const name = pageName();
    const mode = current.dataset.appHeaderMode === 'admin' ? 'admin'
      : current.dataset.appHeaderMode === 'analyst' ? 'analyst'
      : current.dataset.appHeaderMode === 'no-products' ? 'no-products' : 'work';
    const forcedProduct = mode === 'work' ? detectPageProduct(name) : null;
    let product = forcedProduct || readStoredProduct() || 'meat';
    if (!products[product]) product = 'meat';
    const active = activeFromHeader(current);
    const header = api.create({
      mode,
      product,
      active,
      logoSrc: current.dataset.logoSrc || current.querySelector('.brand img')?.getAttribute('src') || undefined,
      institution: current.querySelector('.brand span')?.textContent?.trim() || undefined,
      userName: current.querySelector('.user-link > span:last-child')?.textContent?.trim() || undefined,
      userInitials: current.querySelector('.avatar')?.textContent?.trim() || undefined,
      links: {
        brand: current.dataset.brandHref || undefined,
        adminUsers: current.dataset.adminUsersHref || undefined,
        adminReports: current.dataset.adminReportsHref || undefined,
        arrivals: current.dataset.arrivalsHref || undefined,
        journal: current.dataset.journalHref || undefined,
        directories: current.dataset.directoriesHref || undefined,
        reports: current.dataset.reportsHref || undefined,
        profile: current.dataset.profileHref || undefined,
      },
      onProductChange: nextProduct => {
        saveProduct(nextProduct);
        const target = targetForProduct(name, nextProduct, active);
        if (target && target !== name) location.href = target;
        else header.setProduct(nextProduct);
      },
    });
    header.dataset.appHeaderMounted = 'true';
    current.replaceWith(header);
    if (mode === 'work') document.documentElement.dataset.productType = product;
    if (mode === 'work' && forcedProduct) saveProduct(forcedProduct);
    return header;
  };
})();
