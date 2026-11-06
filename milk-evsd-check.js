(() => {
  const form = document.getElementById('milk-check-form');
  if (!form) return;
  const party = document.body.dataset.party;
  const rows = [...form.querySelectorAll('.compare-row[data-check]')];
  const selects = [...form.querySelectorAll('.transport-observation select')];
  const repeatVseDecision = form.querySelector('[name="repeatVseDecision"]');
  const error = document.getElementById('check-error');
  const dialog = document.getElementById('check-confirmation');
  const extinguish = document.getElementById('extinguish-modal');
  const refusal = document.getElementById('refusal-modal');
  const partyInfo = {
    'ak-bars': { date: '12.08.2026 08:40', owner: 'КФХ «Ак Барс»' },
    nur: { date: '12.08.2026 10:15', owner: 'КФХ «Нур»' }
  }[party] || { date: '', owner: '' };

  const setState = (row, state) => {
    row.dataset.state = state;
    row.classList.toggle('match', state === 'ok');
    row.classList.toggle('mismatch', state === 'bad');
    row.querySelectorAll('.check-button').forEach(button => {
      const active = button.dataset.state === state;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const fact = row.querySelector('.fact-field input');
    if (fact) fact.required = state === 'bad';
    if (state === 'bad') fact?.focus();
    error.textContent = '';
  };
  rows.forEach(row => row.querySelectorAll('.check-button').forEach(button =>
    button.addEventListener('click', () => setState(row, button.dataset.state))));
  rows.forEach(row => row.querySelector('.fact-field input')?.addEventListener('input', event => {
    event.currentTarget.removeAttribute('aria-invalid');
    error.textContent = '';
  }));
  selects.forEach(select => {
    const sync = () => {
      select.closest('.transport-observation').classList.toggle('selected', !!select.value);
      select.removeAttribute('aria-invalid');
      error.textContent = '';
    };
    select.addEventListener('change', sync);
    sync();
  });
  document.getElementById('mark-all-ok').addEventListener('click', () => rows.forEach(row => setState(row, 'ok')));

  const parseNumber = value => {
    const match = String(value || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  };
  const formatNumber = value => Number(value).toLocaleString('ru-RU', { minimumFractionDigits: value % 1 ? 1 : 0, maximumFractionDigits: 1 });
  const formatQuantity = value => {
    const n = Math.max(0, Math.round(value));
    const lastTwo = n % 100;
    const last = n % 10;
    const unit = lastTwo >= 11 && lastTwo <= 14
      ? 'секций'
      : last === 1
        ? 'секция'
        : last >= 2 && last <= 4
          ? 'секции'
          : 'секций';
    return n + ' ' + unit;
  };
  const formatVolume = value => formatNumber(Math.max(0, value)) + ' л';
  const quantityRow = rows.find(row => row.dataset.check === 'quantity');
  const weightRow = rows.find(row => row.dataset.check === 'weight');
  const originalQuantity = parseNumber(quantityRow?.dataset.quantityLabel || quantityRow?.querySelector('.mercury-value')?.textContent);
  const originalVolume = parseNumber(weightRow?.querySelector('.mercury-value')?.textContent);
  let completionScenario = 'full';
  let receiptDecisionValue = '';
  let acceptedQuantity = originalQuantity;
  let acceptedVolume = originalVolume;

  const openModal = modal => {
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  };
  const closeModal = modal => {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-backdrop.open')) document.body.classList.remove('modal-open');
  };
  document.querySelectorAll('[data-close-extinguish]').forEach(button => button.addEventListener('click', () => closeModal(extinguish)));
  document.querySelectorAll('[data-close-refusal]').forEach(button => button.addEventListener('click', () => closeModal(refusal)));
  [extinguish, refusal].forEach(modal => modal?.addEventListener('click', event => {
    if (event.target === modal) closeModal(modal);
  }));

  const fillCommon = () => {
    document.getElementById('extinguish-date').textContent = partyInfo.date;
    document.getElementById('extinguish-number').textContent = document.body.dataset.number || '';
    document.getElementById('refusal-number').textContent = document.body.dataset.number || '';
    document.getElementById('refusal-sender').textContent = partyInfo.owner;
  };
  const fillPartial = data => {
    fillCommon();
    completionScenario = 'partial';
    acceptedQuantity = data.acceptedQuantity;
    acceptedVolume = data.acceptedVolume;
    document.getElementById('extinguish-method-value').textContent = 'Частичное гашение';
    document.getElementById('accepted-quantity').textContent = formatQuantity(data.acceptedQuantity);
    document.getElementById('accepted-weight').textContent = formatVolume(data.acceptedVolume);
    document.getElementById('return-quantity').textContent = formatQuantity(data.returnQuantity);
    document.getElementById('return-weight').textContent = formatVolume(data.returnVolume);
    document.getElementById('extinguish-note').textContent = 'После гашения будет принята только фактическая часть партии. На непринятую часть потребуется создать возвратный транспортный эВСД.';
    document.getElementById('extinguish-note').classList.add('warn');
  };
  const fillFull = () => {
    fillCommon();
    completionScenario = 'full';
    acceptedQuantity = originalQuantity;
    acceptedVolume = originalVolume;
    document.getElementById('extinguish-method-value').textContent = 'Полное гашение';
    document.getElementById('accepted-quantity').textContent = formatQuantity(originalQuantity);
    document.getElementById('accepted-weight').textContent = formatVolume(originalVolume);
    document.getElementById('return-quantity').textContent = formatQuantity(0);
    document.getElementById('return-weight').textContent = formatVolume(0);
    document.getElementById('extinguish-note').textContent = 'После гашения эВСД партия будет принята полностью. Возвратный эВСД не формируется.';
    document.getElementById('extinguish-note').classList.remove('warn');
  };
  const fillRefusal = reason => {
    fillCommon();
    completionScenario = 'refusal';
    acceptedQuantity = 0;
    acceptedVolume = 0;
    document.getElementById('refusal-quantity').textContent = formatQuantity(originalQuantity);
    document.getElementById('refusal-weight').textContent = formatVolume(originalVolume);
    document.getElementById('refusal-reason').textContent = reason;
  };
  const getTransportRejection = () => {
    const cargo = document.getElementById('cargo-condition')?.value.trim();
    const combined = document.getElementById('combined-cargo')?.value.trim();
    if (cargo === 'Есть загрязнения или повреждения') return 'Несоответствие поля «Состояние грузового отделения»: ' + cargo;
    if (combined === 'Да, разделение не обеспечено') return 'Несоответствие поля «Совместная перевозка с другими грузами»: ' + combined;
    return '';
  };
  const getRowRejection = () => {
    const row = rows.find(item => item.dataset.state === 'bad' && !['quantity', 'weight'].includes(item.dataset.check));
    if (!row) return '';
    const name = row.querySelector('.field-name')?.textContent.trim() || 'данные партии';
    const fact = row.querySelector('.fact-field input')?.value.trim();
    return 'Несоответствие поля «' + name + '»' + (fact ? ': ' + fact : '');
  };
  const getPartial = () => {
    const quantityFact = parseNumber(quantityRow?.querySelector('.fact-field input')?.value);
    const volumeFact = parseNumber(weightRow?.querySelector('.fact-field input')?.value);
    const quantityPartial = quantityRow?.classList.contains('mismatch') && Number.isFinite(quantityFact) && quantityFact >= 0 && quantityFact < originalQuantity;
    const volumePartial = weightRow?.classList.contains('mismatch') && Number.isFinite(volumeFact) && volumeFact >= 0 && volumeFact < originalVolume;
    if (!quantityPartial && !volumePartial) return null;
    const otherRowsMatch = rows.filter(row => !['quantity', 'weight'].includes(row.dataset.check))
      .every(row => row.classList.contains('match') && !row.classList.contains('mismatch'));
    if (!otherRowsMatch) return null;
    const acceptedQuantity = quantityPartial ? quantityFact : originalQuantity;
    const acceptedVolume = volumePartial ? volumeFact : originalVolume;
    return { acceptedQuantity, acceptedVolume, returnQuantity: Math.max(0, originalQuantity - acceptedQuantity), returnVolume: Math.max(0, originalVolume - acceptedVolume) };
  };

  const completeCheck = () => {
    const result = {
      number: document.body.dataset.number,
      checks: rows.map(row => ({ field: row.dataset.check, state: row.dataset.state,
        fact: row.dataset.state === 'bad' ? row.querySelector('.fact-field input')?.value.trim() : '' })),
      cargoCondition: document.getElementById('cargo-condition').value,
      combinedCargo: document.getElementById('combined-cargo').value,
      repeatVseDecision: repeatVseDecision?.value || '',
      receiptDecision: receiptDecisionValue,
      scenario: completionScenario,
      acceptedQuantity: Number.isFinite(acceptedQuantity) ? acceptedQuantity : 0,
      acceptedVolume: Number.isFinite(acceptedVolume) ? acceptedVolume : 0
    };
    try { localStorage.setItem('evsdCheck:milk:' + party, JSON.stringify(result)); } catch { /* prototype */ }
    if (completionScenario !== 'refusal' && repeatVseDecision?.value === 'required') {
      window.location.href = 'electronic-vse-journal-milk.html?party=' + encodeURIComponent(party);
      return;
    }
    if (party === 'nur') {
      window.location.href = 'evsd-check-milk-nur-complete.html';
      return;
    }
    if (party === 'ak-bars') {
      window.location.href = 'evsd-check-milk-ak-bars-complete.html';
      return;
    }
    window.location.href = completionScenario === 'refusal' ? 'arrivals-milk.html' : 'arrivals-accepted-milk.html';
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const unmarked = rows.find(row => !row.dataset.state);
    if (unmarked) {
      error.textContent = 'Отметьте результат сверки для каждого поля.';
      unmarked.querySelector('.check-button.ok').focus();
      return;
    }
    const emptyFact = rows.filter(row => row.dataset.state === 'bad')
      .map(row => row.querySelector('.fact-field input'))
      .find(input => !input?.value.trim());
    if (emptyFact) {
      error.textContent = 'Укажите фактическое значение для поля с расхождением.';
      emptyFact.setAttribute('aria-invalid', 'true');
      emptyFact.focus();
      return;
    }
    const emptySelect = selects.find(select => !select.value);
    if (emptySelect) {
      error.textContent = 'Укажите состояние перевозки.';
      emptySelect.setAttribute('aria-invalid', 'true');
      emptySelect.focus();
      return;
    }
    if (repeatVseDecision && !repeatVseDecision.value) {
      error.textContent = 'Укажите необходимость повторного ВСЭ.';
      globalThis.VseCheck?.setDecisionFieldError(repeatVseDecision, error.textContent);
      repeatVseDecision.focus();
      return;
    }
    if (!globalThis.VseCheck?.validateMismatchDetails(form) || !globalThis.VseCheck?.validateReceiptDecision(form)) return;
    const receipt = globalThis.VseCheck.getReceiptDecisionPayload(form);
    receiptDecisionValue = receipt.decision;
    if (receipt.decision === 'return-all') {
      fillRefusal(receipt.otherReason || receipt.returnReason);
      openModal(refusal);
      return;
    }
    if (receipt.decision === 'partial') {
      const returnedPartCount = receipt.returnedParts.length;
      const splitSingleSection = originalQuantity === 1 && !returnedPartCount;
      fillPartial({
        acceptedQuantity: splitSingleSection ? 1 : Math.max(0, originalQuantity - returnedPartCount),
        acceptedVolume: receipt.accepted,
        returnQuantity: splitSingleSection ? 1 : returnedPartCount,
        returnVolume: receipt.returned
      });
      if (globalThis.VseCheck.evaluateReceiptDecisions(form).actRequiredRows.length) {
        document.getElementById('extinguish-note').textContent += ' По допустимым расхождениям будет сформирован акт.';
      }
      openModal(extinguish);
      return;
    }
    fillFull();
    if (receipt.decision === 'accept-all-report') {
      document.getElementById('extinguish-method-value').textContent = 'Полное гашение с актом';
      document.getElementById('extinguish-note').textContent = 'Партия будет принята полностью. По указанным расхождениям будет сформирован акт.';
    }
    openModal(extinguish);
  });
  document.getElementById('confirm-check').addEventListener('click', completeCheck);
  document.getElementById('cancel-check').addEventListener('click', () => dialog.close());
  document.getElementById('extinguish-confirm').addEventListener('click', () => { closeModal(extinguish); completeCheck(); });
  document.getElementById('refusal-confirm').addEventListener('click', () => { closeModal(refusal); completeCheck(); });
  document.getElementById('logout').addEventListener('click', () => { window.location.href = 'login.html'; });
})();
