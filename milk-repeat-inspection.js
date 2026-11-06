(() => {
  document.getElementById('logout')?.addEventListener('click', () => { window.location.href = 'login.html'; });
  const form = document.getElementById('inspection-form');
  const error = document.getElementById('inspection-error');
  const id = new URLSearchParams(location.search).get('party') || '204';
  const party = window.MILK_ACCEPTED_PARTIES.find(item => item['vse-number'] === id);
  if (!party) {
    error.hidden = false;
    error.textContent = 'Партия не найдена. Вернитесь к принятым поступлениям.';
    form.querySelector('[type="submit"]').disabled = true;
    return;
  }
  const set = (id, value) => document.getElementById(id).value = value;
  set('enterprise', party.owner);
  set('owner', party.owner);
  set('evsd', party.number);
  set('vse-record', `№ ${id} от ${party['vse-date'].slice(0,10)}`);
  set('product', party.product);
  set('batch-weight', party.amount);
  ['enterprise','owner','evsd','vse-record','product','batch-weight'].forEach(id => document.getElementById(id).readOnly = true);
  const amount = Number(party.amount.split(' ')[0].replace(',', '.'));
  const unit = party.unit === 'kg' ? 'кг' : 'л';
  const remaining = document.getElementById('remaining-weight');
  remaining.type = 'number';
  remaining.min = '0';
  remaining.max = String(amount);
  remaining.step = 'any';
  remaining.value = amount;
  form.querySelector('label[for="remaining-weight"]').innerHTML = `Остаток партии, ${unit} <span class="req">*</span>`;
  document.getElementById('created-at').min = party.date;
  const toggles = [...form.querySelectorAll('[data-test-toggle]')];
  const total = () => toggles.filter(toggle => toggle.checked).reduce((sum, toggle) => sum + Number(toggle.dataset.cost), 0);
  function updateTest(toggle) {
    toggle.closest('.research').querySelectorAll('.result input, .result select').forEach(control => {
      control.disabled = !toggle.checked;
      control.required = toggle.checked;
      control.removeAttribute('aria-invalid');
    });
    document.getElementById('inspection-cost').textContent = total().toLocaleString('ru-RU') + ' ₽';
  }
  toggles.forEach(toggle => { updateTest(toggle); toggle.addEventListener('change', () => updateTest(toggle)); });
  form.addEventListener('input', event => event.target.removeAttribute('aria-invalid'));
  form.addEventListener('change', event => event.target.removeAttribute('aria-invalid'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (form.querySelector('[type="submit"]').disabled) return;
    const invalid = [...form.querySelectorAll('input,select,textarea')].filter(control => !control.disabled && !control.validity.valid);
    invalid.forEach(control => { control.setAttribute('aria-invalid', 'true'); control.setAttribute('aria-describedby', 'inspection-error'); });
    if (invalid.length || !toggles.some(toggle => toggle.checked)) {
      error.hidden = false;
      error.textContent = invalid.length ? 'Заполните обязательные поля и проверьте остаток партии.' : 'Выберите хотя бы одно исследование.';
      (invalid[0] || toggles[0]).focus();
      return;
    }
    const inspection = {
      id: Date.now().toString(36), party: id,
      date: document.getElementById('created-at').value,
      author: document.getElementById('specialist').value,
      remaining: remaining.value, unit,
      decision: document.getElementById('result').value,
      comment: document.getElementById('comment').value,
      address: document.getElementById('address').value,
      storage: document.getElementById('storage').value,
      cost: total(),
      tests: toggles.filter(toggle => toggle.checked).map(toggle => ({name: toggle.closest('label').textContent.trim(), value: toggle.closest('.research').querySelector('.result input,.result select').value}))
    };
    try {
      const stored = JSON.parse(localStorage.getItem('vse-milk-repeat-inspections') || '[]');
      const inspections = Array.isArray(stored) ? stored : [];
      inspections.push(inspection);
      localStorage.setItem('vse-milk-repeat-inspections', JSON.stringify(inspections));
      form.querySelector('[type="submit"]').disabled = true;
      window.location.href = 'arrivals-accepted-milk.html';
    } catch {
      error.hidden = false;
      error.textContent = 'Не удалось сохранить осмотр. Проверьте доступ к локальному хранилищу и повторите.';
    }
  });
})();
