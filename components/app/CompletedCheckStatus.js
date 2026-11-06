(() => {
  const ui = globalThis.VseApp ||= {};

  const tones = {
    cargo: {
      positive: new Set(['Соответствует требованиям']),
      negative: new Set(['Есть загрязнения и повреждения', 'Есть загрязнения или повреждения']),
    },
    combined: {
      positive: new Set(['Нет', 'Да, грузы разделены']),
      negative: new Set(['Да, разделение не обеспечено']),
    },
  };

  ui.getCompletedTransportStatusTone = (kind, value) => {
    const rule = tones[kind];
    const normalized = String(value || '').trim();
    if (rule?.positive.has(normalized)) return 'positive';
    if (rule?.negative.has(normalized)) return 'negative';
    return 'neutral';
  };

  ui.applyCompletedTransportStatuses = (root = document) => {
    root.querySelectorAll('[data-completed-status]').forEach(card => {
      const value = card.querySelector('.mercury-value')?.textContent;
      const tone = ui.getCompletedTransportStatusTone(card.dataset.completedStatus, value);
      card.classList.toggle('is-positive', tone === 'positive');
      card.classList.toggle('is-negative', tone === 'negative');
      card.dataset.statusTone = tone;
    });
  };
})();
