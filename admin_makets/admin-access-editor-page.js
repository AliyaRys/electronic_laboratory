(() => {
  const root = document.getElementById('admin-access-root');
  const params = new URLSearchParams(location.search);
  const state = params.get('state');
  const message = document.getElementById('access-message');
  const revokeButton = document.getElementById('revoke-current-type');
  const revokeNote = document.getElementById('revoke-note');
  const resetButton = document.getElementById('reset-access');
  const saveButton = document.getElementById('save-access');

  const RAW_MILK = 'raw_milk';
  const productLabel = code => VseAdmin.products.find(item => item.code === code)?.label ?? code;

  const PRESETS = {
    partial: { permissions: ['vse_write'], products: [RAW_MILK] },
    all: {
      permissions: ['vse_write', 'vse_delete', 'expected_party_delete', 'directory_edit', 'directory_delete'],
      products: ['meat', RAW_MILK, 'eggs', 'fish', 'bee_products', 'plant_food'],
    },
    'rights-only': { permissions: ['vse_write', 'directory_edit'], products: [] },
    'products-only': { permissions: [], products: ['meat', 'fish'] },
    revoke: { permissions: ['vse_write', 'expected_party_delete'], products: ['meat', RAW_MILK, 'eggs'] },
  };

  const initial = state && PRESETS[state] ? PRESETS[state] : { permissions: [], products: [] };

  const snapshot = ({ permissions, products }) => ({ permissions: [...permissions], products: [...products] });
  const initialSnapshot = snapshot(initial);
  const sameSnapshot = (a, b) =>
    a.permissions.length === b.permissions.length && a.permissions.every(code => b.permissions.includes(code)) &&
    a.products.length === b.products.length && a.products.every(code => b.products.includes(code));

  const showMessage = (text, kind = '') => {
    message.textContent = text;
    message.className = `admin-access-demo-note${kind ? ` ${kind}` : ''}`;
  };
  const clearMessage = () => showMessage('');

  const editor = VseAdmin.createAccessEditor({
    permissions: initialSnapshot.permissions,
    products: initialSnapshot.products,
    disabled: state === 'loading' || state === 'disabled',
    onChange: clearMessage,
  });
  root.append(editor);

  resetButton.addEventListener('click', () => {
    const current = snapshot(editor.getValue());
    if (sameSnapshot(current, initialSnapshot)) { clearMessage(); return; }
    editor.setValue(initialSnapshot);
    showMessage('Изменения отменены: значения вернулись к сохранённым.');
  });

  saveButton.addEventListener('click', () => {
    const value = editor.getValue();
    showMessage(`Сохранено одной операцией: прав ${value.permissions.length}, типов продукции ${value.products.length}.`, 'saved');
  });

  const updateRevoke = () => {
    const available = state === 'revoke';
    const selected = editor.getValue().products.includes(RAW_MILK);
    revokeButton.hidden = !(available && selected);
    if (!available) {
      revokeNote.textContent = 'Кнопка отзыва работает в состоянии «Отзыв выбранного типа».';
    } else if (!selected) {
      revokeNote.textContent = 'Тип сырого молока отозван. Флажок снят, из прежнего набора он не восстановлен.';
    } else {
      revokeNote.textContent = `Доступный тип, который можно отозвать: ${productLabel(RAW_MILK)}. После отзыва флажок снимается; текущий выбранный тип не восстанавливается из прежнего набора.`;
    }
  };

  revokeButton.addEventListener('click', () => {
    const value = editor.getValue();
    if (!value.products.includes(RAW_MILK)) return;
    editor.setValue({ permissions: value.permissions, products: value.products.filter(code => code !== RAW_MILK) });
    const rest = value.products.filter(code => code !== RAW_MILK);
    showMessage(`Отозван тип: ${productLabel(RAW_MILK)}. Открытый сейчас тип не восстановлен из прежнего набора; остались: ${rest.map(productLabel).join('; ')}.`, 'error');
    updateRevoke();
  });

  if (state === 'loading') {
    showMessage('Загрузка: флажки недоступны, значения и размеры сохраняются.');
    setTimeout(() => { editor.setDisabled(false); showMessage('Загрузка завершена: сохранённые значения восстановлены точно.'); }, 900);
  } else if (state === 'disabled') {
    showMessage('У административной учётной записи блок открывается только на просмотр: флажки не переключаются.');
  } else {
    editor.setDisabled(false);
  }

  document.querySelectorAll('.admin-access-demo-nav a').forEach(link => {
    const active = new URL(link.href).searchParams.get('state') === state;
    link.classList.toggle('active', active);
  });

  document.querySelector('[data-back-icon]').replaceWith(VseIcons.create('chevron-left', { className: 'admin-icon' }));
  document.getElementById('logout')?.addEventListener('click', () => { location.href = '../login.html'; });
  updateRevoke();
})();
