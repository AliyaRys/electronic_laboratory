(() => {
  const app = globalThis.VseApp ||= {};
  const profile = globalThis.VseProfile ||= {};

  /** Identity, access rights and available product types shown together in the profile sidebar. */
  profile.createSummary = ({
    name = 'Анна Кузнецова',
    login = 'Kuznetsova.Anna@tatar.ru',
    initials = 'АК',
    permissions = ['Создание ВСЭ', 'Редактирование ВСЭ', 'Просмотр ВСЭ', 'Создание справочников'],
    products = [{ label: 'Мясо и продукты убоя', icon: 'meat' }, { label: 'Молоко и молочная продукция', icon: 'milk' }],
    disabled = false,
    onPhotoSelect,
  } = {}) => {
    const card = document.createElement('aside');
    card.className = 'vse-app profile-summary-card';
    const picker = document.createElement('label');
    picker.className = 'profile-avatar-picker';
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials;
    const camera = document.createElement('span');
    camera.className = 'profile-camera';
    camera.setAttribute('aria-hidden', 'true');
    camera.append(app.createIcon('camera'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.disabled = disabled;
    input.setAttribute('aria-label', 'Выбрать фото профиля');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) onPhotoSelect?.(file);
      input.value = '';
    });
    picker.append(avatar, camera, input);
    const identity = document.createElement('div');
    identity.className = 'profile-identity';
    const fullName = document.createElement('div');
    fullName.className = 'profile-name';
    fullName.textContent = name;
    const userLogin = document.createElement('div');
    userLogin.className = 'profile-login';
    userLogin.textContent = login;
    identity.append(fullName, userLogin);
    const access = document.createElement('div');
    access.className = 'profile-access';
    const accessTitle = document.createElement('div');
    accessTitle.className = 'app-info-label';
    accessTitle.textContent = 'Права доступа';
    const rights = document.createElement('div');
    rights.className = 'profile-rights';
    for (const permission of permissions) {
      const tag = document.createElement('span');
      tag.className = 'profile-right-tag';
      tag.textContent = permission;
      rights.append(tag);
    }
    access.append(accessTitle, rights);
    card.append(picker, identity, access);
    if (products.length) {
      const productBox = document.createElement('div');
      productBox.className = 'profile-products';
      const productTitle = document.createElement('div');
      productTitle.className = 'app-info-label';
      productTitle.textContent = 'Доступные типы продукции';
      const productList = document.createElement('div');
      productList.className = 'profile-product-list';
      for (const product of products) {
        const item = document.createElement('div');
        item.className = 'profile-product';
        if (product.icon) item.append(app.createIcon(product.icon));
        const text = document.createElement('span');
        text.textContent = product.label;
        item.append(text);
        productList.append(item);
      }
      productBox.append(productTitle, productList);
      card.append(productBox);
    }
    card.photoInput = input;
    return card;
  };
})();
