(() => {
  if (document.body.dataset.milkStage !== 'accepted') return;
  const notify = message => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2600);
  };
  const menus = [...document.querySelectorAll('.conclusion-menu')];
  const inspectionMenus = [...document.querySelectorAll('.inspection-menu')];
  menus.forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) menus.filter(other => other !== menu).forEach(other => other.open = false);
  }));
  inspectionMenus.forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) inspectionMenus.filter(other => other !== menu).forEach(other => other.open = false);
  }));
  document.addEventListener('click', event => {
    menus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
    inspectionMenus.forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      menus.forEach(menu => menu.open = false);
      inspectionMenus.forEach(menu => menu.open = false);
    }
  });

  const printImage = document.getElementById('print-image');
  let printing = false;
  document.querySelectorAll('.conclusion-print').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    link.closest('.conclusion-menu').open = false;
    if (printing) return;
    printing = true;
    link.setAttribute('aria-busy', 'true');
    const finish = () => { printing = false; link.removeAttribute('aria-busy'); };
    const openPrint = () => {
      finish();
      printImage.onload = null;
      printImage.onerror = null;
      window.print();
    };
    printImage.onload = openPrint;
    printImage.onerror = () => { finish(); printImage.onload = null; printImage.onerror = null; notify('Не удалось загрузить заключение для печати'); };
    printImage.src = link.dataset.conclusionFile;
    if (printImage.complete && printImage.naturalWidth) openPrint();
  }));
  document.querySelectorAll('.conclusion-download').forEach(link => link.addEventListener('click', () => {
    link.closest('.conclusion-menu').open = false;
    notify('Скачивание заключения начато');
  }));

  const demoInspections = [
    { party:'204', date:'2026-08-14T10:20', decision:'Пригодно', author:'Анна Кузнецова', remaining:'120', unit:'л', cost:'300', comment:'Условия хранения соблюдены, показатели партии соответствуют требованиям.' },
    { party:'204', date:'2026-08-17T09:15', decision:'Пригодно', author:'Ильдар Сафин', remaining:'86', unit:'л', cost:'300', comment:'Условия хранения соблюдены, показатели партии соответствуют требованиям.' },
    { party:'882', date:'2026-08-14T11:30', decision:'Пригодно', author:'Анна Кузнецова', remaining:'438,0', unit:'кг', cost:'400', comment:'Условия хранения соблюдены, показатели партии соответствуют требованиям.' },
    { party:'882', date:'2026-08-18T08:45', decision:'Пригодно', author:'Ильдар Сафин', remaining:'312,6', unit:'кг', cost:'400', comment:'Условия хранения соблюдены, показатели партии соответствуют требованиям.' }
  ];
  let inspections = [...demoInspections];
  try {
    const stored = JSON.parse(localStorage.getItem('vse-milk-repeat-inspections') || '[]');
    if (Array.isArray(stored)) inspections.push(...stored.filter(item => item && ['party','date','decision','author','remaining'].every(key => typeof item[key] === 'string')));
  } catch { /* No saved inspections in this mockup session. */ }
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const displayDate = value => value ? `${value.slice(8,10)}.${value.slice(5,7)}.${value.slice(0,4)} ${value.slice(11,16)}` : '—';
  const inspectionDialog = document.getElementById('milk-inspection-summary');
  const inspectionFields = document.getElementById('milk-inspection-fields');
  if (inspectionDialog) {
  const inspectionDetailPages = {
    '204': 'additional-vet-inspection-view-milk-204.html',
    '882': 'additional-vet-inspection-view-882.html'
  };
  const inspectionComment = 'Условия хранения соблюдены, показатели партии соответствуют требованиям.';
  let inspectionTrigger;
  document.addEventListener('click', event => {
    const button = event.target.closest('.inspection-view');
    if (!button) return;
    event.preventDefault();
    inspectionTrigger = button;
    const card = button.closest('.accepted-row');
    button.closest('.inspection-menu').open = false;
    const items = inspections
      .filter(item => String(item.party) === card?.dataset.vseNumber)
      .sort((a,b) => a.date.localeCompare(b.date));
    if (!items.length) {
      notify('Повторные ветосмотры пока не добавлены');
      return;
    }
    inspectionFields.innerHTML = items.map((item,index) => {
      const detailHref = index === 0 ? inspectionDetailPages[String(item.party)] : '';
      const openTag = detailHref
        ? `<a class="inspection-history-card is-link" href="${detailHref}" aria-label="Открыть карточку ветосмотра ${index + 1}">`
        : '<article class="inspection-history-card">';
      const closeTag = detailHref ? '</a>' : '</article>';
      return `
      ${openTag}
        <div class="inspection-history-head"><div class="inspection-history-title"><span>Ветосмотр ${index + 1}</span>${detailHref ? '<span class="inspection-history-open" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"></path></svg></span>' : ''}</div><time datetime="${escape(item.date)}">${escape(displayDate(item.date))}</time></div>
        <dl>
          <div><dt>Специалист</dt><dd>${escape(item.author)}</dd></div>
          <div><dt>Результат осмотра</dt><dd>${escape(item.decision)}</dd></div>
          <div><dt>Остаток партии</dt><dd>${escape(item.remaining)} ${escape(item.unit)}</dd></div>
          <div><dt>Стоимость</dt><dd>${escape(item.cost)} ₽</dd></div>
          <div class="wide"><dt>Комментарий</dt><dd>${escape(inspectionComment)}</dd></div>
        </dl>
      ${closeTag}`;
    }).join('');
    inspectionDialog.showModal();
  });
  inspectionDialog.querySelectorAll('[data-close-inspection]').forEach(button => button.addEventListener('click', () => inspectionDialog.close()));
  inspectionDialog.addEventListener('click', event => { if (event.target === inspectionDialog) inspectionDialog.close(); });
  inspectionDialog.addEventListener('close', () => inspectionTrigger?.focus());
  }
})();
