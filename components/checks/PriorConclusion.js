(() => {
  const api = globalThis.VsePriorConclusion ||= {};

  api.create = ({ text = '', open = false } = {}) => {
    const details = document.createElement('details');
    details.className = 'prior-conclusion';
    details.open = open;

    const summary = document.createElement('summary');
    const label = document.createElement('span');
    label.className = 'prior-conclusion-label';
    label.textContent = 'Заключение';
    const preview = document.createElement('span');
    preview.className = 'prior-conclusion-preview';
    preview.textContent = text;
    const chevron = document.createElement('span');
    chevron.className = 'prior-conclusion-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(label, preview, chevron);

    const body = document.createElement('div');
    body.className = 'prior-conclusion-body';
    body.textContent = text;
    details.append(summary, body);
    return details;
  };

  api.mountAll = (root = document) => {
    root.querySelectorAll('[data-prior-conclusion]').forEach(slot => {
      if (slot.dataset.priorConclusionMounted === 'true') return;
      slot.dataset.priorConclusionMounted = 'true';
      slot.replaceWith(api.create({ text: slot.dataset.text || '', open: slot.hasAttribute('data-open') }));
    });
  };

  api.mountAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => api.mountAll());
})();
