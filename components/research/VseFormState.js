(function (global) {
  'use strict';

  const create = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const readStoredBoolean = key => {
    if (!key) return false;
    try {
      return global.localStorage.getItem(key) === 'true';
    } catch (error) {
      return false;
    }
  };

  const bindLabSampleField = (root = document) => {
    const checkbox = root.querySelector('#samples-lab-sent');
    const control = checkbox?.closest('.checkbox-field');
    if (!checkbox || !control) return null;

    const sync = () => control.classList.toggle('is-checked', checkbox.checked);
    checkbox.addEventListener('change', sync);
    sync();
    return { checkbox, control, sync };
  };

  const createFairMarketStatus = () => {
    const status = create('div', 'vse-fair-market-status');
    status.setAttribute('role', 'status');
    status.append(
      create('span', 'vse-fair-market-badge', 'Ярмарка'),
      create('span', 'vse-fair-market-copy', 'Льгота применена при сверке данных. Стоимость услуг для партии — 0 ₽.')
    );
    return status;
  };

  const mountFairMarketInvoice = ({
    section = document.querySelector('.invoice-section'),
    total = document.getElementById('vse-invoice-total'),
    storageKey,
    applied,
  } = {}) => {
    const isApplied = typeof applied === 'boolean' ? applied : readStoredBoolean(storageKey);
    if (isApplied && section && !section.querySelector('.vse-fair-market-status')) {
      const status = createFairMarketStatus();
      const table = section.querySelector('.invoice-table-wrap');
      section.insertBefore(status, table || null);
    }

    return {
      applied: isApplied,
      setTotal(amount, formatter) {
        if (!total) return;
        total.textContent = isApplied ? '0 ₽' : formatter(amount);
      },
    };
  };

  global.VseFormState = Object.freeze({
    bindLabSampleField,
    createFairMarketStatus,
    mountFairMarketInvoice,
  });
})(globalThis);
