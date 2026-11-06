(() => {
  const form = document.getElementById('milk-check-form');
  const invoice = form?.querySelector('.invoice-section');
  const party = document.body.dataset.party;
  if (!form || !invoice || !['ak-bars', 'nur'].includes(party)) return;

  const parties = {
    'ak-bars': {
      number: 'RU016:260812-007101', date: '12.08.2026 08:40', owner: 'КФХ «Ак Барс»',
      senderAddress: 'Республика Татарстан, Высокогорский район, с. Высокая Гора, ул. Центральная, 18',
      nomenclature: 'Молоко коровье сырое', amount: '120 л', quantity: '3 секции',
      sections: [{ number: '1', volume: '40 л' }, { number: '2', volume: '40 л' }, { number: '3', volume: '40 л' }],
      produced: '12.08.2026', expires: 'до 13.08.2026', vehicle: 'А245КМ 116',
      trailer: 'Прицеп отсутствует', storage: 'Охлажденное', ttn: '№ ТТН-214 от 12.08.2026',
      documents: 'Ветеринарная справка № 214/26, декларация соответствия ЕАЭС N RU Д-RU.РА04',
      vseNumber: 'ВСЭ № 1184', vseDate: '12.08.2026 07:10',
      vseOperator: 'Высокогорское районное государственное ветеринарное объединение'
    },
    nur: {
      number: 'RU016:260812-007118', date: '12.08.2026 10:15', owner: 'КФХ «Нур»',
      senderAddress: 'Республика Татарстан, Пестречинский район, с. Пестрецы, ул. Молодёжная, 12',
      nomenclature: 'Молоко коровье сырое', amount: '80 л', quantity: '1 секция',
      sections: [{ number: '1', volume: '80 л' }],
      produced: '12.08.2026', expires: 'до 13.08.2026', vehicle: 'Н831ОР 116',
      trailer: 'Прицеп отсутствует', storage: 'Охлажденное', ttn: '№ ТТН-231 от 12.08.2026',
      documents: 'Ветеринарная справка № 231/26, декларация соответствия ЕАЭС N RU Д-RU.РА04',
      vseNumber: 'ВСЭ № 1191', vseDate: '12.08.2026 09:20',
      vseOperator: 'Пестречинское районное государственное ветеринарное объединение'
    }
  };
  const data = parties[party];
  form.dataset.mismatchReasonFields = 'ТТН|Номер ТС|Номер прицепа|Вес|Количество|Срок годности|Название продукции';
  const checkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const badIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const sectionHead = (title, description) => `<div class="section-head"><div class="section-title"><span class="section-icon"></span><div><h2>${title}</h2><p>${description}</p></div></div></div>`;
  const row = (key, label, value, placeholder = 'Укажите фактическое значение', type = 'text', classes = '') => `<div class="compare-row ${classes}" data-check="${key}"><div class="field-name">${label}</div><div class="mercury-value" title="${value}">${value}</div><button class="check-button ok" type="button" data-state="ok" aria-label="${label} соответствует" aria-pressed="false">${checkIcon}</button><button class="check-button bad" type="button" data-state="bad" aria-label="${label} не соответствует" aria-pressed="false">${badIcon}</button><div class="fact-field"><label for="fact-${key}">Фактическое значение</label><input id="fact-${key}" type="${type}" placeholder="${placeholder}"></div></div>`;
  const reference = (label, value, classes = '') => `<div class="compare-row reference ${classes}"><div class="field-name">${label}</div><div class="mercury-value" title="${value}">${value}</div></div>`;
  const quantityRow = () => `<div class="compare-row quantity-row" data-check="quantity" data-quantity-label="${data.quantity}">
    <div class="field-name">Количество</div>
    <div class="mercury-value" title="${data.quantity}"><div class="parts-table" aria-label="Состав партии молока"><div class="parts-row parts-head"><div>Секция</div><div>Объём</div></div>${data.sections.map(section => `<div class="parts-row"><div>${section.number}</div><div>${section.volume}</div></div>`).join('')}</div></div>
    <button class="check-button ok" type="button" data-state="ok" aria-label="Количество соответствует" aria-pressed="false">${checkIcon}</button>
    <button class="check-button bad" type="button" data-state="bad" aria-label="Количество не соответствует" aria-pressed="false">${badIcon}</button>
    <div class="fact-field"><label for="fact-quantity">Фактическое значение</label><input id="fact-quantity" type="text" placeholder="Укажите фактическое количество"></div>
  </div>`;
  const priorVseSection = party === 'ak-bars' ? `<section class="section" data-check-section="priorVse">
    ${sectionHead('Ранее проведённая ВСЭ', 'Сведения из мероприятий с партией продукции: номер экспертизы, дата, организация и результат осмотра.')}
    <div class="compare-grid">
      ${reference('Номер экспертизы', data.vseNumber)}
      ${reference('Дата проведения', data.vseDate)}
      ${reference('Организация-оператор', data.vseOperator)}
      ${reference('Результат осмотра', 'Всё соответствует')}
    </div>
    <div data-prior-conclusion data-text="По результатам ветеринарно-санитарной экспертизы сырое коровье молоко соответствует установленным требованиям безопасности и качества. Органолептические, физико-химические и лабораторные показатели находятся в пределах допустимых значений. Продукция допускается к дальнейшей переработке и реализации при соблюдении условий хранения и срока годности."></div>
  </section>` : '';

  form.querySelectorAll(':scope > .section:not(.invoice-section)').forEach(section => section.remove());
  invoice.insertAdjacentHTML('beforebegin', `
    <section class="section" data-check-section="document">
      ${sectionHead('Документ', 'Реквизиты транспортного эВСД и связанного контроля поставки.')}
      <div class="compare-grid">
        ${reference('Номер эВСД', data.number, 'document-reference')}
        ${reference('Дата оформления', data.date, 'document-reference')}
        ${reference('Статус эВСД', 'Оформлен', 'document-reference')}
        ${reference('Назначение груза', 'Для реализации на продовольственном рынке', 'document-reference')}
      </div>
    </section>
    <section class="section" data-check-section="participants">
      ${sectionHead('Участники перевозки', 'Отправитель, получатель и площадки, указанные в эВСД.')}
      <div class="compare-grid">
        ${row('sender', 'Отправитель', data.owner, 'Кто фактически отправил')}
        ${row('sender-address', 'Адрес отправителя', data.senderAddress, 'Фактический адрес')}
        ${row('recipient', 'Получатель', 'Лаборатория ВСЭ №1 г. Казань', 'Фактический получатель')}
        ${row('recipient-address', 'Адрес получателя', 'г. Казань, ул. Аграрная, д. 2', 'Фактический адрес получателя')}
      </div>
    </section>
    <section class="section" data-check-section="product">
      ${sectionHead('Идентификация продукции по наименованию и визуальным осмотром', 'Продукция, номенклатура, объём и ветеринарные характеристики партии.')}
      <div class="compare-grid product-compare-grid">
        ${row('product', 'Вид продукции', 'Молоко коровье сырое', 'Фактическая продукция')}
        ${row('nomenclature', 'Номенклатура', data.nomenclature, 'Фактическая номенклатура')}
        ${row('producer', 'Производитель', data.owner, 'Фактический производитель', 'text', 'producer-row')}
        ${row('weight', 'Вес', data.amount, 'Фактический вес или объём', 'text', 'weight-row')}
        ${quantityRow()}
        ${row('production-date', 'Дата выработки', data.produced, '', 'date')}
        ${row('expiry-date', 'Срок годности', data.expires, '', 'date')}
      </div>
    </section>
    <section class="section" data-check-section="transport">
      ${sectionHead('Ветеринарно-санитарная оценка и идентификация транспорта', 'Сведения о перевозке и транспортном средстве.')}
      <div class="compare-grid">
        ${row('transport-type', 'Вид транспорта', 'Автомобильный', 'Фактический вид транспорта')}
        ${row('vehicle', 'Номер ТС', data.vehicle, 'Фактический номер ТС')}
        ${row('trailer', 'Номер прицепа', data.trailer, 'Фактический номер прицепа')}
        ${row('storage', 'Способ хранения продукции при перевозке', data.storage, 'Фактический способ хранения')}
      </div>
      <div class="transport-observations" aria-label="Фактическое состояние перевозки">
        <div class="transport-observation"><label for="cargo-condition">Состояние грузового отделения</label><select id="cargo-condition" required><option value="" selected disabled hidden>Выберите значение</option><option>Соответствует требованиям</option><option>Есть загрязнения или повреждения</option></select></div>
        <div class="transport-observation"><label for="combined-cargo">Совместная перевозка с другими грузами</label><select id="combined-cargo" required><option value="" selected disabled hidden>Выберите значение</option><option>Нет</option><option>Да, грузы разделены</option><option>Да, разделение не обеспечено</option></select></div>
      </div>
    </section>
    <section class="section" data-check-section="documents">
      ${sectionHead('Сопроводительные документы', 'Товарно-транспортная накладная и дополнительные документы партии.')}
      <div class="compare-grid">
        ${row('ttn', 'ТТН', data.ttn, 'Фактическая ТТН')}
        ${row('related-documents', 'Связанные документы', data.documents, 'Укажите фактические документы')}
      </div>
    </section>
    ${priorVseSection}
    <div data-check-results></div>`);
  globalThis.VseCheck?.enhance(form);
  globalThis.VsePriorConclusion?.mountAll(form);
})();
