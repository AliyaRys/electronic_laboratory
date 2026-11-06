(() => {
  const api = globalThis.VseAdmin ||= {};
  const make = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  api.createAccessEditor = ({ permissions = [], products = [], disabled = false, onChange } = {}) => {
    const root = make('div', 'admin-access-editor');
    const permissionsSet = new Set(permissions);
    const productsSet = new Set(products);

    const group = (legendText, items, selected, kind) => {
      const fieldset = document.createElement('fieldset');
      fieldset.className = `admin-access-group ${kind}`;
      const legend = document.createElement('legend');
      legend.textContent = legendText;
      const list = make('div', 'admin-access-options');
      items.forEach(item => {
        const label = make('label', 'admin-check-option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = kind;
        input.value = item.code;
        input.checked = selected.has(item.code);
        input.disabled = disabled;
        input.addEventListener('change', () => {
          input.checked ? selected.add(item.code) : selected.delete(item.code);
          update();
          onChange?.(root.getValue());
        });
        label.append(input, make('span', '', item.label));
        list.append(label);
      });
      fieldset.append(legend, list);
      return fieldset;
    };

    const rights = group('Права доступа', api.permissions, permissionsSet, 'permissions');
    const productGroup = group('Доступные типы продукции', api.products, productsSet, 'products');
    const rightsHelp = make('p', 'admin-access-help');
    const productsHelp = make('p', 'admin-access-help');
    rights.append(rightsHelp);
    productGroup.append(productsHelp);
    const summary = make('div', 'admin-access-summary');
    root.append(rights, productGroup, summary);

    function update() {
      rightsHelp.textContent = permissionsSet.size
        ? 'Права действуют для назначенных типов продукции в вашей лаборатории.'
        : 'Дополнительные права не назначены. Просмотр доступной продукции сохраняется.';
      productsHelp.textContent = productsSet.size
        ? 'Пользователь увидит рабочие записи только по выбранным типам продукции.'
        : 'Типы продукции не назначены. Пользователь сможет войти, но не увидит рабочие записи.';
      rightsHelp.classList.toggle('warning', !permissionsSet.size);
      productsHelp.classList.toggle('warning', !productsSet.size);
      summary.textContent = `Прав: ${permissionsSet.size} из ${api.permissions.length} · Типов продукции: ${productsSet.size} из ${api.products.length}`;
    }
    root.getValue = () => ({ permissions: [...permissionsSet], products: [...productsSet] });
    root.setDisabled = value => root.querySelectorAll('input').forEach(input => { input.disabled = Boolean(value); });
    root.setValue = value => {
      permissionsSet.clear(); productsSet.clear();
      value.permissions?.forEach(code => permissionsSet.add(code));
      value.products?.forEach(code => productsSet.add(code));
      root.querySelectorAll('input[name="permissions"]').forEach(input => { input.checked = permissionsSet.has(input.value); });
      root.querySelectorAll('input[name="products"]').forEach(input => { input.checked = productsSet.has(input.value); });
      update();
    };
    update();
    return root;
  };
})();
