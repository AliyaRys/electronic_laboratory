(function () {
  const directionMap = {
    'Пригодно': ['В реализацию без ограничений'],
    'Условно-пригодно': ['На обезвреживание'],
    'Непригодно': ['На утилизацию', 'На уничтожение']
  };

  const neutralizationReasons = [
    'Туберкулёз', 'Лейкоз', 'Цистицеркоз (финноз)', 'Сальмонеллёз', 'Бруцеллёз', 'Болезнь Ауески',
    'Везикулярный стоматит', 'Кампилобактериоз', 'Лептоспироз', 'Листериоз', 'Лихорадка Ку',
    'Паратуберкулёз', 'Пастереллёз', 'Хламидиоз', 'Токсоплазмоз', 'Микоплазмоз', 'Некробактериоз',
    'Парагрипп-3', 'Вирусная диарея КРС', 'Инфекционный кератоконъюнктивит КРС',
    'Заразный узелковый дерматит КРС', 'Контагиозная плевропневмония КРС', 'Инфекционная агалактия',
    'Оспа овец', 'Хламидиозный энзоотический аборт овец', 'Инфекционный эпидидимит баранов',
    'Репродуктивно-респираторный синдром свиней (РРСС)', 'Трансмиссивный гастроэнтерит свиней',
    'Везикулярная болезнь свиней', 'Везикулярная экзантема свиней',
    'Энтеровирусный энцефаломиелит свиней (болезнь Тешена)', 'Другое паразитарное заболевание',
    'Незаразное заболевание', 'Другая причина'
  ];

  const disposalReasons = [
    'Туберкулез', 'Лейкоз', 'Болезнь Марека', 'Цистицеркоз (финноз)', 'Другая причина'
  ];

  const destructionReasons = [
    'Африканская чума свиней', 'Блютанг', 'Губкообразная энцефалопатия крупного рогатого скота',
    'Оспа овец и коз', 'Скрепи овец и коз', 'Сибирская язва', 'Трихинеллёз', 'Туляремия',
    'Чума крупного рогатого скота', 'Чума мелких жвачных животных', 'Эмфизематозный карбункул (эмкар)', 'Ящур',
    'Происхождение биологических отходов невозможно подтвердить', 'Другая причина'
  ];

  const REASON_SETS = {
    neutralization: {
      title: 'Причина направления на обезвреживание',
      reasons: neutralizationReasons,
      reasonName: 'vseNeutralizationReason',
      customName: 'vseNeutralizationCustom',
      idPrefix: 'vse-neutralization-reason',
      customIdPrefix: 'vse-neutralization-custom',
      addLabel: 'Добавить ещё одну причину направления на обезвреживание',
      removeLabel: 'Удалить эту причину направления на обезвреживание'
    },
    disposal: {
      title: 'Причина направления на утилизацию',
      reasons: disposalReasons,
      reasonName: 'vseDisposalReason',
      customName: 'vseDisposalCustom',
      idPrefix: 'vse-disposal-reason',
      customIdPrefix: 'vse-disposal-custom',
      addLabel: 'Добавить ещё одну причину направления на утилизацию',
      removeLabel: 'Удалить эту причину направления на утилизацию'
    },
    destruction: {
      title: 'Причина направления на уничтожение',
      reasons: destructionReasons,
      reasonName: 'vseDestructionReason',
      customName: 'vseDestructionCustom',
      idPrefix: 'vse-destruction-reason',
      customIdPrefix: 'vse-destruction-custom',
      addLabel: 'Добавить ещё одну причину направления на уничтожение',
      removeLabel: 'Удалить эту причину направления на уничтожение'
    }
  };
  const MAX_NEUTRALIZATION_REASONS = 5;

  function createOption(text, value) {
    const option = document.createElement('option');
    option.textContent = text;
    option.value = value === undefined ? text : value;
    return option;
  }

  function focusSelect(select) {
    if (globalThis.MilkVseSelects?.focus(select)) return;
    select.focus();
  }

  function updateDirections(resultSelect, directionSelect, selectedDirection) {
    const directions = directionMap[resultSelect.value] || [];
    directionSelect.replaceChildren(createOption('Выберите направление', ''));
    directionSelect.firstElementChild.disabled = true;
    directions.forEach(direction => directionSelect.append(createOption(direction)));
    directionSelect.disabled = !directions.length;
    if (selectedDirection && directions.includes(selectedDirection)) directionSelect.value = selectedDirection;
    else if (directions.length === 1) directionSelect.value = directions[0];
    else directionSelect.value = '';
    globalThis.MilkVseSelects?.refresh(directionSelect);
  }

  function createReasonSelect(set, index, rowIndex) {
    const select = document.createElement('select');
    select.id = `${set.idPrefix}-${index}-${rowIndex}`;
    select.name = `${set.reasonName}[${index}][]`;
    select.dataset.librarySelect = '';
    select.required = false;
    select.append(createOption('Выберите причину', ''));
    select.firstElementChild.disabled = true;
    set.reasons.forEach(reason => select.append(createOption(reason)));
    return select;
  }

  function createReasonRow(block, set, index, rowIndex) {
    const row = document.createElement('div');
    row.className = 'vse-neutralization-reason-row';
    row.dataset.neutralizationReasonRow = '';

    const selectField = document.createElement('div');
    selectField.className = 'vse-neutralization-reason-field';
    const label = document.createElement('label');
    label.htmlFor = `${set.idPrefix}-${index}-${rowIndex}`;
    label.textContent = 'Причина';
    const select = createReasonSelect(set, index, rowIndex);
    selectField.append(label, select);

    const customField = document.createElement('div');
    customField.className = 'vse-neutralization-reason-field vse-neutralization-custom';
    customField.hidden = true;
    const customId = `${set.customIdPrefix}-${index}-${rowIndex}`;
    const customLabel = document.createElement('label');
    customLabel.htmlFor = customId;
    customLabel.textContent = 'Другая причина';
    const custom = document.createElement('input');
    custom.id = customId;
    custom.name = `${set.customName}[${index}][]`;
    custom.placeholder = 'Введите причину направления';
    custom.autocomplete = 'off';
    customField.append(customLabel, custom);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = rowIndex === 1 ? 'add-row-button' : 'remove-row';
    action.textContent = rowIndex === 1 ? '＋' : '×';
    action.setAttribute('aria-label', rowIndex === 1 ? set.addLabel : set.removeLabel);

    select.addEventListener('change', () => {
      const isCustom = select.value === 'Другая причина';
      row.classList.toggle('has-custom-reason', isCustom);
      customField.hidden = !isCustom;
      custom.required = isCustom;
      if (!isCustom) custom.value = '';
      row.closest('.vse-outcome-row')?.classList.remove('invalid');
      if (isCustom) custom.focus();
    });

    if (rowIndex === 1) action.addEventListener('click', () => addReasonRow(block, index));
    else action.addEventListener('click', () => { row.remove(); updateReasonActions(block); });

    row.append(selectField, customField, action);
    return row;
  }

  function updateReasonActions(block) {
    const count = block.querySelectorAll('[data-neutralization-reason-row]').length;
    const add = block.querySelector('.add-row-button');
    if (add) {
      add.disabled = count >= MAX_NEUTRALIZATION_REASONS;
      add.setAttribute('aria-disabled', String(count >= MAX_NEUTRALIZATION_REASONS));
    }
    const limit = block.querySelector('[data-neutralization-limit]');
    if (limit) limit.hidden = count < MAX_NEUTRALIZATION_REASONS;
  }

  function addReasonRow(block, index) {
    const set = REASON_SETS[block.dataset.reasonKind || 'neutralization'];
    const list = block.querySelector('[data-neutralization-reason-list]');
    const count = list.querySelectorAll('[data-neutralization-reason-row]').length;
    if (count >= MAX_NEUTRALIZATION_REASONS) return;
    const nextIndex = Number(block.dataset.nextReasonIndex || 1) + 1;
    block.dataset.nextReasonIndex = String(nextIndex);
    const row = createReasonRow(block, set, index, nextIndex);
    list.append(row);
    row.querySelector('select').required = true;
    globalThis.MilkVseSelects?.enhance(row);
    updateReasonActions(block);
    focusSelect(row.querySelector('select'));
  }

  function createReasonBlock(index, kind) {
    const set = REASON_SETS[kind];
    const block = document.createElement('div');
    block.className = 'vse-neutralization-reasons';
    block.hidden = true;
    block.dataset.neutralizationReasons = '';
    block.dataset.reasonKind = kind;
    block.dataset.nextReasonIndex = '1';

    const header = document.createElement('div');
    header.className = 'vse-neutralization-reasons-head';
    const title = document.createElement('h4');
    title.innerHTML = `${set.title} <span class="req">*</span>`;
    header.append(title);

    const list = document.createElement('div');
    list.className = 'vse-neutralization-reason-list';
    list.dataset.neutralizationReasonList = '';
    list.append(createReasonRow(block, set, index, 1));
    const limit = document.createElement('p');
    limit.className = 'vse-neutralization-limit';
    limit.dataset.neutralizationLimit = '';
    limit.hidden = true;
    limit.textContent = 'Добавлено максимальное количество причин — 5';
    block.append(header, list, limit);

    updateReasonActions(block);
    return block;
  }

  function resetReasonBlock(block, index, kind) {
    const set = REASON_SETS[kind];
    const list = block.querySelector('[data-neutralization-reason-list]');
    block.dataset.reasonKind = kind;
    block.dataset.nextReasonIndex = '1';
    const title = block.querySelector('.vse-neutralization-reasons-head h4');
    if (title) title.innerHTML = `${set.title} <span class="req">*</span>`;
    list.replaceChildren(createReasonRow(block, set, index, 1));
    globalThis.MilkVseSelects?.enhance(list);
    updateReasonActions(block);
  }

  function requiredReasonKind(result, direction) {
    if (result === 'Условно-пригодно' && direction === 'На обезвреживание') return 'neutralization';
    if (result === 'Непригодно' && direction === 'На утилизацию') return 'disposal';
    if (result === 'Непригодно' && direction === 'На уничтожение') return 'destruction';
    return null;
  }

  function syncReasonBlock(row, result, direction) {
    let block = row.querySelector('[data-neutralization-reasons]');
    if (!block) return;
    const kind = requiredReasonKind(result.value, direction.value);
    const shouldShow = Boolean(kind);
    if (shouldShow && block.dataset.reasonKind !== kind) {
      resetReasonBlock(block, Number(row.dataset.outcomeIndex), kind);
      globalThis.MilkVseSelects?.enhance(block);
    }
    block.hidden = !shouldShow;
    block.querySelectorAll('select').forEach(select => { select.required = shouldShow; });
    block.querySelectorAll('.vse-neutralization-custom input').forEach(input => {
      input.required = shouldShow && !input.closest('.vse-neutralization-custom').hidden;
    });
    if (!shouldShow) resetReasonBlock(block, Number(row.dataset.outcomeIndex), 'neutralization');
    else globalThis.MilkVseSelects?.enhance(block);
  }

  function render(container, parts, options = {}) {
    const allowConditional = options.allowConditional !== false;
    const enableNeutralizationReasons = options.enableNeutralizationReasons === true;
    container.replaceChildren();
    parts.forEach((part, index) => {
      const row = document.createElement('div');
      row.className = 'vse-outcome-row';
      row.dataset.part = part;
      row.dataset.outcomeIndex = String(index + 1);
      const partLabel = document.createElement('div');
      partLabel.className = 'vse-outcome-part';
      partLabel.textContent = part;

      const resultControl = document.createElement('div');
      resultControl.className = 'vse-outcome-control';
      const resultLabel = document.createElement('label');
      resultLabel.htmlFor = `vse-result-${index + 1}`;
      resultLabel.innerHTML = 'Результат ВСЭ <span class="req">*</span>';
      const result = document.createElement('select');
      result.id = `vse-result-${index + 1}`;
      result.dataset.librarySelect = '';
      result.name = 'vseResult[]';
      result.required = true;
      result.append(createOption('Выберите решение', ''), createOption('Пригодно'));
      result.firstElementChild.disabled = true;
      if (allowConditional) result.append(createOption('Условно-пригодно'));
      result.append(createOption('Непригодно'));
      resultControl.append(resultLabel, result);

      const directionControl = document.createElement('div');
      directionControl.className = 'vse-outcome-control';
      const directionLabel = document.createElement('label');
      directionLabel.htmlFor = `vse-direction-${index + 1}`;
      directionLabel.innerHTML = 'Направление по результатам ВСЭ <span class="req">*</span>';
      const direction = document.createElement('select');
      direction.id = `vse-direction-${index + 1}`;
      direction.dataset.librarySelect = '';
      direction.name = 'vseDirection[]';
      direction.required = true;
      direction.disabled = true;
      direction.append(createOption('Сначала выберите результат', ''));
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'vsePart[]';
      hidden.value = part;
      directionControl.append(directionLabel, direction, hidden);

      result.addEventListener('change', () => {
        updateDirections(result, direction);
        syncReasonBlock(row, result, direction);
        row.classList.remove('invalid');
        container.parentElement?.querySelector('.vse-outcome-error')?.classList.remove('visible');
      });
      direction.addEventListener('change', () => {
        syncReasonBlock(row, result, direction);
        row.classList.remove('invalid');
      });
      row.append(partLabel, resultControl, directionControl);
      if (enableNeutralizationReasons) row.append(createReasonBlock(index + 1, 'neutralization'));
      container.append(row);
    });
  }

  function validate(container) {
    let firstInvalid = null;
    container.querySelectorAll('.vse-outcome-row').forEach(row => {
      const result = row.querySelector('[name="vseResult[]"]');
      const direction = row.querySelector('[name="vseDirection[]"]');
      const reasonBlock = row.querySelector('[data-neutralization-reasons]:not([hidden])');
      const reasonInvalid = reasonBlock && [...reasonBlock.querySelectorAll('[data-neutralization-reason-row]')].some(reasonRow => {
        const select = reasonRow.querySelector('select');
        const custom = reasonRow.querySelector('input');
        return !select.value || (select.value === 'Другая причина' && !custom.value.trim());
      });
      const invalid = !result.value || !direction.value || Boolean(reasonInvalid);
      row.classList.toggle('invalid', invalid);
      if (invalid && !firstInvalid) firstInvalid = !result.value ? result : !direction.value ? direction : reasonBlock.querySelector('select:invalid,input:invalid');
    });
    const message = container.parentElement?.querySelector('.vse-outcome-error');
    if (message) message.classList.toggle('visible', Boolean(firstInvalid));
    if (firstInvalid) focusSelect(firstInvalid);
    return !firstInvalid;
  }

  function collectReasons(row) {
    const block = row.querySelector('[data-neutralization-reasons]:not([hidden])');
    if (!block) return [];
    return [...block.querySelectorAll('[data-neutralization-reason-row]')].map(reasonRow => {
      const select = reasonRow.querySelector('select');
      const custom = reasonRow.querySelector('input');
      return select.value === 'Другая причина' ? custom.value.trim() : select.value;
    }).filter(Boolean);
  }

  function collect(container) {
    return [...container.querySelectorAll('.vse-outcome-row')].map(row => ({
      part: row.dataset.part,
      result: row.querySelector('[name="vseResult[]"]').value,
      direction: row.querySelector('[name="vseDirection[]"]').value,
      neutralizationReasons: collectReasons(row)
    }));
  }

  function appendToParams(params, outcomes) {
    outcomes.forEach(outcome => {
      params.append('vsePart[]', outcome.part);
      params.append('vseResult[]', outcome.result);
      params.append('vseDirection[]', outcome.direction);
      params.append('vseNeutralizationReasons[]', JSON.stringify(outcome.neutralizationReasons || []));
    });
    return params;
  }

  function fromParams(params = new URLSearchParams(location.search)) {
    const parts = params.getAll('vsePart[]');
    const results = params.getAll('vseResult[]');
    const directions = params.getAll('vseDirection[]');
    const reasons = params.getAll('vseNeutralizationReasons[]');
    return parts.map((part, index) => {
      let parsedReasons = [];
      try { parsedReasons = JSON.parse(reasons[index] || '[]'); } catch { parsedReasons = []; }
      return { part, result: results[index] || '', direction: directions[index] || '', neutralizationReasons: parsedReasons };
    });
  }

  function renderSaved(container, outcomes) {
    container.replaceChildren();
    outcomes.forEach(outcome => {
      const row = document.createElement('div');
      row.className = 'saved-vse-outcome';
      const part = document.createElement('strong'); part.textContent = outcome.part;
      const result = document.createElement('span'); result.textContent = outcome.result;
      const direction = document.createElement('span'); direction.textContent = outcome.direction;
      row.append(part, result, direction);
      if (outcome.neutralizationReasons?.length) {
        const reasons = document.createElement('span');
        reasons.className = 'saved-vse-neutralization-reasons';
        const label = outcome.direction === 'На утилизацию' ? 'Причина утилизации'
          : outcome.direction === 'На уничтожение' ? 'Причина уничтожения' : 'Причина обезвреживания';
        reasons.textContent = `${label}: ${outcome.neutralizationReasons.join(', ')}`;
        row.append(reasons);
      }
      container.append(row);
    });
    syncConclusionAvailability(document, outcomes);
  }

  function hasRestrictedResult(outcomes) {
    return outcomes.some(outcome => outcome.result === 'Условно-пригодно' || outcome.result === 'Непригодно');
  }

  function syncConclusionAvailability(root, outcomes) {
    const restricted = hasRestrictedResult(outcomes);
    const panels = [...root.querySelectorAll('[data-conclusion-actions],.conclusion-panel,.actions')]
      .filter(panel => panel.hasAttribute('data-conclusion-actions') || panel.querySelector('[download],#print-conclusion'));
    panels.forEach(panel => {
      panel.hidden = restricted;
      panel.setAttribute('aria-hidden', String(restricted));
    });
    return !restricted;
  }

  window.VsePartOutcomes = {
    directionMap, neutralizationReasons, disposalReasons, destructionReasons,
    render, validate, collect, appendToParams, fromParams, renderSaved, hasRestrictedResult, syncConclusionAvailability
  };
})();
