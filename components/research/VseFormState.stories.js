import './vse-form-state.css';
import './VseFormState.js';

const render = ({ fairMarket }) => {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'width:min(720px,calc(100vw - 32px));font:14px/1.45 Inter,system-ui,sans-serif;color:#17323a';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-bottom:20px';
  grid.innerHTML = `
    <div class="field wide"><label for="story-sample-date" style="display:block;margin:0 0 7px;font-size:13px;font-weight:690">Дата отбора проб</label><input id="story-sample-date" type="date" style="width:100%;height:43px;border:1px solid #cbdadb;border-radius:9px;padding:0 12px"></div>
    <div class="field wide vse-lab-sample-field"><span class="field-label">Специальные лабораторные исследования</span><label class="checkbox-field" style="display:flex;align-items:center;gap:10px;border:1px solid #cbdadb;border-radius:9px;padding:0 13px"><input type="checkbox" id="samples-lab-sent"><span>Пробы отправлены на специальные лабораторные исследования</span></label></div>`;
  wrapper.append(grid);
  globalThis.VseFormState.bindLabSampleField(grid);

  if (fairMarket) wrapper.append(globalThis.VseFormState.createFairMarketStatus());
  return wrapper;
};

export default {
  id: 'vse-form-state',
  title: 'ВСЭ/Компоненты/Состояния формы',
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
  args: { fairMarket: true },
};

export const ЛабораторияИЯрмарка = { render };
