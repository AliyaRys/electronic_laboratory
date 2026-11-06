(function () {
  const definitions = [
    { key: 'consistency', title: 'Консистенция', type: 'choice', primary: true, options: [['ok', 'Соответствует'], ['bad', 'Не соответствует']] },
    { key: 'taste', title: 'Вкус и запах', type: 'choice', primary: true, options: [['ok', 'Соответствует'], ['bad', 'Не соответствует']] },
    { key: 'color', title: 'Цвет', type: 'choice', primary: true, options: [['ok', 'Соответствует'], ['bad', 'Не соответствует']] },
    { key: 'temperature', title: 'Температура, °C', type: 'number', step: '0.1', placeholder: 'Например, 4,0' },
    { key: 'fat', title: 'Массовая доля жира, %', type: 'number', step: '0.1', placeholder: 'Например, 3,6' },
    { key: 'protein', title: 'Массовая доля белка, %', type: 'number', step: '0.1', placeholder: 'Например, 3,2' },
    { key: 'density', title: 'Плотность, кг/м³', type: 'number', step: '0.1', placeholder: 'Например, 1028' },
    { key: 'acidity', title: 'Кислотность, °Т', type: 'number', step: '0.1', placeholder: 'Например, 17' },
    { key: 'somo', title: 'Сухой обезжиренный молочный остаток (СОМО), %', type: 'number', step: '0.1', placeholder: 'Например, 8,6' },
    { key: 'somatic', title: 'Соматические клетки, тыс./см³', type: 'number', step: '1', placeholder: 'Например, 240' },
    { key: 'brucellosis', title: 'Кольцевая реакция на бруцеллёз', type: 'select', options: [['negative', 'Отрицательная'], ['doubtful', 'Сомнительная'], ['positive', 'Положительная']] },
    { key: 'antibiotics', title: 'Содержание потенциально опасных веществ (антибиотиков)', type: 'select', options: [['none', 'Не обнаружено'], ['found', 'Обнаружено']] }
  ];

  const partTitle = (party, index) => `${party.partLabel} ${index + 1} · ${party.parts[index]}`;
  const optionText = (definition, value) => definition.options?.find(option => option[0] === value)?.[1] || value;

  function createBatch(definition) {
    if (!definition.options?.length) return null;
    const batch = document.createElement('div');
    batch.className = 'batch-apply';
    const label = document.createElement('span');
    label.textContent = 'Вся партия';
    const actions = document.createElement('div');
    actions.className = 'batch-actions';
    definition.options.forEach(([value, text]) => {
      const button = document.createElement('button');
      button.className = 'batch-action';
      button.type = 'button';
      button.dataset.apply = definition.key;
      button.dataset.value = value;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = text;
      actions.append(button);
    });
    batch.append(label, actions);
    return batch;
  }

  function createControl(definition, index) {
    if (definition.type === 'choice') {
      const group = document.createElement('div');
      group.className = 'radio-group';
      definition.options.forEach(([value, text], optionIndex) => {
        const label = document.createElement('label');
        label.className = 'radio';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `${definition.key}-${index + 1}`;
        input.value = value;
        input.required = optionIndex === 0;
        const caption = document.createElement('span');
        caption.textContent = text;
        label.append(input, caption);
        group.append(label);
      });
      return group;
    }
    if (definition.type === 'select') {
      const select = document.createElement('select');
      select.dataset.librarySelect = '';
      select.name = `${definition.key}-${index + 1}`;
      select.setAttribute('aria-label', `${definition.title}, ${index + 1}`);
      select.required = true;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Выберите значение';
      placeholder.disabled = true;
      placeholder.selected = true;
      select.append(placeholder);
      definition.options.forEach(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.append(option);
      });
      return select;
    }
    const input = document.createElement('input');
    input.type = 'number';
    input.name = `${definition.key}-${index + 1}`;
    input.step = definition.step || 'any';
    input.required = true;
    input.placeholder = definition.placeholder || '';
    input.setAttribute('aria-label', `${definition.title}, ${index + 1}`);
    return input;
  }

  function syncBatch(card) {
    const buttons = [...card.querySelectorAll('.batch-action')];
    if (!buttons.length) return;
    const controls = [...card.querySelectorAll('.part-row input:checked, .part-row select')];
    const values = controls.map(control => control.value);
    const shared = values.length && values.every(value => value === values[0]) ? values[0] : '';
    buttons.forEach(button => {
      const active = button.dataset.value === shared;
      button.classList.toggle('active', active);
      button.classList.toggle('ok', active && !['bad', 'positive', 'found'].includes(shared));
      button.classList.toggle('bad', active && ['bad', 'positive', 'found'].includes(shared));
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderEditor(container, party) {
    container.replaceChildren();
    definitions.forEach(definition => {
      const card = document.createElement('article');
      const singlePart = party.parts.length === 1;
      card.className = `study-card research full-card${definition.primary ? ' primary compact-primary' : ''}${singlePart ? ' single-part' : ''}`;
      card.dataset.researchKey = definition.key;
      const header = document.createElement('header');
      const title = document.createElement('h3');
      title.innerHTML = `${definition.title} <span class="req">*</span>`;
      header.append(title);
      card.append(header);
      const batch = singlePart ? null : createBatch(definition);
      if (batch) card.append(batch);
      const rows = document.createElement('div');
      rows.className = 'part-research';
      party.parts.forEach((amount, index) => {
        const row = document.createElement('div');
        row.className = 'part-row';
        row.dataset.part = partTitle(party, index);
        const part = document.createElement('div');
        part.className = 'part-label';
        const strong = document.createElement('strong');
        strong.textContent = partTitle(party, index);
        part.append(strong);
        row.append(part, createControl(definition, index));
        rows.append(row);
      });
      card.append(rows);
      card.addEventListener('change', () => syncBatch(card));
      card.querySelectorAll('.batch-action').forEach(button => button.addEventListener('click', () => {
        card.querySelectorAll('.part-row').forEach(row => {
          const radio = row.querySelector(`input[type="radio"][value="${button.dataset.value}"]`);
          const select = row.querySelector('select');
          if (radio) radio.checked = true;
          if (select) select.value = button.dataset.value;
        });
        syncBatch(card);
        card.dispatchEvent(new Event('change', { bubbles: true }));
        globalThis.MilkVseSelects?.sync(card);
      }));
      syncBatch(card);
      container.append(card);
    });
  }

  function collect(container) {
    return definitions.map(definition => {
      const card = container.querySelector(`[data-research-key="${definition.key}"]`);
      const values = [...card.querySelectorAll('.part-row')].map(row => {
        const control = row.querySelector('input[type="radio"]:checked, input[type="number"], select');
        return control?.value || '';
      });
      return { key: definition.key, values };
    });
  }

  function appendToParams(params, research) {
    params.set('milkResearch', JSON.stringify(research));
    return params;
  }

  function fromParams(params = new URLSearchParams(location.search)) {
    const raw = params.get('milkResearch');
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function defaults(party) {
    const values = {
      consistency: ['ok', 'Соответствует'], taste: ['ok', 'Соответствует'], color: ['ok', 'Соответствует'],
      temperature: ['4,0', '4,0'], fat: ['3,6', '3,6'], protein: ['3,2', '3,2'], density: ['1028', '1028'],
      acidity: ['17', '17'], somo: ['8,6', '8,6'], somatic: ['240', '240'],
      brucellosis: ['negative', 'Отрицательная'], antibiotics: ['none', 'Не обнаружено']
    };
    return definitions.map(definition => ({ key: definition.key, values: party.parts.map(() => values[definition.key][0]) }));
  }

  function renderSaved(container, party, research) {
    const source = research.length ? research : defaults(party);
    container.replaceChildren();
    source.forEach(study => {
      const definition = definitions.find(item => item.key === study.key);
      if (!definition) return;
      const card = document.createElement('article');
      card.className = `saved-research-card full-card${definition.type === 'choice' ? ' compact-primary' : ''}${party.parts.length === 1 ? ' single-part' : ''}`;
      const header = document.createElement('header');
      const title = document.createElement('h3');
      title.textContent = study.title || definition.title;
      header.append(title);
      const rows = document.createElement('div');
      rows.className = 'part-research';
      study.values.forEach((value, index) => {
        const rawValue = typeof value === 'object' ? value.value : value;
        const displayValue = typeof value === 'object' ? (value.display || value.value) : optionText(definition, value);
        const row = document.createElement('div');
        row.className = 'part-row';
        const part = document.createElement('div');
        part.className = 'part-label';
        const strong = document.createElement('strong');
        strong.textContent = typeof value === 'object' && value.part ? value.part : partTitle(party, index);
        part.append(strong);
        let result;
        if (definition.type === 'choice') {
          result = document.createElement('div');
          result.className = 'saved-choice-group';
          definition.options.forEach(([optionValue, optionLabel]) => {
            const choice = document.createElement('span');
            choice.className = `saved-choice ${optionValue}${optionValue === rawValue ? ' active' : ''}`;
            choice.setAttribute('role', 'img');
            choice.setAttribute('aria-label', `${optionLabel}${optionValue === rawValue ? ', выбрано' : ''}`);
            choice.title = optionLabel;
            result.append(choice);
          });
        } else {
          result = document.createElement('div');
          result.className = 'saved-research-value';
          result.textContent = displayValue || rawValue || '—';
        }
        row.append(part, result);
        rows.append(row);
      });
      card.append(header, rows);
      container.append(card);
    });
  }

  window.MilkSectionResearch = { definitions, renderEditor, collect, appendToParams, fromParams, defaults, renderSaved };
})();
