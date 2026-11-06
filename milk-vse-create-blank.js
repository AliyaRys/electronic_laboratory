(() => {
  const compositionRows = document.getElementById('composition-rows');
  compositionRows.innerHTML = '<div class="composition-row"><div><input aria-label="Номер секции" placeholder="Секция 1"></div><div><input aria-label="Объём секции" placeholder="Например, 40 л"></div></div>';
  const studies = [...document.querySelectorAll('.study-card')];
  const isFilled = card => {
    const radios = [...card.querySelectorAll('input[type="radio"]')];
    if (radios.length) return radios.some(field => field.checked);
    return [...card.querySelectorAll('input,select')].every(field => field.value.trim());
  };
  const updateInvoice = () => { if (typeof renderVseInvoice === 'function') renderVseInvoice(studies.filter(isFilled), 100); };
  const form = document.getElementById('vse-form');
  form.addEventListener('input', updateInvoice);
  form.addEventListener('change', updateInvoice);
  updateInvoice();
  const toast = document.getElementById('toast');
  let toastTimer;
  const notice = message => { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('show'); toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); };
  document.getElementById('save-draft').addEventListener('click', () => notice('Черновик ВСЭ сохранён'));
  document.getElementById('cancel').addEventListener('click', () => { location.href = 'arrivals-work-milk.html'; });
  document.getElementById('logout').addEventListener('click', () => { location.href = 'login.html'; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) { notice('Заполните обязательные поля'); return; }
    notice('ВСЭ сохранена');
  });
})();
