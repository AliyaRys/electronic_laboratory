(() => {
  const api = globalThis.VseAdmin ||= {};

  api.products = Object.freeze([
    Object.freeze({ code: 'meat', label: 'Мясо и продукты убоя животных' }),
    Object.freeze({ code: 'raw_milk', label: 'Сырое молоко, сырые сливки, сырое обезжиренное молоко, сырые сливочные и молочные продукты' }),
    Object.freeze({ code: 'eggs', label: 'Яйца сельскохозяйственных птиц, яйцепродукция' }),
    Object.freeze({ code: 'fish', label: 'Рыба, водные беспозвоночные, рыбная продукция' }),
    Object.freeze({ code: 'bee_products', label: 'Мёд, перга и молочко маточное пчелиное' }),
    Object.freeze({ code: 'plant_food', label: 'Растительная пищевая продукция' }),
  ]);

  api.statuses = Object.freeze({
    active: 'Активен',
    blocked: 'Заблокирован',
  });

  api.permissions = Object.freeze([
    Object.freeze({ code: 'vse_write', label: 'Создание и редактирование ВСЭ' }),
    Object.freeze({ code: 'vse_delete', label: 'Удаление ВСЭ' }),
    Object.freeze({ code: 'expected_party_delete', label: 'Удаление ожидаемых партий' }),
    Object.freeze({ code: 'directory_edit', label: 'Редактирование справочников' }),
    Object.freeze({ code: 'directory_delete', label: 'Удаление справочников' }),
  ]);

  api.formLimits = Object.freeze({ name: 160, login: 100, email: 254, position: 160 });

  const people = [
    ['u-1001', 'Алексеева Марина Викторовна', 'alekseeva.marina', 'marina.alekseeva@example.test', 'active', ['meat', 'raw_milk'], '2026-10-20T09:42:00'],
    ['u-1002', 'Бикмуллин Ринат Рашидович', 'bikmullin.rinat', 'rinat.bikmullin@example.test', 'active', ['meat'], '2026-10-19T16:18:00'],
    ['u-1003', 'Валеева Лейсан Илдаровна', 'valeeva.leysan', 'leysan.valeeva@example.test', 'active', ['raw_milk', 'eggs'], '2026-10-18T11:05:00'],
    ['u-1004', 'Гаврилова Ольга Сергеевна', 'gavrilova.olga', 'olga.gavrilova@example.test', 'blocked', ['fish'], '2026-10-17T14:27:00'],
    ['u-1005', 'Давлетшин Марат Рустемович', 'davletshin.marat', 'marat.davletshin@example.test', 'active', ['meat', 'fish', 'plant_food'], '2026-10-16T08:51:00'],
    ['u-1006', 'Егорова Светлана Андреевна', 'egorova.svetlana', 'svetlana.egorova@example.test', 'active', [], '2026-10-15T12:34:00'],
    ['u-1007', 'Журавлёв Денис Игоревич', 'zhuravlev.denis', 'denis.zhuravlev@example.test', 'active', ['bee_products'], '2026-10-14T10:12:00'],
    ['u-1008', 'Зарипова Гульназ Фаридовна', 'zaripova.gulnaz', 'gulnaz.zaripova@example.test', 'active', ['raw_milk'], '2026-10-13T15:46:00'],
    ['u-1009', 'Ибрагимов Тимур Наилевич', 'ibragimov.timur', 'timur.ibragimov@example.test', 'active', ['meat', 'eggs', 'fish', 'bee_products'], '2026-10-12T09:19:00'],
    ['u-1010', 'Калинина Наталья Александровна', 'kalinina.natalia', 'natalia.kalinina@example.test', 'blocked', ['plant_food'], '2026-10-11T13:57:00'],
    ['u-1011', 'Латыпов Айрат Рамилевич', 'latypov.airat', 'airat.latypov@example.test', 'active', ['meat'], '2026-10-10T17:08:00'],
    ['u-1012', 'Мингазова Эльмира Ринатовна', 'mingazova.elmira', 'elmira.mingazova@example.test', 'active', ['raw_milk', 'bee_products'], '2026-10-09T08:23:00'],
    ['u-1013', 'Никитин Павел Олегович', 'nikitin.pavel', 'pavel.nikitin@example.test', 'active', ['fish', 'plant_food'], '2026-10-08T16:44:00'],
    ['u-1014', 'Орлова Ксения Михайловна', 'orlova.ksenia', 'ksenia.orlova@example.test', 'active', ['eggs'], '2026-10-07T11:31:00'],
    ['u-1015', 'Петров Артём Владимирович', 'petrov.artem', 'artem.petrov@example.test', 'blocked', ['meat', 'raw_milk'], '2026-10-06T14:15:00'],
    ['u-1016', 'Рахматуллина Аделя Фанисовна', 'rahmatullina.adelya', 'adelya.rahmatullina@example.test', 'active', ['bee_products', 'plant_food'], '2026-10-05T09:48:00'],
    ['u-1017', 'Сафин Ильдар Раисович', 'safin.ildar', 'ildar.safin@example.test', 'active', ['meat', 'raw_milk', 'eggs'], '2026-10-04T12:06:00'],
    ['u-1018', 'Тихонова Анна Евгеньевна', 'tikhonova.anna', 'anna.tikhonova@example.test', 'active', [], '2026-10-03T15:39:00'],
    ['u-1019', 'Усманов Камиль Рашидович', 'usmanov.kamil', 'kamil.usmanov@example.test', 'active', ['fish'], '2026-10-02T10:54:00'],
    ['u-1020', 'Фёдорова Виктория Павловна', 'fedorova.viktoria', 'viktoria.fedorova@example.test', 'active', ['meat', 'plant_food'], '2026-10-01T08:17:00'],
    ['u-1021', 'Хабибуллин Руслан Маратович', 'khabibullin.ruslan', 'ruslan.khabibullin@example.test', 'blocked', ['raw_milk'], '2026-09-30T16:22:00'],
    ['u-1022', 'Цветкова Екатерина Ильинична', 'tsvetkova.ekaterina', 'ekaterina.tsvetkova@example.test', 'active', ['eggs', 'fish'], '2026-09-29T13:11:00'],
    ['u-1023', 'Чернов Алексей Алексеевич', 'chernov.alexey', 'alexey.chernov@example.test', 'active', ['meat'], '2026-09-28T09:36:00'],
    ['u-1024', 'Шайхутдинова Рената Дамировна', 'shaikhutdinova.renata', 'renata.shaikhutdinova@example.test', 'active', ['bee_products'], '2026-09-27T11:49:00'],
    ['u-1025', 'Щербаков Николай Константинович', 'scherbakov.nikolay', 'nikolay.scherbakov@example.test', 'active', ['plant_food'], '2026-09-26T14:58:00'],
    ['u-1026', 'Юсупова Диана Рустамовна', 'yusupova.diana', 'diana.yusupova@example.test', 'active', ['raw_milk', 'fish', 'bee_products'], '2026-09-25T10:27:00'],
    ['u-1027', 'Яковлев Сергей Дмитриевич', 'yakovlev.sergey', 'sergey.yakovlev@example.test', 'blocked', ['meat', 'eggs'], '2026-09-24T08:43:00'],
    ['u-1028', 'Абдуллина Альбина Рамилевна', 'abdullina.albina', 'albina.abdullina@example.test', 'active', ['meat', 'raw_milk', 'eggs', 'fish', 'bee_products', 'plant_food'], '2026-09-23T17:16:00'],
  ];

  // Project demo fixture for 06-user-delete: these accounts have no linked work documents.
  // The final retention rule must be confirmed before a backend implementation.
  const usersWithoutLinkedDocuments = new Set(['u-1001', 'u-1002', 'u-1007', 'u-1018', 'u-1024']);

  api.createDemoUsers = () => people.map(([id, name, login, email, status, products, createdAt]) => ({
    id,
    laboratoryId: 'lab-kazan-1',
    name,
    login,
    email,
    position: 'Ветеринарный врач',
    permissions: [],
    products: [...products],
    status,
    createdAt,
    activatedAt: createdAt,
    version: 1,
    accountType: 'user',
    linkedDocumentCount: usersWithoutLinkedDocuments.has(id) ? 0 : (Number(id.slice(-2)) % 4) + 1,
  }));
})();
