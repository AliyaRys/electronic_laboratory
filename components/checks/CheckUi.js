(() => {
  const ui = globalThis.VseCheck ||= {};
  const iconLibrary = globalThis.VseIcons;
  let sequence = 0;

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const createSectionIcon = section => {
    if (!iconLibrary) throw new Error('VseIcons должен быть подключён перед CheckUi.js');
    const wrapper = create('span', 'section-icon');
    wrapper.append(iconLibrary.createCheckSection(section));
    return wrapper;
  };

  const createStateIcon = state => iconLibrary.create(state === 'ok' ? 'comparison-match' : 'comparison-mismatch');

  ui.createSectionHeader = ({ title, description = '', section = 'document', price = '' }) => {
    const header = create('div', 'section-head');
    const titleGroup = create('div', 'section-title');
    const copy = create('div');
    copy.append(create('h2', '', title));
    if (description) copy.append(create('p', '', description));
    titleGroup.append(createSectionIcon(section), copy);
    header.append(titleGroup);
    if (price) {
      const priceNode = create('div', 'section-price');
      priceNode.append(create('strong', '', price), create('small', '', 'за сверку'));
      header.append(priceNode);
    }
    return header;
  };

  ui.createComparisonActions = ({ label = 'Поле', state = '', disabled = false } = {}) => {
    const fragment = document.createDocumentFragment();
    ['ok', 'bad'].forEach(value => {
      const button = create('button', `check-button ${value}${state === value ? ' active' : ''}`);
      button.type = 'button';
      button.dataset.state = value;
      button.setAttribute('aria-label', `${label} ${value === 'ok' ? 'соответствует' : 'не соответствует'}`);
      button.setAttribute('aria-pressed', String(state === value));
      button.disabled = disabled;
      button.append(createStateIcon(value));
      fragment.append(button);
    });
    return fragment;
  };

  ui.setComparisonState = (row, state, { focusFact = false } = {}) => {
    if (!row || !['ok', 'bad', ''].includes(state)) return;
    row.dataset.state = state;
    row.classList.toggle('match', state === 'ok');
    row.classList.toggle('mismatch', state === 'bad');
    if (state === 'bad') row.classList.remove('fact-collapsed');
    row.querySelectorAll('.check-button').forEach(button => {
      const active = button.dataset.state === state;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const factFields = [...row.querySelectorAll('.fact-field input, .fact-field textarea, .fact-field select')];
    factFields.forEach(field => {
      field.required = state === 'bad';
      if (state !== 'bad') {
        field.removeAttribute('aria-invalid');
        const error = field.id && row.querySelector(`#${CSS.escape(field.id)}-error`);
        if (error) error.hidden = true;
      }
    });
    if (focusFact && state === 'bad') factFields[0]?.focus();
  };

  ui.bindComparisonField = row => {
    if (!row || row.dataset.checkUiBound === 'true') return row;
    row.dataset.checkUiBound = 'true';
    row.querySelectorAll('.check-button').forEach(button => button.addEventListener('click', () => {
      ui.setComparisonState(row, button.dataset.state, { focusFact: true });
      row.dispatchEvent(new CustomEvent('vse-check-change', { bubbles: true, detail: { state: button.dataset.state } }));
    }));
    return row;
  };

  ui.createComparisonField = ({ label, value, key = '', state = '', reference = false, factValue = '', factPlaceholder = 'Укажите фактическое значение', factType = 'text', factOptions = [], mismatchReason = false, reasonValue = '', reasonPlaceholder = 'Опишите причину несоответствия', disabled = false, error = '' }) => {
    const id = `check-fact-${++sequence}`;
    const row = create('div', `compare-row${reference ? ' reference' : ''}`);
    if (key) row.dataset.check = key;
    row.append(create('div', 'field-name', label), create('div', 'mercury-value', value));
    if (!reference) {
      row.append(ui.createComparisonActions({ label, state, disabled }));
      const fact = create('div', 'fact-field');
      const fieldLabel = create('label', '', 'Фактическое значение');
      fieldLabel.htmlFor = id;
      const input = create(factOptions.length ? 'select' : factType === 'textarea' ? 'textarea' : 'input');
      input.id = id;
      if (!factOptions.length && factType !== 'textarea') input.type = factType;
      if (factOptions.length) {
        const placeholder = create('option', '', factPlaceholder);
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.hidden = true;
        placeholder.selected = !factValue;
        input.append(placeholder);
        factOptions.forEach(item => {
          const option = create('option', '', typeof item === 'string' ? item : item.label);
          option.value = typeof item === 'string' ? item : item.value;
          option.selected = option.value === factValue;
          input.append(option);
        });
      } else {
        input.placeholder = factPlaceholder;
        input.value = factValue;
      }
      input.disabled = disabled;
      if (error) {
        const errorId = `${id}-error`;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
        const errorNode = create('div', 'field-error', error);
        errorNode.id = errorId;
        errorNode.setAttribute('role', 'alert');
        fact.append(fieldLabel, input, errorNode);
      } else {
        fact.append(fieldLabel, input);
      }
      if (mismatchReason) {
        const reasonId = `${id}-reason`;
        const reasonLabel = create('label', '', 'Причина несоответствия');
        reasonLabel.htmlFor = reasonId;
        const reasonInput = create('input', 'mismatch-reason-input');
        reasonInput.id = reasonId;
        reasonInput.type = 'text';
        reasonInput.placeholder = reasonPlaceholder;
        reasonInput.value = reasonValue;
        reasonInput.disabled = disabled;
        fact.append(reasonLabel, reasonInput);
      }
      row.append(fact);
      ui.bindComparisonField(row);
      ui.setComparisonState(row, state);
    }
    return row;
  };

  ui.createProductTaxonomyFields = ({
    type = 'Мясо и мясопродукты',
    product = '',
    kind = '',
    name = '',
    state = '',
    nameMismatchReason = false,
    disabled = false
  } = {}) => {
    const fragment = document.createDocumentFragment();
    [
      ['Тип продукции', type, 'productType', 'Укажите фактический тип продукции', false],
      ['Продукция', product, 'product', 'Укажите фактическую продукцию', false],
      ['Вид продукции', kind, 'productKind', 'Укажите фактический вид продукции', false],
      ['Название продукции', name, 'productName', 'Укажите фактическое название продукции', nameMismatchReason]
    ].forEach(([label, value, key, factPlaceholder, mismatchReason]) => fragment.append(ui.createComparisonField({
      label,
      value,
      key,
      state,
      disabled,
      factPlaceholder,
      mismatchReason
    })));
    return fragment;
  };

  ui.mountProductTaxonomies = (root = document) => {
    root.querySelectorAll('[data-product-taxonomy]').forEach(slot => {
      if (slot.dataset.checkUiMounted === 'true') return;
      slot.dataset.checkUiMounted = 'true';
      slot.replaceWith(ui.createProductTaxonomyFields({
        type: slot.dataset.productType || 'Мясо и мясопродукты',
        product: slot.dataset.product || '',
        kind: slot.dataset.productKind || '',
        name: slot.dataset.productName || '',
        state: slot.dataset.state || '',
        nameMismatchReason: slot.hasAttribute('data-name-mismatch-reason'),
        disabled: slot.hasAttribute('data-disabled')
      }));
    });
  };

  ui.appendMismatchReason = (row, { placeholder = 'Опишите причину несоответствия' } = {}) => {
    const fact = row?.querySelector('.fact-field');
    if (!fact || fact.querySelector('.mismatch-reason-input')) return row;
    const baseInput = fact.querySelector('input, textarea, select');
    const reasonId = `${baseInput?.id || `check-reason-${++sequence}`}-reason`;
    const label = create('label', '', 'Причина несоответствия');
    label.htmlFor = reasonId;
    const input = create('input', 'mismatch-reason-input');
    input.id = reasonId;
    input.type = 'text';
    input.placeholder = placeholder;
    const actions = fact.querySelector('.fact-actions');
    fact.insertBefore(label, actions);
    fact.insertBefore(input, actions);
    return row;
  };

  ui.mountMismatchReasons = (root = document) => {
    root.querySelectorAll('[data-mismatch-reason]').forEach(row => ui.appendMismatchReason(row, {
      placeholder: row.dataset.mismatchReason || 'Опишите причину несоответствия'
    }));
    root.querySelectorAll('[data-mismatch-reason-fields]').forEach(container => {
      const labels = new Set(container.dataset.mismatchReasonFields.split('|').map(value => value.trim()).filter(Boolean));
      container.querySelectorAll('.compare-row').forEach(row => {
        const label = row.querySelector('.field-name')?.textContent.trim();
        if (labels.has(label)) ui.appendMismatchReason(row);
      });
    });
  };

  ui.validateMismatchDetails = (root = document) => {
    let firstInvalid = null;
    root.querySelectorAll('.compare-row.mismatch .fact-field input[required], .compare-row.mismatch .fact-field textarea[required], .compare-row.mismatch .fact-field select[required]').forEach(field => {
      const invalid = !field.value.trim();
      field.toggleAttribute('aria-invalid', invalid);
      let error = field.id && root.querySelector(`#${CSS.escape(field.id)}-error`);
      if (!error && field.id) {
        error = create('div', 'field-error');
        error.id = `${field.id}-error`;
        error.setAttribute('role', 'alert');
        field.insertAdjacentElement('afterend', error);
        const describedBy = [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' ');
        field.setAttribute('aria-describedby', describedBy);
        field.addEventListener('input', () => {
          if (!field.value.trim()) return;
          field.removeAttribute('aria-invalid');
          error.hidden = true;
        });
      }
      if (error) {
        error.textContent = field.classList.contains('mismatch-reason-input')
          ? 'Укажите причину несоответствия.'
          : 'Укажите фактическое значение.';
        error.hidden = !invalid;
      }
      if (invalid && !firstInvalid) firstInvalid = field;
    });
    firstInvalid?.focus();
    return !firstInvalid;
  };

  ui.createCompositionTable = ({ label = 'Состав партии', columns, rows }) => {
    const table = create('div', 'parts-table');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', label);
    const head = create('div', 'parts-row parts-head');
    head.setAttribute('role', 'row');
    columns.forEach(column => {
      const cell = create('div', '', column);
      cell.setAttribute('role', 'columnheader');
      head.append(cell);
    });
    table.append(head);
    rows.forEach(values => {
      const row = create('div', 'parts-row');
      row.setAttribute('role', 'row');
      values.forEach(value => {
        const cell = create('div', '', value);
        cell.setAttribute('role', 'cell');
        row.append(cell);
      });
      table.append(row);
    });
    table.style.setProperty('--parts-columns', columns.length);
    return table;
  };

  const positiveValues = new Set(['Соответствует требованиям', 'Нет', 'Да, грузы разделены']);
  const negativeValues = new Set(['Есть загрязнения или повреждения', 'Есть загрязнения и повреждения', 'Да, разделение не обеспечено']);

  ui.syncTransportObservation = observation => {
    const select = observation?.querySelector('select');
    if (!select) return 'neutral';
    const value = select.value.trim();
    const tone = positiveValues.has(value) ? 'positive' : negativeValues.has(value) ? 'negative' : 'neutral';
    observation.classList.toggle('selected', tone !== 'neutral');
    observation.classList.toggle('is-positive', tone === 'positive');
    observation.classList.toggle('is-negative', tone === 'negative');
    observation.dataset.statusTone = tone;
    return tone;
  };

  ui.bindTransportObservation = observation => {
    if (!observation || observation.dataset.checkUiBound === 'true') return observation;
    observation.dataset.checkUiBound = 'true';
    const select = observation.querySelector('select');
    select?.addEventListener('change', () => ui.syncTransportObservation(observation));
    ui.syncTransportObservation(observation);
    return observation;
  };

  ui.createTransportObservation = ({ label, options, value = '', id = `transport-${++sequence}`, disabled = false }) => {
    const observation = create('div', 'transport-observation');
    const fieldLabel = create('label', '', label);
    fieldLabel.htmlFor = id;
    const select = create('select');
    select.id = id;
    select.required = true;
    select.disabled = disabled;
    const placeholder = create('option', '', 'Выберите значение');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.hidden = true;
    placeholder.selected = !value;
    select.append(placeholder);
    options.forEach(optionValue => {
      const option = create('option', '', optionValue);
      option.value = optionValue;
      option.selected = optionValue === value;
      select.append(option);
    });
    observation.append(fieldLabel, select);
    return ui.bindTransportObservation(observation);
  };

  ui.setDecisionFieldError = (select, message = '') => {
    const field = select?.closest('.check-decision-field');
    const error = field?.querySelector('.check-decision-error');
    if (!field || !error) return;
    field.classList.toggle('is-invalid', Boolean(message));
    select.toggleAttribute('aria-invalid', Boolean(message));
    error.hidden = !message;
    error.textContent = message;
  };

  ui.bindDecisionField = field => {
    if (!field || field.dataset.checkUiBound === 'true') return field;
    field.dataset.checkUiBound = 'true';
    const select = field.querySelector('select');
    const sync = () => {
      field.classList.toggle('is-selected', Boolean(select?.value));
      ui.setDecisionFieldError(select, '');
    };
    select?.addEventListener('change', sync);
    sync();
    return field;
  };

  ui.createDecisionField = ({
    label,
    description = '',
    options = [],
    value = '',
    id = `check-decision-${++sequence}`,
    name = '',
    required = false,
    disabled = false
  }) => {
    const field = create('div', 'check-decision-field');
    const copy = create('div', 'check-decision-copy');
    const fieldLabel = create('label', '', label);
    fieldLabel.htmlFor = id;
    if (required) {
      const requiredMark = create('span', 'req', ' *');
      requiredMark.setAttribute('aria-hidden', 'true');
      fieldLabel.append(requiredMark);
    }
    copy.append(fieldLabel);
    if (description) copy.append(create('p', '', description));

    const control = create('div', 'check-decision-control');
    const select = create('select');
    select.id = id;
    select.name = name;
    select.required = required;
    select.disabled = disabled;
    const placeholder = create('option', '', 'Выберите решение');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.hidden = true;
    placeholder.selected = !value;
    select.append(placeholder);
    options.forEach(item => {
      const optionValue = typeof item === 'string' ? item : item.value;
      const optionLabel = typeof item === 'string' ? item : item.label;
      const option = create('option', '', optionLabel);
      option.value = optionValue;
      option.selected = optionValue === value;
      select.append(option);
    });
    const error = create('div', 'check-decision-error');
    error.id = `${id}-error`;
    error.hidden = true;
    error.setAttribute('role', 'alert');
    select.setAttribute('aria-describedby', error.id);
    control.append(select, error);
    field.append(copy, control);
    return ui.bindDecisionField(field);
  };

  ui.createTransactionDecision = ({ value = '', type = '', disabled = false } = {}) => {
    const group = create('div', 'check-transaction-group');
    const main = ui.createDecisionField({
      label: 'По партии будет произведена транзакция',
      description: 'Отметьте, оформляется ли по партии транзакция в Меркурии.',
      id: 'transaction-decision',
      name: 'transactionDecision',
      required: true,
      disabled,
      value,
      options: [
        { value: 'yes', label: 'Да' },
        { value: 'no', label: 'Нет' }
      ]
    });
    const typeField = ui.createDecisionField({
      label: 'Тип транзакции',
      description: 'Внутренняя транзакция оформляется внутри хозяйства, внешняя — между хозяйствами.',
      id: 'transaction-type',
      name: 'transactionType',
      required: true,
      disabled,
      value: type,
      options: [
        { value: 'internal', label: 'Внутренняя' },
        { value: 'external', label: 'Внешняя' }
      ]
    });
    group.append(main, typeField);
    return ui.bindTransactionDecision(group, { value, type });
  };

  ui.bindTransactionDecision = (group, { value = '', type = '' } = {}) => {
    if (!group || group.dataset.checkUiBound === 'true') return group;
    group.dataset.checkUiBound = 'true';
    const main = group.querySelector('[name="transactionDecision"]')?.closest('.check-decision-field');
    const typeField = group.querySelector('[name="transactionType"]')?.closest('.check-decision-field');
    const sync = () => {
      const isTransaction = main?.querySelector('select')?.value === 'yes';
      typeField.hidden = !isTransaction;
      if (!isTransaction) {
        const select = typeField?.querySelector('select');
        if (select) select.value = '';
        ui.setDecisionFieldError(typeField?.querySelector('select'), '');
      }
    };
    main?.querySelector('select')?.addEventListener('change', sync);
    sync();
    return group;
  };

  ui.validateTransactionDecision = group => {
    if (!group) return null;
    const mainSelect = group.querySelector('[name="transactionDecision"]');
    if (!mainSelect?.value) {
      ui.setDecisionFieldError(mainSelect, 'Укажите, будет ли произведена транзакция.');
      return { message: 'Укажите, будет ли произведена транзакция.', select: mainSelect };
    }
    const typeSelect = group.querySelector('[name="transactionType"]');
    if (mainSelect.value === 'yes' && !typeSelect?.value) {
      ui.setDecisionFieldError(typeSelect, 'Укажите тип транзакции.');
      return { message: 'Укажите тип транзакции.', select: typeSelect };
    }
    return null;
  };

  ui.createRepeatVseDecision = ({ value = '', disabled = false } = {}) => {
    const group = create('div', 'check-repeat-vse-group');
    const decision = ui.createDecisionField({
      label: 'Необходимость повторного ВСЭ',
      description: 'Решение принимается по результатам осмотра продукции и транспорта.',
      id: 'repeat-vse-decision',
      name: 'repeatVseDecision',
      required: true,
      disabled,
      value,
      options: [
        { value: 'not-required', label: 'Повторная ВСЭ не требуется' },
        { value: 'required', label: 'Требуется повторная ВСЭ' }
      ]
    });
    const makeDetail = (label, name, placeholder) => {
      const field = create('div', 'check-decision-field');
      const copy = create('div', 'check-decision-copy');
      const fieldLabel = create('label', '', label);
      fieldLabel.htmlFor = name;
      const requiredMark = create('span', 'req', ' *');
      requiredMark.setAttribute('aria-hidden', 'true');
      fieldLabel.append(requiredMark);
      copy.append(fieldLabel);
      const control = create('div', 'check-decision-control');
      const input = create('input');
      input.id = name;
      input.name = name;
      input.type = 'text';
      input.placeholder = placeholder;
      input.required = true;
      input.disabled = disabled;
      control.append(input);
      const error = create('div', 'check-decision-error');
      error.id = `${name}-error`;
      error.hidden = true;
      error.setAttribute('role', 'alert');
      input.setAttribute('aria-describedby', error.id);
      field.append(copy, control, error);
      return field;
    };
    group.append(
      decision,
      makeDetail('Основание для проведения повторного ВСЭ', 'repeatVseBasis', 'Например, несоответствие при повторном осмотре продукции'),
      makeDetail('№ акта', 'repeatVseAct', 'Номер акта отбора пробы или акта повторной ВСЭ')
    );
    return ui.bindRepeatVseDetails(group);
  };

  ui.bindRepeatVseDetails = group => {
    if (!group || group.dataset.checkUiBound === 'true') return group;
    group.dataset.checkUiBound = 'true';
    const select = group.querySelector('[name="repeatVseDecision"]');
    const details = [...group.querySelectorAll('[name="repeatVseBasis"], [name="repeatVseAct"]')].map(input => input.closest('.check-decision-field'));
    const sync = () => {
      const isRequired = select?.value === 'required';
      details.forEach(field => { field.hidden = !isRequired; });
      if (!isRequired) {
        group.querySelectorAll('[name="repeatVseBasis"], [name="repeatVseAct"]').forEach(input => {
          input.value = '';
          ui.setDecisionFieldError(input, '');
        });
      }
    };
    select?.addEventListener('change', sync);
    sync();
    return group;
  };

  ui.validateRepeatVseDetails = group => {
    if (!group) return null;
    const select = group.querySelector('[name="repeatVseDecision"]');
    if (select?.value !== 'required') return null;
    const messages = {
      repeatVseBasis: 'Укажите основание для проведения повторного ВСЭ.',
      repeatVseAct: 'Укажите № акта.'
    };
    for (const [name, message] of Object.entries(messages)) {
      const input = group.querySelector(`[name="${name}"]`);
      if (!input.value.trim()) {
        ui.setDecisionFieldError(input, message);
        return { message, input };
      }
      ui.setDecisionFieldError(input, '');
    }
    return null;
  };

  ui.RECEIPT_WEIGHT_TOLERANCE_PERCENT = 5;
  ui.RECEIPT_DECISIONS = [
    { value: 'accept-all', label: 'Полное гашение', submitLabel: 'Погасить эВСД' },
    { value: 'accept-all-report', label: 'Полное гашение с актом', submitLabel: 'Погасить эВСД с актом' },
    { value: 'partial', label: 'Частичное гашение', submitLabel: 'Погасить эВСД частично' },
    { value: 'return-all', label: 'Полный возврат', submitLabel: 'Оформить полный возврат' }
  ];
  ui.RECEIPT_AUTO_ACT_DECISIONS = ui.RECEIPT_DECISIONS.filter(decision => decision.value !== 'accept-all-report');
  ui.RETURN_REASONS = [
    'Некачественный товар', 'Повреждение упаковки', 'Посторонние включения или нарушение безопасности',
    'Несоответствие результатам лабораторных исследований', 'Ошибка в производственном эВСД',
    'Критический срок годности', 'Проблемы с маркировкой', 'Расхождение по количеству',
    'Несоответствие даты выработки', 'Незаказанная продукция', 'Несоответствие спецификации',
    'Отказ отправителя', 'Нарушение условий договора', 'Другая причина'
  ];
  ui.MEAT_RETURN_REASONS = [
    { code: 'DEFECTIVE_GOODS', label: 'Некачественный товар' },
    { code: 'PACKAGING_DAMAGE', label: 'Повреждение упаковки' },
    { code: 'FOREIGN_MATERIAL_OR_SAFETY_VIOLATION', label: 'Посторонние включения или нарушение безопасности' },
    { code: 'LAB_TEST_MISMATCH', label: 'Несоответствие результатам лабораторных исследований' },
    { code: 'PRODUCTION_VSD_ERROR', label: 'Ошибка в производственном эВСД' },
    { code: 'CRITICAL_EXPIRY_DATE', label: 'Критический срок годности' },
    { code: 'MARKING_ISSUES', label: 'Проблемы с маркировкой' },
    { code: 'QUANTITY_DISCREPANCY', label: 'Расхождение по количеству' },
    { code: 'PRODUCT_DATE_MISMATCH', label: 'Несоответствие даты выработки' },
    { code: 'UNORDERED_PRODUCT', label: 'Незаказанная продукция' },
    { code: 'WRONG_SPECIFICATION', label: 'Несоответствие спецификации' },
    { code: 'CONSIGNOR_REJECTION', label: 'Отказ отправителя' },
    { code: 'CONTRACT_VIOLATION', label: 'Нарушение условий договора' },
    { code: 'OTHER_REASON', label: 'Другая причина' }
  ];

  const receiptRowLabel = row => row.querySelector('.field-name')?.textContent.trim() || '';
  const usesAutomaticReceiptAct = form => form?.dataset.receiptAutoAct === 'true';
  const receiptDecisions = form => usesAutomaticReceiptAct(form) ? ui.RECEIPT_AUTO_ACT_DECISIONS : ui.RECEIPT_DECISIONS;
  const receiptNumber = value => {
    const match = String(value || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  };
  const receiptRows = form => [...form.querySelectorAll('.compare-row:not(.reference)')];
  const receiptMismatchDetailsComplete = row => [...row.querySelectorAll('.fact-field input[required], .fact-field textarea[required], .fact-field select[required]')].every(field => field.value.trim());

  ui.evaluateReceiptDecisions = form => {
    const rows = receiptRows(form);
    const observations = [...form.querySelectorAll('.transport-observation select[required]')];
    const comparisonsComplete = rows.length > 0 && rows.every(row => ['ok', 'bad'].includes(row.dataset.state));
    const observationsComplete = observations.every(select => select.value);
    const complete = comparisonsComplete && observationsComplete;
    const mismatchRows = rows.filter(row => row.dataset.state === 'bad');
    const blockingNames = new Set([
      'Отправитель', 'Адрес отправителя', 'Получатель', 'Адрес получателя', 'Хозяйство',
      'Тип продукции', 'Продукция', 'Вид продукции', 'Номенклатура', 'Производитель',
      'Дата выработки', 'Вид транспорта', 'Способ хранения продукции при перевозке'
    ]);
    const actNames = new Set([
      'Тип транспортного документа', 'Серия транспортного документа', 'Номер транспортного документа', 'Дата оформления транспортного документа',
      'Номер ТС', 'Номер прицепа', 'Вес', 'Объём / масса', 'Количество', 'Состав партии', 'Срок годности', 'Название продукции'
    ]);
    const blocking = mismatchRows.filter(row => blockingNames.has(receiptRowLabel(row)));
    const related = mismatchRows.filter(row => receiptRowLabel(row) === 'Связанные документы');
    const actRows = mismatchRows.filter(row => actNames.has(receiptRowLabel(row)));
    let weightWithinTolerance = false;
    let weightDeviation = 0;
    const weightRow = actRows.find(row => ['Вес', 'Объём / масса'].includes(receiptRowLabel(row)));
    if (weightRow) {
      const original = receiptNumber(weightRow.querySelector('.mercury-value')?.textContent);
      const actual = receiptNumber(weightRow.querySelector('.fact-field input, .fact-field textarea, .fact-field select')?.value);
      if (Number.isFinite(original) && original > 0 && Number.isFinite(actual)) {
        weightDeviation = Math.abs(actual - original) / original * 100;
        weightWithinTolerance = weightDeviation <= ui.RECEIPT_WEIGHT_TOLERANCE_PERCENT;
      }
    }
    const actRequiredRows = actRows.filter(row => row !== weightRow || !weightWithinTolerance);
    const actDetailsComplete = actRequiredRows.every(receiptMismatchDetailsComplete);
    const unknown = mismatchRows.filter(row => !blockingNames.has(receiptRowLabel(row)) && !actNames.has(receiptRowLabel(row)) && receiptRowLabel(row) !== 'Связанные документы');
    const blockedFields = [...blocking, ...unknown].map(receiptRowLabel);
    const statusAllows = ![...form.querySelectorAll('.compare-row.reference')].some(row => receiptRowLabel(row) === 'Статус эВСД' && !/оформлен/i.test(row.querySelector('.mercury-value')?.textContent || ''));
    const unavailableBase = !complete ? 'Сначала заполните все результаты сравнения и состояние перевозки.' : !statusAllows ? 'Статус эВСД не допускает гашение.' : '';
    const blockingReason = blockedFields.length ? `Принятие невозможно из-за полей: ${blockedFields.join(', ')}.` : '';
    const relatedReason = related.length ? 'Связанные документы нельзя исправить при приёмке в текущем сценарии.' : '';
    const autoAct = usesAutomaticReceiptAct(form);
    const states = {
      'accept-all': { enabled: complete && statusAllows && !blockedFields.length && !related.length && (autoAct ? (!actRequiredRows.length || actDetailsComplete) : !actRequiredRows.length), reason: unavailableBase || blockingReason || relatedReason || (actRequiredRows.length && !autoAct ? 'Есть расхождения, для которых требуется акт.' : actRequiredRows.length && !actDetailsComplete ? 'Заполните фактические значения и причины расхождений для акта.' : '') },
      'accept-all-report': { enabled: complete && statusAllows && !blockedFields.length && !related.length && actRequiredRows.length > 0 && actDetailsComplete, reason: unavailableBase || blockingReason || relatedReason || (!actRequiredRows.length ? 'Нет расхождений, требующих акт.' : !actDetailsComplete ? 'Заполните фактические значения и причины расхождений для акта.' : '') },
      partial: { enabled: complete && statusAllows && !blockedFields.length && !related.length, reason: unavailableBase || blockingReason || relatedReason },
      'return-all': { enabled: complete && statusAllows, reason: unavailableBase }
    };
    return { complete, mismatchRows, actRows, actRequiredRows, actDetailsComplete, blocking, related, blockedFields, weightWithinTolerance, weightDeviation, states };
  };

  const createReceiptReasonField = form => {
    const wrap = create('div', 'receipt-return-reason');
    const label = create('label', '', 'Причина возврата *');
    const select = create('select');
    const selectId = `receipt-return-reason-${++sequence}`;
    const otherId = `receipt-other-reason-${++sequence}`;
    select.id = selectId;
    label.htmlFor = selectId;
    select.name = 'receiptReturnReason';
    select.required = true;
    const placeholder = create('option', '', 'Выберите причину');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    const reasons = form?.dataset.receiptReasonCatalog === 'meat'
      ? ui.MEAT_RETURN_REASONS
      : ui.RETURN_REASONS.map((labelText, index, items) => ({ code: index === items.length - 1 ? 'OTHER_REASON' : `REASON_${index + 1}`, label: labelText }));
    reasons.forEach(({ code, label: optionText }) => {
      const option = create('option', '', optionText);
      option.value = code;
      select.append(option);
    });
    const otherLabel = create('label', 'receipt-other-label', 'Иная причина *');
    const other = create('textarea', 'receipt-other-reason');
    other.id = otherId;
    otherLabel.htmlFor = otherId;
    other.name = 'receiptOtherReason';
    other.placeholder = 'Укажите причину возврата, до 240 символов';
    other.maxLength = 240;
    otherLabel.hidden = true;
    other.hidden = true;
    select.addEventListener('change', () => {
      const visible = select.value === 'OTHER_REASON';
      otherLabel.hidden = !visible;
      other.hidden = !visible;
      other.required = visible;
      if (!visible) other.value = '';
    });
    label.append(select);
    wrap.append(label, otherLabel, other);
    return wrap;
  };

  const receiptComposition = form => {
    const rows = [...form.querySelectorAll('.quantity-row .parts-table .parts-row:not(.parts-head)')];
    return rows.map((row, index) => ({ id: index + 1, text: [...row.children].map(cell => cell.textContent.trim()).filter(Boolean).join(' · ') }));
  };

  const appendReceiptActSummary = (container, form) => {
    const rows = ui.evaluateReceiptDecisions(form).actRequiredRows;
    if (!rows.length) return;
    const banner = create('div', 'receipt-act-banner');
    banner.append(create('strong', 'receipt-act-title', 'Будет сформирован акт несоответствия'));
    banner.append(create('p', 'receipt-act-copy', 'В фактических сведениях обнаружены допустимые расхождения с эВСД. После подтверждения «Меркурий» сформирует акт несоответствия.'));
    banner.append(create('strong', 'receipt-act-subtitle', 'Расхождения, включаемые в акт'));
    const list = create('ul', 'receipt-discrepancy-list');
    rows.forEach(row => {
      const source = row.querySelector('.mercury-value')?.textContent.trim() || 'не указано';
      const fact = row.querySelector('.fact-field input, .fact-field textarea, .fact-field select')?.value.trim() || 'не указано';
      const reason = row.querySelector('.mismatch-reason-input')?.value.trim() || 'не указана';
      list.append(create('li', '', `${receiptRowLabel(row)}: в эВСД — ${source}; фактически — ${fact}. Причина: ${reason}`));
    });
    banner.append(list);
    container.append(banner);
  };

  const syncReceiptActSummary = (details, form, decision) => {
    details.querySelector('.receipt-act-banner')?.remove();
    if (['accept-all', 'accept-all-report', 'partial'].includes(decision)) appendReceiptActSummary(details, form);
  };

  ui.renderReceiptDecisionDetails = (field, value) => {
    const form = field.closest('form');
    const details = field.querySelector('.receipt-decision-details');
    details.replaceChildren();
    const requiresAct = ui.evaluateReceiptDecisions(form).actRequiredRows.length > 0;
    details.hidden = !value || (value === 'accept-all' && !requiresAct);
    if (details.hidden) return;
    if (['accept-all', 'accept-all-report'].includes(value)) {
      syncReceiptActSummary(details, form, value);
      return;
    }
    if (value === 'partial') {
      details.append(create('strong', '', 'Раздел фактически доставленной партии'));
      const parts = receiptComposition(form);
      if (parts.length > 1) {
        const partList = create('fieldset', 'receipt-part-list');
        const legend = create('legend', '', 'Возвращаемые части *');
        partList.append(legend);
        parts.forEach(part => {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.name = 'receiptReturnedPart';
          checkbox.value = String(part.id);
          checkbox.addEventListener('change', () => {
            const returned = partList.querySelectorAll('input:checked').length;
            totals.textContent = `Принято частей: ${parts.length - returned} · Возвращается частей: ${returned}`;
          });
          label.append(checkbox, document.createTextNode(part.text));
          partList.append(label);
        });
        const totals = create('div', 'receipt-part-totals', `Принято частей: ${parts.length} · Возвращается частей: 0`);
        details.append(partList, totals);
      }
      const amountRow = [...form.querySelectorAll('.compare-row')].find(row => ['Вес', 'Объём / масса'].includes(receiptRowLabel(row)));
      const original = receiptNumber(amountRow?.querySelector('.mercury-value')?.textContent);
      const actual = amountRow?.dataset.state === 'bad'
        ? receiptNumber(amountRow.querySelector('.fact-field input, .fact-field textarea, .fact-field select')?.value)
        : NaN;
      const delivered = Number.isFinite(actual) ? actual : original;
      const unit = /л/.test(amountRow?.querySelector('.mercury-value')?.textContent || '') ? 'л' : 'кг';
      const amounts = create('div', 'receipt-amount-grid');
      [['receiptDelivered', 'Фактически доставлено', delivered], ['receiptAccepted', 'Принято', ''], ['receiptReturned', 'Возвращается', '']].forEach(([name, text, value]) => {
        const label = document.createElement('label');
        label.append(document.createTextNode(`${text}, ${unit} *`));
        const input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '0.1'; input.name = name; input.required = true; input.value = Number.isFinite(value) ? String(value) : '';
        label.append(input); amounts.append(label);
      });
      details.append(amounts, createReceiptReasonField(form));
      syncReceiptActSummary(details, form, value);
      return;
    }
    if (value === 'return-all') {
      details.append(create('strong', '', 'Вся фактически прибывшая партия будет возвращена'));
      const parts = receiptComposition(form);
      const summary = create('ul', 'receipt-discrepancy-list');
      parts.forEach(part => summary.append(create('li', '', part.text)));
      details.append(summary, createReceiptReasonField(form));
    }
  };

  ui.updateReceiptDecision = (form, { announce = false } = {}) => {
    const field = form?.querySelector('.receipt-decision-field');
    const select = field?.querySelector('[name="receiptDecision"]');
    if (!field || !select) return null;
    const evaluation = ui.evaluateReceiptDecisions(form);
    const decisions = receiptDecisions(form);
    if (usesAutomaticReceiptAct(form)) select.querySelector('option[value="accept-all-report"]')?.remove();
    select.disabled = !evaluation.complete;
    decisions.forEach(decision => {
      const option = select.querySelector(`option[value="${decision.value}"]`);
      if (option) option.disabled = !evaluation.states[decision.value].enabled;
    });
    if (select.value && !evaluation.states[select.value]?.enabled) {
      select.value = '';
      ui.renderReceiptDecisionDetails(field, '');
    }
    const details = field.querySelector('.receipt-decision-details');
    if (select.value === 'accept-all') ui.renderReceiptDecisionDetails(field, select.value);
    else if (select.value === 'partial') syncReceiptActSummary(details, form, select.value);
    const messages = field.querySelector('.receipt-decision-messages');
    messages.replaceChildren();
    if (evaluation.blockedFields.length) {
      const fields = [...new Set(evaluation.blockedFields)].join(', ');
      const alert = create('div', 'receipt-blocking-message', `Принять партию по этому эВСД невозможно: фактические сведения отличаются в полях, которые нельзя исправить при приёмке через API «Меркурия». Поля: ${fields}. Можно оформить полный возврат либо привести эВСД в соответствие в «Меркурии».`);
      alert.setAttribute('role', 'alert');
      messages.append(alert);
    }
    if (evaluation.weightDeviation > ui.RECEIPT_WEIGHT_TOLERANCE_PERCENT) messages.append(create('div', 'receipt-recommendation', `Расхождение веса ${evaluation.weightDeviation.toFixed(1).replace('.', ',')}% превышает допустимые 5%. Для принятия потребуется акт.`));
    const unavailable = decisions.filter(decision => !evaluation.states[decision.value].enabled && evaluation.states[decision.value].reason);
    const showUnavailable = evaluation.complete || form.dataset.receiptReasonCatalog !== 'meat';
    if (unavailable.length && showUnavailable) {
      const list = create('ul', 'receipt-unavailable-list');
      unavailable.forEach(decision => {
        const unavailableLabel = decision.value === 'return-all' ? `${decision.label} недоступен` : `${decision.label} недоступно`;
        list.append(create('li', '', `${unavailableLabel}: ${evaluation.states[decision.value].reason}`));
      });
      messages.append(list);
    }
    const submit = form.querySelector('button[type="submit"]');
    const selected = decisions.find(decision => decision.value === select.value);
    if (submit) {
      const actRequired = evaluation.actRequiredRows.length > 0;
      submit.textContent = selected?.value === 'accept-all' && actRequired
        ? 'Погасить эВСД с актом'
        : selected?.value === 'partial' && actRequired
          ? 'Погасить эВСД частично с актом'
          : selected?.submitLabel || 'Завершить';
      submit.disabled = !evaluation.complete;
    }
    if (announce) field.dispatchEvent(new CustomEvent('vse-receipt-availability-change', { bubbles: true, detail: evaluation }));
    return evaluation;
  };

  ui.createReceiptDecision = ({ value = '', disabled = false, automaticAct = false } = {}) => {
    const field = ui.createDecisionField({
      label: 'Решение о приёмке',
      description: 'Выберите способ завершения приёмки после заполнения результатов сверки.',
      id: 'receipt-decision', name: 'receiptDecision', required: true, disabled, value,
      options: (automaticAct ? ui.RECEIPT_AUTO_ACT_DECISIONS : ui.RECEIPT_DECISIONS).map(({ value: optionValue, label }) => ({ value: optionValue, label }))
    });
    field.classList.add('receipt-decision-field');
    const messages = create('div', 'receipt-decision-messages');
    messages.setAttribute('aria-live', 'polite');
    const details = create('div', 'receipt-decision-details');
    details.hidden = true;
    field.append(messages, details);
    field.querySelector('select').addEventListener('change', event => {
      ui.renderReceiptDecisionDetails(field, event.currentTarget.value);
      field.dispatchEvent(new CustomEvent('vse-receipt-decision-change', { bubbles: true, detail: { value: event.currentTarget.value } }));
    });
    return field;
  };

  ui.bindReceiptDecision = form => {
    if (!form?.querySelector('.receipt-decision-field') || form.dataset.receiptDecisionBound === 'true') return;
    form.dataset.receiptDecisionBound = 'true';
    const update = () => ui.updateReceiptDecision(form);
    form.addEventListener('vse-check-change', update);
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('click', event => {
      if (event.target.closest('.check-button, #mark-all-ok')) queueMicrotask(update);
    });
    update();
  };

  ui.validateReceiptDecision = form => {
    const select = form.querySelector('[name="receiptDecision"]');
    if (!select?.value) {
      ui.setDecisionFieldError(select, 'Выберите решение о приёмке.');
      select?.focus();
      return false;
    }
    const field = select.closest('.receipt-decision-field');
    const showError = message => {
      ui.setDecisionFieldError(select, message);
      field.querySelector('.receipt-decision-details input, .receipt-decision-details select, .receipt-decision-details textarea')?.focus();
      return false;
    };
    const availability = ui.evaluateReceiptDecisions(form).states[select.value];
    if (!availability?.enabled) return showError(availability?.reason || 'Выбранное решение сейчас недоступно.');
    if (select.value === 'partial') {
      const delivered = Number(form.elements.receiptDelivered?.value);
      const accepted = Number(form.elements.receiptAccepted?.value);
      const returned = Number(form.elements.receiptReturned?.value);
      if (!(delivered > 0 && accepted > 0 && returned > 0)) return showError('Укажите положительные значения доставленной, принятой и возвращаемой частей.');
      if (Math.abs(accepted + returned - delivered) > 0.01) return showError('Сумма принятой и возвращаемой частей должна совпадать с фактически доставленным объёмом.');
      const partChecks = [...form.querySelectorAll('[name="receiptReturnedPart"]')];
      const checked = partChecks.filter(input => input.checked).length;
      if (partChecks.length && (!checked || checked === partChecks.length)) return showError('Выберите часть партии для возврата, оставив хотя бы одну часть принятой.');
    }
    if (['partial', 'return-all'].includes(select.value)) {
      const reason = form.elements.receiptReturnReason;
      if (!reason?.value) return showError('Выберите причину возврата.');
      if (reason.value === 'OTHER_REASON' && !form.elements.receiptOtherReason?.value.trim()) return showError('Укажите иную причину возврата.');
      if (form.elements.receiptOtherReason?.value.length > 240) return showError('Иная причина должна содержать не более 240 символов.');
    }
    ui.setDecisionFieldError(select, '');
    return true;
  };

  ui.getReceiptDecisionPayload = form => {
    const decision = form.elements.receiptDecision?.value || '';
    const reasonSelect = form.elements.receiptReturnReason;
    return {
      decision,
      delivered: Number(form.elements.receiptDelivered?.value || 0),
      accepted: Number(form.elements.receiptAccepted?.value || 0),
      returned: Number(form.elements.receiptReturned?.value || 0),
      returnedParts: [...form.querySelectorAll('[name="receiptReturnedPart"]:checked')].map(input => input.value),
      returnReason: reasonSelect?.selectedOptions?.[0]?.textContent || '',
      returnReasonCode: reasonSelect?.value || '',
      otherReason: form.elements.receiptOtherReason?.value.trim() || ''
    };
  };

  ui.createSpecialistField = ({ value, id = `check-specialist-${++sequence}` } = {}) => {
    const field = create('div', 'check-specialist-field');
    const label = create('label', '', 'Специалист Госветслужбы');
    label.htmlFor = id;
    const input = create('input');
    input.id = id;
    input.type = 'text';
    input.value = value || '';
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
    field.append(label, input);
    return field;
  };

  ui.createCheckResultsSection = ({ specialist = '', decision = '', receiptDecision = '', disabled = false, automaticAct = false, includeRepeatVse = true, transaction = false } = {}) => ui.createSection({
    title: 'Результаты сверки',
    description: includeRepeatVse
      ? 'Решение о приёмке партии, необходимость повторной ВСЭ и специалист, выполнивший сверку.'
      : 'Решение о приёмке партии и специалист, выполнивший сверку.',
    section: 'results',
    content: [
      ui.createSpecialistField({ value: specialist }),
      ui.createReceiptDecision({ value: receiptDecision, disabled, automaticAct }),
      ...(includeRepeatVse ? [ui.createRepeatVseDecision({ value: decision, disabled })] : []),
      ...(transaction ? [ui.createTransactionDecision({ disabled })] : [])
    ]
  });

  ui.getActiveSpecialistName = (root = document) => {
    const documentRoot = root.ownerDocument || root;
    return documentRoot.querySelector('#profile > span:last-child, #profile .avatar + span')?.textContent.trim() || '';
  };

  ui.mountCheckResultsSections = (root = document) => {
    root.querySelectorAll('[data-check-results]').forEach(slot => {
      const specialist = slot.dataset.specialist || ui.getActiveSpecialistName(root);
      const automaticAct = slot.closest('form')?.dataset.receiptAutoAct === 'true';
      const section = ui.createCheckResultsSection({
        specialist,
        decision: slot.dataset.decision || '',
        receiptDecision: slot.dataset.receiptDecision || '',
        disabled: slot.hasAttribute('data-disabled'),
        automaticAct,
        includeRepeatVse: slot.dataset.repeatVse !== 'false',
        transaction: slot.dataset.transaction === 'true'
      });
      slot.replaceWith(section);
    });
  };

  ui.mountRepeatVseDecisions = (root = document) => {
    root.querySelectorAll('[data-repeat-vse-decision]').forEach(slot => {
      if (slot.dataset.checkUiMounted === 'true') return;
      slot.dataset.checkUiMounted = 'true';
      slot.replaceWith(ui.createRepeatVseDecision({ value: slot.dataset.value || '', disabled: slot.hasAttribute('data-disabled') }));
    });
  };

  ui.createResearchResult = ({ name, value, optional = false }) => {
    const item = create('div', `research-item${optional ? ' optional' : ''}`);
    item.append(create('div', 'research-name', name), create('div', 'research-value', value));
    return item;
  };

  ui.createInvoice = ({ lines, total }) => {
    const fragment = document.createDocumentFragment();
    const wrap = create('div', 'invoice-table-wrap');
    const table = create('table', 'invoice-table standardized-columns');
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    [['Услуга', 'invoice-service-column'], ['Количество', 'invoice-quantity-column'], ['Тариф', 'invoice-rate-column'], ['Сумма', 'invoice-sum-column']].forEach(([label, className]) => {
      const th = create('th', className, label);
      th.scope = 'col';
      headRow.append(th);
    });
    head.append(headRow);
    const body = document.createElement('tbody');
    lines.forEach(line => {
      const row = document.createElement('tr');
      [line.service, line.quantity, line.rate, line.sum].forEach(value => row.append(create('td', '', value)));
      body.append(row);
    });
    table.append(head, body);
    wrap.append(table);
    const totalNode = create('div', 'invoice-total');
    totalNode.append(create('span', '', 'Итого к оплате'), create('strong', '', total));
    fragment.append(wrap, totalNode);
    return fragment;
  };

  ui.createInvoiceWaiver = ({ value = false, disabled = false } = {}) => {
    const label = create('label', 'invoice-waiver');
    const checkbox = create('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'invoice-waiver';
    checkbox.name = 'invoiceWaiver';
    checkbox.checked = Boolean(value);
    checkbox.disabled = disabled;
    const copy = create('span', 'invoice-waiver-copy');
    const title = create('span', 'invoice-waiver-title', 'Ярмарка');
    const note = create('span', 'invoice-waiver-note', 'Сверка данных и ВСЭ по этой партии проводятся без оплаты.');
    copy.append(title, note);
    label.append(checkbox, copy);
    return ui.bindInvoiceWaiver(label);
  };

  ui.bindInvoiceWaiver = field => {
    if (!field || field.dataset.checkUiBound === 'true') return field;
    field.dataset.checkUiBound = 'true';
    const checkbox = field.querySelector('input');
    const sync = () => field.classList.toggle('is-active', checkbox.checked);
    checkbox.addEventListener('change', sync);
    sync();
    return field;
  };

  ui.createSection = ({ title, description = '', section: sectionKey = 'document', price = '', content = [] }) => {
    const section = create('section', 'section');
    section.dataset.checkSection = sectionKey;
    section.append(ui.createSectionHeader({ title, description, section: sectionKey, price }));
    content.forEach(node => section.append(node));
    return section;
  };

  ui.enhance = (root = document) => {
    iconLibrary?.enhanceCheckInterface(root);
    ui.mountProductTaxonomies(root);
    ui.mountMismatchReasons(root);
    ui.mountCheckResultsSections(root);
    ui.mountRepeatVseDecisions(root);
    const forms = [...root.querySelectorAll('form.vse-check-ui')];
    if (root.matches?.('form.vse-check-ui')) forms.unshift(root);
    forms.forEach(ui.bindReceiptDecision);
    root.querySelectorAll('.vse-check-ui .compare-row:not(.reference)').forEach(ui.bindComparisonField);
    root.querySelectorAll('.vse-check-ui .check-button').forEach(button => {
      if (!button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    });
    root.querySelectorAll('.vse-check-ui .transport-observation').forEach(ui.bindTransportObservation);
    root.querySelectorAll('.vse-check-ui .check-decision-field').forEach(ui.bindDecisionField);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ui.enhance());
  else ui.enhance();
})();
