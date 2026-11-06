(() => {
  const dialog = document.getElementById('milk-summary');
  if (!dialog) return;
  const title = document.getElementById('milk-summary-title');
  const fields = document.getElementById('milk-summary-fields');
  const link = document.getElementById('milk-summary-link');
  const stage = document.body.dataset.milkStage;
  let lastTrigger;
  function displayDate(value) {
    return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)} ${value.slice(11, 16)}` : '—';
  }
  const escape = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  function field(label, value, wide = false) {
    return `<div${wide ? ' class="wide"' : ''}><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
  }
  document.querySelectorAll('[data-milk-summary]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.noSummary !== undefined) return;
    if (button.dataset.vseCardHref) {
      window.location.href = button.dataset.vseCardHref;
      return;
    }
    const data = button.closest('[data-vse-number]').dataset;
    lastTrigger = button;
    title.textContent = stage === 'expected' ? 'Сведения о поступлении' : stage === 'work' ? 'Партия в работе' : `ВСЭ №${data.vseNumber} — сводка`;
    let content = field('Хозяйство', data.owner, true) + field('Продукция', data.product, true) + field('Номер ВСД', data.number, true) + field('Состав партии', data.composition) + field(data.unit === 'kg' ? 'Общая масса' : 'Общий объём', data.amount);
    if (stage === 'accepted') {
      content += field('Результат ВСЭ', data.result, true) + field('Дата и время ВСЭ', data.vseDate) + field('Специалист', data.author) + field('Лаборатория', 'Лаборатория ВСЭ №1 г. Казань', true);
    } else {
      content += field(stage === 'work' ? 'Дата поступления' : 'Дата создания ВСД', displayDate(data.date)) + field('Транспорт', data.vehicle);
      if (stage === 'work') content += field('Состояние', 'Сверка пройдена. Ожидает ВСЭ.', true);
    }
    fields.innerHTML = content;
    const isMeat = document.documentElement.dataset.productType === 'meat';
    link.href = stage === 'expected'
      ? (isMeat ? 'arrivals-work.html' : 'arrivals-work-milk.html')
      : (isMeat ? 'journal.html' : 'journal-milk.html');
    link.textContent = stage === 'expected' ? 'Перейти к партиям в работе' : 'Открыть журнал ВСЭ';
    dialog.showModal();
  }));
  dialog.querySelectorAll('[data-close-milk-summary]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => lastTrigger?.focus());
})();
