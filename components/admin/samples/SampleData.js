(() => {
  const api = globalThis.VseSampleAccounting ||= {};
  const STORAGE_KEY = 'vse-sample-accounting-demo-v1';

  const productTypes = Object.freeze([
    ['mutton', 'Баранина'], ['buffalo', 'Буйволятина'], ['beef', 'Говядина'], ['goat', 'Козлятина'],
    ['horse', 'Конина'], ['camel', 'Мясо верблюда'], ['wild-animals', 'Мясо диких животных; рептилий и др.'],
    ['wild-birds', 'Мясо диких птиц'], ['kangaroo', 'Мясо кенгуру'], ['rabbit', 'Мясо кролика'],
    ['marine-animals', 'Мясо морских животных'], ['nutria', 'Мясо нутрий'], ['poultry', 'Мясо птицы'],
    ['uncontrolled', 'Неподконтрольная продукция'], ['pork', 'Свинина'],
    ['beef-offal', 'Субпродукты и жиры говяжьи'], ['horse-offal', 'Субпродукты и жиры конские'],
    ['poultry-offal', 'Субпродукты и жиры птицы'], ['pork-offal', 'Субпродукты и жиры свиные'],
    ['small-ruminant-offal', 'Субпродукты мелкого рогатого скота'],
  ].map(([key, label]) => Object.freeze({ key, label })));

  const baseSamples = Object.freeze([
    ['s-001', 'beef', .8, '02.11.2026', 'RU016:261102-010811', 'Анна Кузнецова', 'ВСЭ № 1284', false],
    ['s-002', 'beef', 1.2, '03.11.2026', 'RU016:261103-010902', 'Ильдар Сафин', 'ВСЭ № 1291', false],
    ['s-003', 'beef', .65, '04.11.2026', 'RU016:261104-011008', 'Анна Кузнецова', 'ВСЭ удалена', true],
    ['s-004', 'pork', .8, '01.11.2026', 'RU016:261101-010744', 'Гузель Гарифуллина', 'ВСЭ № 1276', false],
    ['s-005', 'pork', .9, '04.11.2026', 'RU016:261104-011026', 'Анна Кузнецова', 'ВСЭ № 1294', false],
    ['s-006', 'mutton', 1.1, '31.10.2026', 'RU016:261031-010620', 'Ильдар Сафин', 'ВСЭ № 1268', false],
    ['s-007', 'beef-offal', 2.4, '29.10.2026', 'RU016:261029-010414', 'Гузель Гарифуллина', 'ВСЭ № 1253', false],
    ['s-008', 'poultry', .75, '04.11.2026', 'RU016:261104-011039', 'Анна Кузнецова', 'ВСЭ № 1297', false],
    ['s-009', 'horse', 1.35, '30.10.2026', 'RU016:261030-010501', 'Ильдар Сафин', 'ВСЭ № 1261', false],
  ].map(([id, productKey, weight, sampledAt, vsdNumber, performer, vseLabel, vseDeleted]) => Object.freeze({
    id, laboratoryId: 'lab-kazan-1', productKey, weight, sampledAt, vsdNumber, performer, vseLabel, vseDeleted,
  })));

  const baseDisposals = Object.freeze([
    { id: 'd-001', laboratoryId: 'lab-kazan-1', productKey: 'goat', weight: 4.2, disposedAt: '18.10.2026', vsdNumber: 'RU016:261018-009204', performer: 'Анна Кузнецова' },
    { id: 'd-002', laboratoryId: 'lab-kazan-1', productKey: 'rabbit', weight: 2.6, disposedAt: '04.10.2026', vsdNumber: 'RU016:261004-008772', performer: 'Ильдар Сафин' },
    { id: 'd-003', laboratoryId: 'lab-kazan-1', productKey: 'pork-offal', weight: 6.75, disposedAt: '19.09.2026', vsdNumber: 'RU016:260919-008113', performer: 'Гузель Гарифуллина' },
  ]);

  const readStore = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { disposedSampleIds: Array.isArray(value.disposedSampleIds) ? value.disposedSampleIds : [], disposals: Array.isArray(value.disposals) ? value.disposals : [] };
    } catch { return { disposedSampleIds: [], disposals: [] }; }
  };
  const writeStore = value => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Макет остаётся рабочим в пределах вкладки. */ } };
  const clone = value => structuredClone(value);
  const productLabel = key => productTypes.find(item => item.key === key)?.label || 'Неизвестный вид продукции';
  const labSamples = laboratoryId => {
    if (laboratoryId === 'lab-kazan-1') return baseSamples;
    const seed = Math.max(1, (globalThis.VseReports?.laboratories || []).findIndex(item => item.id === laboratoryId) + 1);
    return baseSamples.slice(0, Math.max(3, 9 - seed)).map((item, index) => ({ ...item, id: `${laboratoryId}-${item.id}`, laboratoryId, weight: Number((item.weight * (1 + seed * .08)).toFixed(2)), vsdNumber: `RU016:26110${(index + seed) % 5 + 1}-${String(10800 + seed * 31 + index).padStart(6, '0')}` }));
  };

  api.productTypes = productTypes;
  api.productLabel = productLabel;
  api.getAvailableSamples = laboratoryId => {
    const store = readStore();
    return labSamples(laboratoryId).filter(item => !store.disposedSampleIds.includes(item.id)).map(clone);
  };
  api.getDisposals = laboratoryId => {
    const store = readStore();
    return [...baseDisposals, ...store.disposals].filter(item => item.laboratoryId === laboratoryId).map(clone);
  };
  api.getBalances = laboratoryId => {
    const samples = api.getAvailableSamples(laboratoryId);
    return productTypes.map(product => {
      const items = samples.filter(item => item.productKey === product.key);
      return {
        productKey: product.key,
        productLabel: product.label,
        count: items.length,
        weight: Number(items.reduce((sum, item) => sum + item.weight, 0).toFixed(3)),
        latest: items.map(item => item.sampledAt).sort((a, b) => b.split('.').reverse().join('').localeCompare(a.split('.').reverse().join('')))[0] || '—',
      };
    });
  };
  api.registerDisposal = ({ laboratoryId, productKey, date, vsdNumber, expectedWeight }) => {
    const samples = api.getAvailableSamples(laboratoryId).filter(item => item.productKey === productKey);
    const currentWeight = Number(samples.reduce((sum, item) => sum + item.weight, 0).toFixed(3));
    if (!currentWeight) throw Object.assign(new Error('Остаток уже утилизирован'), { code: 'NO_BALANCE', currentWeight: 0 });
    if (Math.abs(currentWeight - Number(expectedWeight)) > .0001) throw Object.assign(new Error('Остаток изменился'), { code: 'STALE_BALANCE', currentWeight });
    const store = readStore();
    store.disposedSampleIds.push(...samples.map(item => item.id).filter(id => !store.disposedSampleIds.includes(id)));
    const disposal = { id: `d-${Date.now()}`, laboratoryId, productKey, weight: currentWeight, disposedAt: date, vsdNumber: vsdNumber.trim(), performer: 'Елена Морозова' };
    store.disposals.push(disposal);
    writeStore(store);
    return clone(disposal);
  };
  api.resetDemo = () => { try { localStorage.removeItem(STORAGE_KEY); } catch { /* Нечего сбрасывать. */ } };
})();
