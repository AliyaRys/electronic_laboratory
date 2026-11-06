function renderVseInvoice(studies, tariff) {
  const body = document.getElementById('vse-invoice-lines');
  const total = document.getElementById('vse-invoice-total');
  if (!body || !total) return;
  const money = amount => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount) + ' ₽';
  body.replaceChildren();
  if (!studies.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = 'invoice-empty';
    cell.textContent = 'Исследования ещё не заполнены';
  }
  studies.forEach(study => {
    const row = body.insertRow();
    const title = study.querySelector('h3')?.textContent.trim().replace(/\s*\*$/, '') || 'Исследование ВСЭ';
    [title, '1 исследование', money(tariff), money(tariff)].forEach(value => {
      row.insertCell().textContent = value;
    });
  });
  total.textContent = money(studies.length * tariff);
}
