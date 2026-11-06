(() => {
  const admin = globalThis.VseAdmin ||= {};
  const store = globalThis.VseAdminDemo ||= {};
  const STORAGE_KEY = 'vse-admin-demo-v1';
  const memory = { users: [], operations: {}, overrides: {}, deletedUsers: [] };
  store.config = Object.freeze({ passwordPolicy: globalThis.VseAuth?.demoPasswordPolicy ?? null });

  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        users: Array.isArray(value.users) ? value.users : [],
        operations: value.operations || {},
        overrides: value.overrides || {},
        deletedUsers: Array.isArray(value.deletedUsers) ? value.deletedUsers : [],
      };
    } catch { return memory; }
  };
  const write = value => {
    memory.users = value.users;
    memory.operations = value.operations;
    memory.overrides = value.overrides || {};
    memory.deletedUsers = value.deletedUsers || [];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); return 'persistent'; } catch { return 'session'; }
  };
  const allUsers = state => [
    ...admin.createDemoUsers().map(user => state.overrides?.[user.id] ? { ...user, ...state.overrides[user.id] } : user),
    ...state.users,
  ].filter(user => !state.deletedUsers?.some(deleted => deleted.id === user.id));
  const persistUser = (state, user) => {
    const index = state.users.findIndex(item => item.id === user.id);
    if (index >= 0) state.users[index] = user;
    else state.overrides[user.id] = user;
  };
  const wait = duration => new Promise(resolve => setTimeout(resolve, duration));

  const operationKey = () => globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  store.createUser = async (payload, { operationId = operationKey(), failCreate = false } = {}) => {
    const state = read();
    if (state.operations[operationId]) return state.operations[operationId];
    await wait(650);
    if (failCreate) throw Object.assign(new Error('Не удалось создать пользователя. Повторите попытку.'), { code: 'network' });
    const login = payload.login.trim().toLocaleLowerCase('ru-RU');
    const email = payload.email.trim().toLocaleLowerCase('ru-RU');
    const duplicate = allUsers(state).find(user => user.login.toLocaleLowerCase('ru-RU') === login || user.email.toLocaleLowerCase('ru-RU') === email);
    if (duplicate) {
      const fields = {};
      if (duplicate.login.toLocaleLowerCase('ru-RU') === login) fields.login = 'Пользователь с таким логином уже существует.';
      if (duplicate.email.toLocaleLowerCase('ru-RU') === email) fields.email = 'Пользователь с таким email уже существует.';
      throw Object.assign(new Error('Проверьте уникальность логина и email.'), { code: 'duplicate', fields });
    }
    const policyError = globalThis.VseAuth?.demoPasswordPolicy?.describe(payload.password) || '';
    if (policyError) throw Object.assign(new Error(policyError), { code: 'validation', fields: { password: policyError } });
    const now = new Date().toISOString();
    const user = {
      id: `u-${Date.now()}`,
      laboratoryId: 'lab-kazan-1',
      name: payload.name.trim(),
      login: payload.login.trim(),
      email: payload.email.trim(),
      position: payload.position.trim(),
      permissions: [...payload.permissions],
      products: [...payload.products],
      status: 'active',
      createdAt: now,
      activatedAt: now,
      version: 1,
      accountType: 'user',
      linkedDocumentCount: 0,
      history: [historyEntry('created', 'Елена Морозова', {
        permissions: [...payload.permissions], products: [...payload.products],
      })],
    };
    state.users.push(user);
    const result = { user, operationId };
    state.operations[operationId] = result;
    const storageMode = write(state);
    return { ...result, storageMode };
  };

  store.getUsers = () => allUsers(read()).map(user => ({ ...user, products: [...user.products], permissions: [...(user.permissions || [])] }));

  const assertDeletableScope = user => {
    if (!user) throw Object.assign(new Error('Пользователь не найден.'), { code: 'not-found' });
    if (user.laboratoryId !== 'lab-kazan-1' || user.accountType === 'admin') {
      throw Object.assign(new Error('Удаление этой учётной записи недоступно.'), { code: 'forbidden' });
    }
  };

  store.checkUserDeletion = async (id, { fail = false } = {}) => {
    await wait(520);
    if (fail) throw Object.assign(new Error('Не удалось проверить связанные документы.'), { code: 'network' });
    const user = allUsers(read()).find(item => item.id === id);
    assertDeletableScope(user);
    return {
      user: { ...user, products: [...(user.products || [])], permissions: [...(user.permissions || [])] },
      linkedDocumentCount: Number(user.linkedDocumentCount) || 0,
      checkedAt: new Date().toISOString(),
    };
  };

  store.deleteUser = async (id, {
    operationId = operationKey(), expectedVersion, actor = 'Елена Морозова',
    fail = false, documentAppeared = false,
  } = {}) => {
    const initial = read();
    if (initial.operations[operationId]) return initial.operations[operationId];
    await wait(650);
    if (fail) throw Object.assign(new Error('Не удалось удалить пользователя. Повторите попытку.'), { code: 'network' });
    const state = read();
    if (state.operations[operationId]) return state.operations[operationId];
    const stored = allUsers(state).find(item => item.id === id);
    assertDeletableScope(stored);
    const user = { ...stored, products: [...(stored.products || [])], permissions: [...(stored.permissions || [])], history: [...(stored.history || [])] };
    if (Number.isInteger(expectedVersion) && user.version !== expectedVersion) {
      throw Object.assign(new Error('Данные пользователя изменены в другом окне.'), { code: 'version-conflict', user });
    }
    const linkedDocumentCount = documentAppeared ? Math.max(1, Number(user.linkedDocumentCount) || 0) : Number(user.linkedDocumentCount) || 0;
    if (linkedDocumentCount > 0) {
      user.linkedDocumentCount = linkedDocumentCount;
      persistUser(state, user);
      write(state);
      throw Object.assign(new Error('У пользователя появились связанные рабочие документы.'), {
        code: 'linked-documents', user, linkedDocumentCount,
      });
    }
    const now = new Date().toISOString();
    user.deleted = true;
    user.deletedAt = now;
    user.version = (user.version || 1) + 1;
    user.history.push(historyEntry('deleted', actor, {
      previousStatus: stored.status, userId: stored.id, userName: stored.name,
    }));
    state.deletedUsers.push(user);
    state.users = state.users.filter(item => item.id !== id);
    delete state.overrides[id];
    const result = { user, operationId, deletedAt: now };
    state.operations[operationId] = result;
    write(state);
    return result;
  };

  store.getDeletedUser = id => {
    const user = read().deletedUsers.find(item => item.id === id);
    return user ? { ...user, history: [...(user.history || [])] } : null;
  };

  store.setUserBlocked = async (id, blocked, {
    operationId = operationKey(), expectedStatus, actor = 'Елена Морозова',
    fail = false, unavailable = false,
  } = {}) => {
    const initial = read();
    if (initial.operations[operationId]) return initial.operations[operationId];
    await wait(650);
    if (fail) throw Object.assign(new Error('Не удалось изменить статус пользователя. Повторите попытку.'), { code: 'network' });
    const state = read();
    if (state.operations[operationId]) return state.operations[operationId];
    if (unavailable) throw Object.assign(new Error('Пользователь больше недоступен.'), { code: 'unavailable' });
    const stored = allUsers(state).find(item => item.id === id);
    if (!stored) throw Object.assign(new Error('Пользователь не найден.'), { code: 'not-found' });
    const user = { ...stored, products: [...(stored.products || [])], permissions: [...(stored.permissions || [])], history: [...(stored.history || [])] };
    if (expectedStatus && user.status !== expectedStatus) {
      throw Object.assign(new Error('Состояние пользователя изменилось.'), { code: 'status-conflict', user });
    }
    const targetStatus = blocked ? 'blocked' : 'active';
    if (user.status === targetStatus) {
      const result = { user, operationId, unchanged: true };
      state.operations[operationId] = result;
      write(state);
      return result;
    }
    const now = new Date().toISOString();
    user.status = targetStatus;
    user.version = (user.version || 1) + 1;
    user.history.push(historyEntry(blocked ? 'blocked' : 'unblocked', actor, {
      previousStatus: stored.status, status: targetStatus,
      sessionsTerminated: blocked,
    }));
    persistUser(state, user);
    const result = { user, operationId, unchanged: false, at: now };
    state.operations[operationId] = result;
    write(state);
    return result;
  };

  const labelOf = (list, code) => list.find(item => item.code === code)?.label || code;

  const historyEntry = (type, actor, details = {}) => ({
    id: `h-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    actor,
    type,
    ...details,
  });

  const demoUserIds = new Set(admin.createDemoUsers().map(user => user.id));
  const shiftedIso = (base, minutes) => new Date(new Date(base).getTime() + minutes * 60000).toISOString();
  const demoHistory = user => {
    if (!demoUserIds.has(user.id)) return [];
    const base = user.createdAt;
    const events = [
      { id: `${user.id}-created`, type: 'created', at: base, actor: 'Елена Морозова', permissions: ['vse_write'], products: [...user.products] },
      { id: `${user.id}-data`, type: 'update', at: shiftedIso(base, 1720), actor: 'Елена Морозова', changes: [
        { kind: 'field', label: 'Должность', before: 'Ветеринарный фельдшер', after: user.position },
        { kind: 'field', label: 'Email', before: `old.${user.email}`, after: user.email },
      ] },
      { id: `${user.id}-access`, type: 'update', at: shiftedIso(base, 3040), actor: 'Елена Морозова', changes: [
        { kind: 'permissions', added: admin.permissions.map(item => item.label), removed: [] },
        { kind: 'products', added: admin.products.map(item => item.label), removed: [] },
      ] },
      { id: `${user.id}-blocked`, type: 'blocked', at: shiftedIso(base, 4520), actor: 'Елена Морозова', previousStatus: 'active', status: 'blocked', sessionsTerminated: true },
      { id: `${user.id}-unblocked`, type: 'unblocked', at: shiftedIso(base, 4690), actor: 'Елена Морозова', previousStatus: 'blocked', status: 'active' },
    ];
    for (let index = 0; index < 15; index += 1) {
      events.push({
        id: `${user.id}-data-${index + 1}`,
        type: 'update',
        at: shiftedIso(base, 7000 + index * 95),
        actor: index % 2 ? 'Елена Морозова' : 'Системный администратор',
        changes: [{ kind: 'field', label: 'Должность', before: `Ветеринарный врач ${index + 1}`, after: `Ветеринарный врач ${index + 2}` }],
      });
    }
    return events;
  };

  store.getUserHistory = async (id, { fail = false } = {}) => {
    await wait(420);
    if (fail) throw Object.assign(new Error('Не удалось загрузить историю изменений.'), { code: 'network' });
    const state = read();
    const user = allUsers(state).find(item => item.id === id) || state.deletedUsers.find(item => item.id === id);
    if (!user || user.laboratoryId !== 'lab-kazan-1' || user.accountType === 'admin') {
      throw Object.assign(new Error('История недоступна.'), { code: 'forbidden' });
    }
    const events = [...demoHistory(user), ...(user.history || [])];
    const unique = [...new Map(events.map(event => [event.id || `${event.type}-${event.at}`, event])).values()];
    return {
      user: { id: user.id, name: user.name, login: user.login, deleted: Boolean(user.deleted) },
      events: unique.map(event => ({ ...event, changes: event.changes?.map(change => ({ ...change })) })),
    };
  };

  store.getUser = async (id, { forceError = false } = {}) => {
    await wait(360);
    if (forceError) throw Object.assign(new Error('Не удалось загрузить пользователя. Повторите попытку.'), { code: 'network' });
    const state = read();
    const user = allUsers(state).find(item => item.id === id);
    if (!user) throw Object.assign(new Error('Пользователь не найден.'), { code: 'not-found' });
    return {
      ...user,
      permissions: [...(user.permissions || [])],
      products: [...user.products],
    };
  };

  store.updateUser = async (id, patch, { expectedVersion, actor = 'Елена Морозова', failSave = false, staleVersion = false, deletedElsewhere = false } = {}) => {
    await wait(650);
    if (failSave) throw Object.assign(new Error('Не удалось сохранить изменения. Повторите попытку.'), { code: 'network' });
    const state = read();
    const index = state.users.findIndex(item => item.id === id);
    const user = index >= 0 ? state.users[index] : allUsers(state).find(item => item.id === id);
    if (deletedElsewhere) throw Object.assign(new Error('Пользователь удалён. Возврат к списку.'), { code: 'deleted' });
    if (staleVersion || (index >= 0 && Number.isInteger(expectedVersion) && user.version !== expectedVersion)) {
      throw Object.assign(new Error('Данные пользователя изменены в другом окне.'), { code: 'version-conflict' });
    }
    if (!user) throw Object.assign(new Error('Пользователь не найден.'), { code: 'not-found' });
    if (patch.email && patch.email.trim().toLocaleLowerCase('ru-RU') !== user.email.toLocaleLowerCase('ru-RU')) {
      const duplicate = allUsers(state).find(item => item.id !== id && item.email.toLocaleLowerCase('ru-RU') === patch.email.trim().toLocaleLowerCase('ru-RU'));
      if (duplicate) throw Object.assign(new Error('Пользователь с таким email уже существует.'), { code: 'duplicate', fields: { email: 'Пользователь с таким email уже существует.' } });
    }
    const changes = [];
    const textFields = [['name', 'Фамилия и имя'], ['position', 'Должность'], ['email', 'Email']];
    textFields.forEach(([key, label]) => {
      if (patch[key] !== undefined && patch[key].trim() !== user[key]) {
        changes.push({ kind: 'field', label, before: user[key], after: patch[key].trim() });
        user[key] = patch[key].trim();
      }
    });
    const permissionDiff = (before, after) => {
      const added = after.filter(code => !before.includes(code)).map(code => labelOf(admin.permissions, code));
      const removed = before.filter(code => !after.includes(code)).map(code => labelOf(admin.permissions, code));
      return { added, removed };
    };
    const productDiff = (before, after) => {
      const added = after.filter(code => !before.includes(code)).map(code => labelOf(admin.products, code));
      const removed = before.filter(code => !after.includes(code)).map(code => labelOf(admin.products, code));
      return { added, removed };
    };
    if (patch.permissions && (patch.permissions.length !== user.permissions.length || patch.permissions.some(code => !user.permissions.includes(code)))) {
      const before = [...(user.permissions || [])];
      user.permissions = [...patch.permissions];
      changes.push({ kind: 'permissions', ...permissionDiff(before, user.permissions) });
    }
    if (patch.products && (patch.products.length !== user.products.length || patch.products.some(code => !user.products.includes(code)))) {
      const before = [...user.products];
      user.products = [...patch.products];
      changes.push({ kind: 'products', ...productDiff(before, user.products) });
    }
    if (changes.length) {
      user.version = (user.version || 1) + 1;
      user.history = [...(user.history || []), historyEntry('update', actor, { changes })];
    }
    persistUser(state, user);
    write(state);
    return {
      ...user,
      permissions: [...(user.permissions || [])],
      products: [...user.products],
      changes,
    };
  };

  store.reset = () => {
    memory.users = [];
    memory.operations = {};
    memory.overrides = {};
    memory.deletedUsers = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* isolated memory state */ }
  };
})();
