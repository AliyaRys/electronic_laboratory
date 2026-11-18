(() => {
  const api = globalThis.VseAppHeader ||= {};
  const STORAGE_KEY = 'vse-product-type';

  const products = {
    meat: { label: 'Мясо и мясопродукты', shortLabel: 'Мясо', icon: 'meat', available: true },
    milk: { label: 'Молоко и молочные продукты', shortLabel: 'Молоко', icon: 'milk', available: false },
    eggs: { label: 'Яйца и яйцепродукция', shortLabel: 'Яйца', icon: 'product-eggs', available: false },
    fish: { label: 'Рыба и рыбная продукция', shortLabel: 'Рыба', icon: 'product-fish', available: false },
    honey: { label: 'Мёд и медовая продукция', shortLabel: 'Мёд', icon: 'product-honey', available: false },
    plant: { label: 'Растительная пищевая продукция', shortLabel: 'Продукция', icon: 'product-plant', available: false },
  };

  /* ТЗ DR46 §3.1: the roadmap order of the product menu (meat only available). */
  const roadmapOrder = ['meat', 'milk', 'eggs', 'fish', 'honey', 'plant'];
  const ROADMAP_STATUS_LABEL = 'Пока недоступно';

  /* ТЗ DR45 §5 (история): прежний статичный однострочный контекст шапки
     заменён общим roadmap-переключателем DR46 (productStatic больше не
     создаёт отдельный владельца разметки). */

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

  // ==== GENERATED: product icons (scripts/sync-product-icons.mjs) — do not edit ====
  const productIcons = {
    "product-eggs": { width: 384, height: 512, solid: true, parts: [{"d":"M192 496C86 496 0 394 0 288 0 176 64 16 192 16S384 176 384 288c0 106-86 208-192 208zM154.8 134c6.5-6 7-16.1 1-22.6s-16.1-7-22.6-1c-23.9 21.8-41.1 52.7-52.3 84.2-11.2 31.6-16.9 65.1-16.9 93.5 0 8.8 7.2 16 16 16s16-7.2 16-16c0-24.5 5-54.4 15.1-82.8 10.1-28.5 25-54.1 43.7-71.2z"}] },
    "product-fish": { width: 576, height: 512, solid: true, parts: [{"d":"M180.5 141.5C219.7 108.5 272.6 80 336 80s116.3 28.5 155.5 61.5c39.1 33 66.9 72.4 81 99.8 4.7 9.2 4.7 20.1 0 29.3-14.1 27.4-41.9 66.8-81 99.8-39.2 33.1-92 61.5-155.5 61.5s-116.3-28.5-155.5-61.5c-16.2-13.7-30.5-28.5-42.7-43.1L48.1 379.6c-12.5 7.3-28.4 5.3-38.7-4.9s-12.4-26-5.3-38.6L50 256 4.2 175.9c-7.2-12.6-5-28.4 5.3-38.6s26.1-12.2 38.7-4.9l89.7 52.3c12.2-14.6 26.5-29.4 42.7-43.1zM448 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z"}] },
    "product-plant": { width: 576, height: 512, solid: true, parts: [{"d":"M79.7 234.6c6.2-4.1 14.7-3.4 20.1 2.1l46.1 46.1 6.1 6.7c19.7 23.8 26.3 55 19.2 83.9 31.7-7.7 66.2 1 90.6 25.3l46.1 46.1c6.2 6.2 6.2 16.4 0 22.6l-7.4 7.4c-37.5 37.5-98.3 37.5-135.8 0L134.1 444.3 49.4 529c-9.4 9.4-24.5 9.4-33.9 0-9.4-9.4-9.4-24.6 0-33.9l84.7-84.7-30.5-30.5c-37.5-37.5-37.5-98.3 0-135.7l7.4-7.4 2.5-2.1zm104-104c6.2-4.1 14.7-3.4 20.1 2.1l46.1 46.1 6.1 6.7c19.7 23.8 26.3 55 19.2 83.9 31.7-7.7 66.2 1 90.6 25.3l46.1 46.1c6.2 6.2 6.2 16.4 0 22.6l-7.4 7.4c-37.5 37.5-98.3 37.5-135.8 0l-94.9-94.9c-37.5-37.5-37.5-98.3 0-135.7l7.4-7.4 2.5-2.1zM495.2 15c9.4-9.4 24.6-9.4 34 0 8.8 8.8 9.3 22.7 1.6 32.2L529.2 49 414.7 163.4c7.7 1 15.2 3 22.5 5.9L495.5 111c9.4-9.4 24.6-9.4 34 0 8.8 8.8 9.3 22.7 1.6 32.1l-1.7 1.8-52.7 52.7 39 39c6.2 6.2 6.2 16.4 0 22.6l-7.4 7.4c-37.5 37.5-98.3 37.5-135.8 0l-94.9-94.9c-37.5-37.5-37.5-98.3 0-135.7l7.4-7.4 2.5-2.1c6.2-4.1 14.7-3.4 20.1 2.1l39 39 52.7-52.7c9.4-9.4 24.6-9.4 34 0 8.8 8.8 9.3 22.7 1.6 32.1l-1.7 1.8-58.3 58.3c2.8 7.1 4.7 14.5 5.7 22.1L495.2 15z"}] },
  };
  // ==== END GENERATED product icons ====

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
    const generated = productIcons[name];
    const definition = generated || icons[name];
    if (!definition) throw new Error(`Неизвестная иконка шапки: ${name}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    /* ТЗ DR50: generated library icons carry their own viewBox and solid fill. */
    svg.setAttribute(
      'viewBox',
      generated ? `0 0 ${generated.width} ${generated.height}` : '0 0 24 24',
    );
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.appHeaderIcon = name;
    if (className) svg.setAttribute('class', className);
    (generated ? generated.parts : definition).forEach(part => {
      const [tag, attributes] = Array.isArray(part) ? part : ['path', part];
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([key, value]) => child.setAttribute(key, value));
      if (generated) {
        child.setAttribute('fill', 'currentColor');
        child.setAttribute('stroke', 'none');
      }
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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // ТЗ DR45 §5: production is meat-only; a legacy stored 'milk' context
      // is normalized to 'meat' on read (never restored as milk).
      return stored === 'milk' ? 'meat' : stored;
    } catch { return null; }
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
    // ТЗ DR45 §5: the single-product static variant of the production work
    // header (no button, no caret, no milk option) — see README.
    productStatic = false,
    links = {},
    onProductChange,
    onLogout,
  } = {}) => {
    if (!['work', 'admin', 'analyst', 'no-products'].includes(mode)) throw new TypeError('Неизвестный режим шапки');
    if (!products[product] || products[product].available !== true) product = 'meat';
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
    let trigger = null;
    let menu = null;
    const productIcon = iconSlot(products[product].icon, 'product-icon');
    productIcon.dataset.productIcon = product;
    const productLabel = create('span', 'navtext', products[product].label);
    productLabel.dataset.productLabel = '';
    // ТЗ DR46 §3.1: the single canonical roadmap-menu variant (the former
    // productStatic path no longer creates a parallel owner of the markup).
    trigger = create('button', 'navlink product-trigger');
    trigger.id = 'product-switcher';
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', String(menuOpen));
    trigger.setAttribute('aria-label', `Тип продукции: ${products[product].label}`);
    trigger.dataset.shortLabel = products[product].shortLabel;
    trigger.append(productIcon, productLabel, api.createIcon('caret', 'nav-caret'));
    menu = create('div', 'journal-menu product-menu');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Тип продукции');
    roadmapOrder.forEach(key => {
      const config = products[key];
      const option = create('button', key === product ? 'active' : '', '');
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(key === product));
      option.dataset.productOption = key;
      if (!config.available) {
        option.disabled = true;
        option.setAttribute('aria-disabled', 'true');
        const status = create('span', 'product-option-status', ROADMAP_STATUS_LABEL);
        status.dataset.productStatus = '';
        option.append(iconSlot(key, 'product-icon'), create('span', 'product-option-label', config.label), status);
      } else {
        option.append(iconSlot(key, 'product-icon'), create('span', 'product-option-label', config.label));
      }
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
      if (!trigger) return;
      switcher.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (returnFocus) trigger.focus();
    };

    const setProduct = nextProduct => {
      // ТЗ DR45 §5 / DR46 §3.1: a stored/requested unavailable roadmap key
      // never becomes active — it is normalized to 'meat'.
      const normalized = products[nextProduct] && products[nextProduct].available === true ? nextProduct : 'meat';
      if (!products[normalized]) return;
      header.dataset.product = normalized;
      productLabel.textContent = products[normalized].label;
      productIcon.replaceChildren(api.createIcon(normalized));
      productIcon.dataset.productIcon = normalized;
      if (!trigger) return;
      trigger.setAttribute('aria-label', `Тип продукции: ${products[normalized].label}`);
      trigger.dataset.shortLabel = products[normalized].shortLabel;
      menu.querySelectorAll('[data-product-option]').forEach(option => {
        const selected = option.dataset.productOption === normalized;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-selected', String(selected));
      });
    };

    if (trigger) {
      trigger.addEventListener('click', () => setOpen(!switcher.classList.contains('open')));
      trigger.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        setOpen(true);
        (menu.querySelector('[data-product-option]:not([disabled])') || menu.querySelector('[aria-selected="true"]'))?.focus();
      });
      [...menu.querySelectorAll('[data-product-option]')].forEach((option, index, optionsList) => {
        option.addEventListener('click', () => {
          const nextProduct = option.dataset.productOption;
          if (!products[nextProduct] || products[nextProduct].available !== true) return;
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
            const enabled = optionsList.filter(candidate => !candidate.disabled);
            if (!enabled.length) return;
            const current = enabled.indexOf(option);
            enabled[(current + direction + enabled.length) % enabled.length].focus();
          }
        });
      });
    }
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
