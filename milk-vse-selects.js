(() => {
  const instances = new WeakMap();

  const choicesFromNative = select => [...select.options]
    .filter(option => !option.hidden)
    .map(option => ({
      value: option.value,
      label: option.textContent,
      selected: option.selected,
      disabled: option.disabled
    }));

  function enhance(target) {
    const selects = target instanceof HTMLSelectElement
      ? [target]
      : [...target.querySelectorAll('select[data-library-select]')];

    selects.forEach(select => {
      if (instances.has(select) || typeof globalThis.Choices !== 'function') return;
      const instance = new globalThis.Choices(select, {
        searchEnabled: false,
        shouldSort: false,
        allowHTML: false,
        itemSelectText: '',
        placeholder: true,
        position: 'auto'
      });
      instances.set(select, instance);
      if (select.disabled) instance.disable();
    });
  }

  function refresh(select) {
    const instance = instances.get(select);
    if (!instance) return;
    const value = select.value;
    const choices = choicesFromNative(select).map(choice => ({
      ...choice,
      selected: choice.value === value
    }));
    instance.setChoices(choices, 'value', 'label', true, false, true);
    if (value) instance.setChoiceByValue(value);
    if (select.disabled) instance.disable();
    else instance.enable();
  }

  function sync(target) {
    target.querySelectorAll('select[data-library-select]').forEach(select => {
      const instance = instances.get(select);
      if (instance && select.value) instance.setChoiceByValue(select.value);
    });
  }

  function focus(select) {
    const instance = instances.get(select);
    const container = select.closest('.choices');
    if (!instance || !container) return false;
    container.classList.add('is-invalid');
    container.focus();
    return true;
  }

  document.addEventListener('change', event => {
    const select = event.target.closest?.('select[data-library-select]');
    if (!select) return;
    select.closest('.choices')?.classList.remove('is-invalid');
  });

  globalThis.MilkVseSelects = { enhance, refresh, sync, focus };
})();
