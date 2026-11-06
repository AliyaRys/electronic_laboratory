import logoSrc from '../../vse-lab-icon-transparent.png';
import '../app/tokens.css';
import '../icons/VseIcon.js';
import './AppHeader.js';
import './app-header.css';

export { logoSrc };
export const appHeader = globalThis.VseAppHeader;
export const renderHeader = options => {
  const stage = document.createElement('div');
  stage.className = 'vse-app app-header-story';
  stage.append(appHeader.create({
    logoSrc,
    onProductChange: (product, header) => header.setProduct(product),
    onLogout: event => event.preventDefault(),
    ...options,
  }));
  stage.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.preventDefault()));
  return stage;
};
