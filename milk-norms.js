(() => {
  const data = window.milkNormsCatalog;
  const rail = document.getElementById('milk-norms-rail');
  const nav = document.getElementById('milk-norms-nav');
  const toggle = document.getElementById('milk-norms-toggle');
  const heading = document.getElementById('norms-product-title');
  const error = document.getElementById('norms-error');
  const form = document.getElementById('norms-directory-form');
  const actions = form?.querySelector('.actions');
  if (!data || !rail || !nav || !toggle || !heading || !error || !form || !actions) return;

  let activeProduct = null;
  let storageKey = '';

  for (const item of data.catalog) {
    const link = document.createElement('a');
    link.href = item.file;
    link.dataset.normProduct = item.slug;
    link.textContent = item.title;
    nav.append(link);
  }

  function addRow(container, row) {
    const article = document.createElement('article');
    article.className = `norm-row${row.kind === 'choice' ? ' choice-row' : ''}`;
    const info = document.createElement('div');
    info.className = 'norm-info';
    const label = document.createElement('div');
    label.className = 'norm-name';
    label.textContent = row.label;
    info.append(label);
    article.append(info);

    if (row.kind === 'choice') {
      const field = document.createElement('div');
      field.className = 'field';
      const fieldLabel = document.createElement('label');
      const id = `milk-norm-product-${row.id}`;
      fieldLabel.htmlFor = id;
      fieldLabel.textContent = 'Норма';
      const select = document.createElement('select');
      select.id = id;
      select.name = `product:${row.id}`;
      select.required = true;
      for (const optionValue of row.options) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = optionValue;
        option.selected = optionValue === row.value;
        select.append(option);
      }
      field.append(fieldLabel, select);
      article.append(field);
    } else {
      for (const [bound, text] of [['min', 'Норма от'], ['max', 'Норма до']]) {
        const field = document.createElement('div');
        field.className = 'field';
        const fieldLabel = document.createElement('label');
        const id = `milk-norm-product-${row.id}-${bound}`;
        fieldLabel.htmlFor = id;
        fieldLabel.textContent = `${text}, ${row.unit}`;
        const input = document.createElement('input');
        input.id = id;
        input.name = `product:${row.id}:${bound}`;
        input.type = 'number';
        input.step = 'any';
        input.inputMode = 'decimal';
        input.dataset.bound = bound;
        if (row[bound] == null) {
          input.disabled = true;
          input.placeholder = '—';
          input.setAttribute('aria-label', `${row.label}: ${text.toLowerCase()} не установлена`);
        } else {
          input.value = String(row[bound]);
          input.required = true;
        }
        field.append(fieldLabel, input);
        article.append(field);
      }
    }
    container.append(article);
  }

  function createSection(rows) {
    const section = document.createElement('section');
    section.className = 'section norms-generated';
    const head = document.createElement('div');
    head.className = 'section-head';
    const title = document.createElement('h2');
    title.textContent = 'Исследования ВСЭ';
    head.append(title);
    section.append(head);
    const list = document.createElement('div');
    list.className = 'norm-list';
    for (const row of rows) addRow(list, row);
    section.append(list);
    return section;
  }

  function restoreValues() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      form.querySelectorAll('input[name]:not(:disabled), select[name]').forEach(control => {
        if (!Object.hasOwn(stored, control.name)) return;
        if (control.tagName === 'SELECT' || Number.isFinite(Number(stored[control.name]))) control.value = stored[control.name];
      });
    } catch { /* Default values remain available without storage. */ }
  }

  function syncProduct(product) {
    activeProduct = product;
    storageKey = `vse-milk-norms:${product.slug}`;
    document.body.dataset.normProduct = product.slug;
    heading.textContent = product.title;
    toggle.querySelector('span').textContent = `Вид продукции: ${product.title}`;
    document.title = `${product.title} — Нормы исследований — Электронная лаборатория ВСЭ`;
    for (const link of nav.querySelectorAll('a')) {
      const current = link.dataset.normProduct === product.slug;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    form.querySelector('.norms-generated')?.remove();
    form.insertBefore(createSection(product.rows), actions);
    restoreValues();
    error.textContent = '';
  }

  function productFromLocation() {
    const file = location.pathname.split('/').pop();
    return data.catalog.find(item => item.file === file) || data.catalog.find(item => item.slug === document.body.dataset.normProduct) || data.catalog[0];
  }

  syncProduct(productFromLocation());

  nav.addEventListener('click', event => {
    const link = event.target.closest('a[data-norm-product]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const product = data.catalog.find(item => item.slug === link.dataset.normProduct);
    if (!product || product === activeProduct) return;
    event.preventDefault();
    syncProduct(product);
    try { history.pushState({ normProduct: product.slug }, '', product.file); }
    catch { window.location.href = product.file; return; }
    link.focus({ preventScroll: true });
    rail.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });

  window.addEventListener('popstate', () => syncProduct(productFromLocation()));
  toggle.addEventListener('click', () => {
    const open = rail.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && rail.classList.contains('open')) {
      rail.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  function validate() {
    let first = null;
    form.querySelectorAll('input[name]:not(:disabled)').forEach(input => {
      const invalid = input.value.trim() === '' || !Number.isFinite(Number(input.value));
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid && !first) first = input;
    });
    for (const article of form.querySelectorAll('.norm-row:not(.choice-row)')) {
      const min = article.querySelector('input[data-bound="min"]');
      const max = article.querySelector('input[data-bound="max"]');
      if (min && max && !min.disabled && !max.disabled && min.value !== '' && max.value !== '' && Number(min.value) > Number(max.value)) {
        min.setAttribute('aria-invalid', 'true');
        max.setAttribute('aria-invalid', 'true');
        first ||= min;
      }
    }
    if (first) {
      error.textContent = 'Проверьте заполнение и границы диапазонов.';
      first.focus();
      return false;
    }
    error.textContent = '';
    return true;
  }

  form.addEventListener('input', event => {
    if (!event.target.matches('input[name]')) return;
    event.target.removeAttribute('aria-invalid');
    error.textContent = '';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!validate()) return;
    const values = {};
    form.querySelectorAll('input[name]:not(:disabled), select[name]').forEach(control => { values[control.name] = control.value; });
    try { localStorage.setItem(storageKey, JSON.stringify(values)); }
    catch {
      error.textContent = 'Не удалось сохранить значения в этом браузере.';
      return;
    }
    window.location.href = 'directories.html';
  });
})();
