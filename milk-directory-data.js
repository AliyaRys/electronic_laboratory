/* Единый перечень исследований молока и молочной продукции. */
window.milkDirectoryStudies = {
  base: [
    ['consistency', 'Консистенция', 'choice'],
    ['taste-smell', 'Вкус и запах', 'choice'],
    ['color', 'Цвет', 'choice'],
    ['temperature', 'Температура, °C', 'range'],
    ['fat', 'Массовая доля жира, %', 'range'],
    ['protein', 'Массовая доля белка, %', 'range'],
    ['density', 'Плотность, кг/м³', 'range'],
    ['acidity', 'Кислотность, °Т', 'range'],
    ['somo', 'Сухой обезжиренный молочный остаток (СОМО), %', 'range'],
    ['somatic', 'Соматические клетки, тыс./см³', 'range'],
    ['brucellosis', 'Кольцевая реакция на бруцеллёз', 'negative']
  ],
  danger: [
    ['Потенциально опасные вещества', [
      ['antibiotics', 'Содержание потенциально опасных веществ (антибиотиков)']
    ]]
  ]
};

window.renderMilkDangerPrices = function (container, amount, prefix, flat = false) {
  const data = window.milkDirectoryStudies;
  const card = ([id, name]) => {
    const inputId = `${prefix}-${id}`;
    const article = document.createElement('article');
    article.className = 'research';
    article.innerHTML = `<header><h3></h3></header><div class="price-field">${flat ? '' : `<label for="${inputId}">Стоимость</label>`}<div class="price-control"><input id="${inputId}" type="number" min="0" step="0.01" value="${amount}" required><span>₽</span></div></div>`;
    article.querySelector('h3').textContent = name;
    if (flat) article.querySelector('input').setAttribute('aria-label', `Стоимость: ${name}, ₽`);
    return article;
  };
  if (flat) {
    container.classList.add('danger-prices-grid');
    container.append(...data.danger.flatMap(([, studies]) => studies.map(card)));
    return;
  }
  for (const [title, studies] of data.danger) {
    const group = document.createElement('div');
    group.className = 'research-group';
    group.innerHTML = '<h3 class="group-title"></h3><div class="research-grid"></div>';
    group.querySelector('.group-title').textContent = title;
    group.querySelector('.research-grid').append(...studies.map(card));
    container.append(group);
  }
};
