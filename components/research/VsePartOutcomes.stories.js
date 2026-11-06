import '../../vse-part-outcomes.css';
import '../../vse-part-outcomes.js';

export default { title: 'ВСЭ/Итог экспертизы/Результат по частям' };

const createStory = ({ neutralization = false, custom = false, max = false } = {}) => {
  const root = document.createElement('div');
  root.className = 'vse-outcomes';
  root.innerHTML = '<div class="vse-outcome-list"></div><p class="vse-outcome-error" role="alert">Выберите результат, направление и причину для каждой части партии.</p>';
  const list = root.querySelector('.vse-outcome-list');
  globalThis.VsePartOutcomes.render(list, ['БКТ-001 · туша'], { allowConditional: true, enableNeutralizationReasons: true });
  if (neutralization) {
    const result = list.querySelector('[name="vseResult[]"]');
    result.value = 'Условно-пригодно';
    result.dispatchEvent(new Event('change', { bubbles: true }));
    const direction = list.querySelector('[name="vseDirection[]"]');
    direction.value = 'На обезвреживание';
    direction.dispatchEvent(new Event('change', { bubbles: true }));
    if (custom) {
      const reason = list.querySelector('[name^="vseNeutralizationReason"]');
      reason.value = 'Другая причина';
      reason.dispatchEvent(new Event('change', { bubbles: true }));
      list.querySelector('[name^="vseNeutralizationCustom"]').value = 'Изменение органолептических показателей';
    }
    if (max) {
      const add = list.querySelector('.add-row-button');
      for (let index = 1; index < 5; index += 1) add.click();
    }
  }
  return root;
};

export const Default = { render: () => createStory() };
export const NeutralizationReason = { render: () => createStory({ neutralization: true }) };
export const OtherReason = { render: () => createStory({ neutralization: true, custom: true }) };
export const FiveReasons = { render: () => createStory({ neutralization: true, max: true }) };
