(() => {
  const api = globalThis.VseReports ||= {};
  const STORAGE_KEY = 'vse-admin-reports-demo-v1';

  const laboratories = Object.freeze([
    { id: 'lab-kazan-1', name: 'Лаборатория ВСЭ №1 г. Казань', address: 'Республика Татарстан, г. Казань, ул. Аграрная, д. 2', hasData: true },
    { id: 'lab-kazan-2', name: 'Лаборатория ВСЭ №2 г. Казань', address: 'Республика Татарстан, г. Казань, ул. Ветеринарная, д. 14', hasData: true },
    { id: 'lab-nab-chelny', name: 'Лаборатория ВСЭ Центрального рынка г. Набережные Челны', address: 'Республика Татарстан, г. Набережные Челны, пр-т Мира, д. 31', hasData: true },
    { id: 'lab-almetyevsk', name: 'Альметьевская районная лаборатория ВСЭ', address: 'Республика Татарстан, г. Альметьевск, ул. Производственная, д. 8', hasData: true },
    { id: 'lab-nizhnekamsk', name: 'Нижнекамская городская лаборатория ВСЭ', address: 'Республика Татарстан, г. Нижнекамск, ул. Чистопольская, д. 5', hasData: true },
    { id: 'lab-bugulma', name: 'Бугульминская межрайонная лаборатория ВСЭ', address: 'Республика Татарстан, г. Бугульма, ул. Якупова, д. 17', hasData: true },
    { id: 'lab-zelenodolsk', name: 'Зеленодольская районная лаборатория ВСЭ', address: 'Республика Татарстан, г. Зеленодольск, ул. Новая, д. 4', hasData: false },
  ]);

  const columns = Object.freeze([
    { key: 'cattle', label: 'Крупный рогатый скот, яки, буйволы' },
    { key: 'pigs', label: 'Свиньи' },
    { key: 'sheep', label: 'Овцы, козы' },
    { key: 'rabbits', label: 'Кролики, нутрии' },
    { key: 'chickens', label: 'Куры' },
    { key: 'otherBirds', label: 'Другие виды птицы' },
    { key: 'fish', label: 'Рыба' },
    { key: 'otherAnimals', label: 'Другие виды животных' },
  ]);

  const rows = Object.freeze([
    [166, '1. Осмотрено (проведено ветеринарно-санитарных экспертиз), всего, единиц,', 'section'],
    [167, 'в том числе: микроскопических'], [168, 'трихинеллоскопий'], [169, 'физико-химических'],
    [170, 'радиометрических'], [171, 'других лабораторных исследований'],
    [172, '2. Проведено специальных лабораторных исследований всего, единиц', 'section'],
    [173, '3. Выявлено случаев болезни при ВСЭ, единиц', 'section'],
    [174, 'Ящур'], [175, 'Сибирская язва'], [176, 'Туберкулез'], [177, 'Бруцеллез'],
    [178, 'Лейкоз'], [179, 'Сап'], [189, 'Оспа'], [190, 'Болезнь Ауески'],
    [191, 'Классическая чума свиней'], [192, 'Болезнь Марека'], [193, 'Цистицеркоз (финноз)'],
    [195, 'Трихинеллез'], [200, 'Миксоматоз'], [205, 'Аэромоноз карповых и лососевых (краснуха)'],
    [206, 'Весенняя виремия карпов'], [207, 'Псевдомоноз'], [208, 'Другие инфекционные болезни'],
    [209, 'Другие инвазионные болезни'], [210, 'Незаразные болезни'],
    [211, '4. Направлено на обезвреживание мяса, тонн', 'section mass'],
    [212, 'из них по туберкулезу', 'mass'], [213, 'лейкозу', 'mass'], [214, 'болезни Марека', 'mass'],
    [215, 'цистицеркозу (финнозу)', 'mass'], [216, 'сальмонеллезу', 'mass'],
    [221, '5. Направлено на обезвреживание субпродуктов, тонн', 'section mass'],
    [222, 'из них по: туберкулезу', 'mass'], [223, 'лейкозу', 'mass'], [224, 'болезни Марека', 'mass'],
    [225, 'цистицеркозу (финнозу)', 'mass'], [226, 'сальмонеллезу', 'mass'],
    [231, '6. Направлено на утилизацию мяса, тонн', 'section mass'],
    [232, 'из них по: туберкулезу', 'mass'], [233, 'лейкозу', 'mass'], [234, 'болезни Марека', 'mass'],
    [235, 'цистицеркозу (финнозу)', 'mass'],
    [240, '7. Направлено на уничтожение, тонн', 'section mass'],
    [241, 'из них: мяса', 'mass'], [242, 'субпродуктов', 'mass'],
  ].map(([line, label, flags = '']) => Object.freeze({ line, label, section: flags.includes('section'), mass: flags.includes('mass') })));

  const reportPeriods = Object.freeze([
    { year: 2026, half: 1 }, { year: 2025, half: 2 }, { year: 2025, half: 1 },
    { year: 2024, half: 2 }, { year: 2024, half: 1 },
  ]);

  const periodLabel = ({ year, half }) => `${half === 1 ? 'I' : 'II'} полугодие ${year}`;
  const periodBounds = ({ year, half }) => half === 1
    ? { start: `01.01.${year}`, end: `30.06.${year}` }
    : { start: `01.07.${year}`, end: `31.12.${year}` };

  const matrixFor = (seed = 1, vseCount = 0) => {
    const values = {};
    rows.forEach(row => {
      values[row.line] = {};
      columns.forEach(column => { values[row.line][column.key] = row.mass ? 0 : 0; });
    });
    const cattle = Math.max(1, Math.round(vseCount * .46));
    const pigs = Math.max(1, Math.round(vseCount * .32));
    const sheep = Math.max(0, vseCount - cattle - pigs);
    Object.assign(values[166], { cattle, pigs, sheep });
    Object.assign(values[167], { cattle: Math.round(cattle * .72), pigs: Math.round(pigs * .66), sheep: Math.round(sheep * .55) });
    Object.assign(values[168], { pigs });
    Object.assign(values[169], { cattle: Math.round(cattle * .38), pigs: Math.round(pigs * .41), sheep: Math.round(sheep * .35) });
    Object.assign(values[170], { cattle: seed % 3, pigs: (seed + 1) % 2, sheep: 0 });
    Object.assign(values[171], { cattle: seed % 5, pigs: seed % 4, sheep: seed % 3 });
    Object.assign(values[172], { cattle: seed % 7, pigs: (seed + 2) % 6, sheep: seed % 3 });
    Object.assign(values[173], { cattle: seed % 4, pigs: (seed + 1) % 4, sheep: seed % 2 });
    if (seed % 2) values[193].cattle = 1;
    if (seed % 3 === 0) values[195].pigs = 1;
    if (seed % 4 === 0) values[210].cattle = 1;
    const neutralized = Number((.18 + seed * .007).toFixed(3));
    values[211].pigs = neutralized;
    values[215].cattle = seed % 2 ? Number((neutralized / 2).toFixed(3)) : 0;
    values[216].pigs = seed % 3 === 0 ? Number((neutralized / 3).toFixed(3)) : 0;
    values[231].cattle = seed % 4 === 0 ? .042 : 0;
    values[240].pigs = seed % 5 === 0 ? .018 : 0;
    values[241].pigs = values[240].pigs;
    return values;
  };

  const codesFor = seed => ({
    okud: `060${9300 + seed}`,
    okpo: `4862${String(1000 + seed).padStart(4, '0')}`,
    okved: '75.00',
    oktmo: `92701${String(100000 + seed).slice(-6)}`,
    okogu: '2300219',
    okopf: '75404',
    okfs: '13',
  });

  const createBaseReports = () => {
    const activeLabs = laboratories.filter(lab => lab.hasData);
    const items = [];
    let seed = 1;
    activeLabs.forEach((laboratory, labIndex) => {
      reportPeriods.forEach((period, periodIndex) => {
        if ((labIndex === 4 && periodIndex === 0) || (labIndex === 5 && periodIndex < 2)) return;
        const vseCount = 148 + ((seed * 37) % 420);
        const day = 3 + ((seed * 3) % 20);
        const month = period.half === 1 ? 7 : 1;
        items.push({
          id: `report-${period.year}-${period.half}-${laboratory.id}`,
          type: '5-vet-iii', laboratoryId: laboratory.id, laboratoryName: laboratory.name,
          laboratoryAddress: laboratory.address, year: period.year, half: period.half,
          periodLabel: periodLabel(period), ...periodBounds(period), vseCount,
          formedAt: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${period.half === 1 ? period.year : period.year + 1} ${String(8 + seed % 9).padStart(2, '0')}:${String((seed * 7) % 60).padStart(2, '0')}`,
          formedAtSort: `${period.half === 1 ? period.year : period.year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(8 + seed % 9).padStart(2, '0')}:${String((seed * 7) % 60).padStart(2, '0')}:00`,
          codes: codesFor(seed), values: matrixFor(seed, vseCount), calculationVersion: 'demoCalculation-v1',
        });
        seed += 1;
      });
    });
    return items;
  };

  const baseReports = Object.freeze(createBaseReports());
  const readStore = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { created: Array.isArray(parsed.created) ? parsed.created : [], deleted: Array.isArray(parsed.deleted) ? parsed.deleted : [] };
    } catch { return { created: [], deleted: [] }; }
  };
  const writeStore = store => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* Session remains usable without persistence. */ } };

  api.laboratories = laboratories;
  api.columns = columns;
  api.rows = rows;
  api.periods = reportPeriods;
  api.periodLabel = periodLabel;
  api.periodBounds = periodBounds;
  api.createDemoMatrix = matrixFor;
  api.createDemoReports = () => {
    const store = readStore();
    return [...baseReports.filter(report => !store.deleted.includes(report.id)), ...store.created].map(report => structuredClone(report));
  };
  api.getReport = id => api.createDemoReports().find(report => report.id === id) || null;
  api.getAvailablePeriods = laboratoryId => {
    const occupied = new Set(api.createDemoReports().filter(report => report.laboratoryId === laboratoryId).map(report => `${report.year}-${report.half}`));
    return reportPeriods.filter(period => !occupied.has(`${period.year}-${period.half}`));
  };
  api.buildPreview = ({ laboratoryId, year, half }) => {
    const laboratory = laboratories.find(item => item.id === laboratoryId);
    if (!laboratory) throw Object.assign(new Error('Лаборатория не найдена'), { code: 'LAB_NOT_FOUND' });
    if (!laboratory.hasData) throw Object.assign(new Error('Нет данных для формирования отчёта'), { code: 'NO_DATA' });
    if (api.createDemoReports().some(report => report.laboratoryId === laboratoryId && report.year === Number(year) && report.half === Number(half))) {
      throw Object.assign(new Error('Отчёт за этот период уже создан'), { code: 'DUPLICATE' });
    }
    const vseCount = 286 + (laboratoryId.length * 7);
    const period = { year: Number(year), half: Number(half) };
    return {
      type: '5-vet-iii', laboratoryId, laboratoryName: laboratory.name, laboratoryAddress: laboratory.address,
      ...period, periodLabel: periodLabel(period), ...periodBounds(period), vseCount,
      values: matrixFor(laboratoryId.length, vseCount), calculationVersion: 'demoCalculation-v1',
    };
  };
  api.saveReport = preview => {
    if (api.createDemoReports().some(report => report.laboratoryId === preview.laboratoryId && report.year === Number(preview.year) && report.half === Number(preview.half))) {
      throw Object.assign(new Error('Отчёт за этот период уже создан'), { code: 'DUPLICATE' });
    }
    const now = new Date();
    const formedAt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(now).replace(',', '');
    const report = { ...structuredClone(preview), id: `report-created-${Date.now()}`, formedAt, formedAtSort: now.toISOString() };
    const store = readStore();
    store.created.push(report);
    writeStore(store);
    return structuredClone(report);
  };
  api.deleteReport = id => {
    const store = readStore();
    store.created = store.created.filter(report => report.id !== id);
    if (baseReports.some(report => report.id === id) && !store.deleted.includes(id)) store.deleted.push(id);
    writeStore(store);
  };
})();
