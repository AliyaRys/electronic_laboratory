(() => {
  const ui = globalThis.VseApp ||= {};

  /** Read-only label/value pair for detail and summary screens. */
  ui.createInfoField = ({ label = 'Поле', value = '—', wide = false } = {}) => {
    const field = document.createElement('div');
    field.className = `vse-app app-info-field${wide ? ' wide' : ''}`;
    const caption = document.createElement('div');
    caption.className = 'app-info-label';
    caption.textContent = label;
    const content = document.createElement('div');
    content.className = 'app-info-value';
    content.textContent = value || '—';
    field.append(caption, content);
    return field;
  };
})();
