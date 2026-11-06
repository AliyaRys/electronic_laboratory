(function () {
  const MAX_ROWS = 10;
  const definitions = [
    {
      key: 'infectious',
      title: 'Инфекционные болезни',
      addLabel: 'Добавить инфекционные болезни',
      otherValue: 'other',
      otherLabel: 'Другое инфекционное заболевание',
      options: ['Ящур', 'Сибирская язва', 'Туберкулёз', 'Бруцеллёз', 'Лейкоз', 'Оспа', 'Болезнь Ауески', 'Классическая чума свиней', 'Сальмонеллёз']
    },
    {
      key: 'noninfectious',
      title: 'Незаразные болезни',
      addLabel: 'Добавить незаразные болезни',
      otherValue: 'other',
      otherLabel: 'другое незаразное заболевание',
      options: ['бронхит', 'пневмония', 'бронхопневмония', 'плеврит', 'плевропневмония', 'перикардит', 'миокардит', 'эндокардит', 'цирроз печени', 'капиллярная эктазия печени', 'жировая дистрофия печени', 'нефрит', 'нефроз', 'эндометрит', 'параметрит', 'мастит', 'тимпания', 'гастрит', 'энтерит', 'гастроэнтерит', 'беломышечная болезнь', 'истощение', 'новообразование']
    }
  ];

  const escapeName = value => value.replace(/[^a-z0-9_-]/gi, '');

  function focusSelect(select) {
    const choices = select.closest('.choices');
    if (choices) choices.focus();
    else select.focus();
  }

  function notifyChange(card) {
    card.dispatchEvent(new Event('input', { bubbles: true }));
    card.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function createSelect(definition, index) {
    const select = document.createElement('select');
    select.id = `${definition.key}-disease-${index}`;
    select.name = `${definition.key}Disease[]`;
    select.dataset.librarySelect = '';
    select.setAttribute('aria-label', `${definition.title}: заболевание ${index}`);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Выберите заболевание';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    definition.options.forEach(label => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.append(option);
    });
    const other = document.createElement('option');
    other.value = definition.otherValue;
    other.textContent = definition.otherLabel;
    select.append(other);
    return select;
  }

  function createRow(card, definition, index) {
    const row = document.createElement('div');
    row.className = 'disease-research-row';
    row.dataset.diseaseRow = '';

    const selectField = document.createElement('div');
    selectField.className = 'disease-research-field';
    const label = document.createElement('label');
    label.htmlFor = `${definition.key}-disease-${index}`;
    label.textContent = 'Наименование болезни';
    const select = createSelect(definition, index);
    select.required = card.classList.contains('visible');
    selectField.append(label, select);

    const otherField = document.createElement('div');
    otherField.className = 'disease-research-field disease-research-other';
    otherField.hidden = true;
    const otherId = `${definition.key}-other-${index}`;
    const otherLabel = document.createElement('label');
    otherLabel.htmlFor = otherId;
    otherLabel.textContent = 'Укажите заболевание';
    const input = document.createElement('input');
    input.id = otherId;
    input.name = `${definition.key}Other[]`;
    input.placeholder = 'Введите наименование заболевания';
    input.autocomplete = 'off';
    otherField.append(otherLabel, input);

    const remove = document.createElement('button');
    remove.className = 'disease-row-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить заболевание ${index}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      row.remove();
      updateRows(card, definition);
      notifyChange(card);
    });

    select.addEventListener('change', () => {
      const showOther = select.value === definition.otherValue;
      row.classList.toggle('has-other', showOther);
      otherField.hidden = !showOther;
      input.required = showOther;
      if (!showOther) input.value = '';
      card.classList.toggle('has-custom-disease', [...card.querySelectorAll('select')].some(control => control.value === definition.otherValue));
      notifyChange(card);
      if (showOther) input.focus();
    });
    row.append(selectField, otherField, remove);
    return row;
  }

  function updateRows(card, definition) {
    const rows = [...card.querySelectorAll('[data-disease-row]')];
    const add = card.querySelector('[data-add-disease-row]');
    rows.forEach((row, index) => {
      row.querySelector('.disease-row-remove').hidden = rows.length === 1;
      row.querySelector('.disease-row-remove').setAttribute('aria-label', `Удалить заболевание ${index + 1}`);
    });
    add.disabled = rows.length >= MAX_ROWS;
    add.setAttribute('aria-disabled', String(rows.length >= MAX_ROWS));
    card.querySelector('[data-disease-limit]').hidden = rows.length < MAX_ROWS;
    globalThis.MilkVseSelects?.enhance(card);
  }

  function resetCard(card, definition) {
    const list = card.querySelector('[data-disease-list]');
    list.replaceChildren(createRow(card, definition, 1));
    card.dataset.nextDiseaseIndex = '1';
    card.classList.remove('has-custom-disease');
    updateRows(card, definition);
  }

  function createCard(definition) {
    const card = document.createElement('article');
    card.className = 'research study-card optional-test full-card disease-research-card';
    card.id = `disease-${escapeName(definition.key)}`;
    card.dataset.diseaseResearch = definition.key;
    card.dataset.nextDiseaseIndex = '1';

    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.textContent = definition.title;
    const remove = document.createElement('button');
    remove.className = 'remove-test';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Удалить исследование «${definition.title}»`);
    remove.textContent = '×';
    header.append(title, remove);

    const list = document.createElement('div');
    list.className = 'disease-research-list';
    list.dataset.diseaseList = '';
    list.append(createRow(card, definition, 1));

    const footer = document.createElement('div');
    footer.className = 'disease-research-footer';
    const add = document.createElement('button');
    add.className = 'disease-row-add';
    add.type = 'button';
    add.dataset.addDiseaseRow = '';
    add.textContent = '＋ Добавить заболевание';
    const limit = document.createElement('span');
    limit.dataset.diseaseLimit = '';
    limit.hidden = true;
    limit.textContent = 'Добавлено максимальное количество — 10';
    footer.append(add, limit);
    card.append(header, list, footer);

    add.addEventListener('click', () => {
      const count = list.querySelectorAll('[data-disease-row]').length;
      if (count >= MAX_ROWS) return;
      const nextIndex = Number(card.dataset.nextDiseaseIndex || 1) + 1;
      card.dataset.nextDiseaseIndex = String(nextIndex);
      const row = createRow(card, definition, nextIndex);
      list.append(row);
      updateRows(card, definition);
      const select = row.querySelector('select');
      focusSelect(select);
      notifyChange(card);
    });
    updateRows(card, definition);
    return card;
  }

  function createAddButton(definition, card, list) {
    const button = document.createElement('button');
    button.className = 'add-test';
    button.type = 'button';
    button.dataset.target = card.id;
    button.textContent = `＋ ${definition.addLabel}`;
    button.addEventListener('click', () => {
      list.append(card);
      card.classList.add('visible');
      card.querySelectorAll('select').forEach(select => { select.required = true; });
      button.hidden = true;
      const select = card.querySelector('select');
      focusSelect(select);
      notifyChange(card);
    });
    card.querySelector('.remove-test').addEventListener('click', () => {
      card.classList.remove('visible');
      button.hidden = false;
      resetCard(card, definition);
      button.focus();
      notifyChange(card);
    });
    return button;
  }

  function mount(root = document) {
    const milkGrid = root.getElementById?.('milk-research-grid');
    let addRow = root.querySelector?.('.add-row[aria-label="Дополнительные исследования"]');
    let list = root.getElementById?.('optional-research-list') || addRow?.previousElementSibling || milkGrid;
    if (!list) return null;
    if (!addRow) {
      addRow = document.createElement('div');
      addRow.className = 'add-row disease-research-actions';
      addRow.setAttribute('aria-label', 'Дополнительные исследования');
      list.after(addRow);
    }
    if (addRow.dataset.diseaseResearchMounted === 'true') return list;
    addRow.dataset.diseaseResearchMounted = 'true';
    const excluded = new Set((addRow.dataset.diseaseExclude || '').split(',').map(value => value.trim()).filter(Boolean));
    definitions.filter(definition => !excluded.has(definition.key)).forEach(definition => {
      const card = createCard(definition);
      list.append(card);
      addRow.append(createAddButton(definition, card, list));
    });
    return list;
  }

  function collect(root = document) {
    return definitions.map(definition => {
      const card = root.querySelector(`[data-disease-research="${definition.key}"]`);
      if (!card?.classList.contains('visible')) return { key: definition.key, values: [] };
      const values = [...card.querySelectorAll('[data-disease-row]')].map(row => ({
        value: row.querySelector('select')?.value || '',
        other: row.querySelector('input')?.value.trim() || ''
      })).filter(item => item.value);
      return { key: definition.key, values };
    });
  }

  globalThis.VseDiseaseResearch = { definitions, mount, collect, maxRows: MAX_ROWS };
  if (document.readyState === 'complete') mount(document);
  else document.addEventListener('DOMContentLoaded', () => mount(document), { once: true });
})();
