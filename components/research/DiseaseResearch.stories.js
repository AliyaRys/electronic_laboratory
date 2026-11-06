import './disease-research.css';
import '../../milk-vse-create.css';
import './DiseaseResearch.js';

export default { title: 'ВСЭ/Исследования/Болезни' };

const render = () => {
  const root = document.createElement('section');
  root.className = 'section';
  root.innerHTML = '<div class="research-grid" id="milk-research-grid"></div>';
  globalThis.VseDiseaseResearch.mount(root);
  return root;
};

export const Default = { render };

export const Open = {
  render: () => {
    const root = render();
    root.querySelector('[data-target="disease-infectious"]').click();
    return root;
  }
};

export const OtherDisease = {
  render: () => {
    const root = render();
    root.querySelector('[data-target="disease-noninfectious"]').click();
    const select = root.querySelector('[data-disease-research="noninfectious"] select');
    select.value = 'other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return root;
  }
};
