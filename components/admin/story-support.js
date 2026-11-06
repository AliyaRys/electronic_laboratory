import '../app/app.css';
import 'choices.js/public/assets/styles/choices.min.css';
import '../app/vse-library-select.css';
import '../app/Icon.js';
import '../app/Button.js';
import '../app/InfoField.js';
import '../icons/VseIcon.js';
import Choices from 'choices.js';
import '../../milk-vse-selects.js';

globalThis.Choices = Choices;
import './AdminData.js';
import './AdminDemoStore.js';
import './UserStatusDialog.js';
import './UserDeleteDialog.js';
import './AdminTextField.js';
import './AccessEditor.js';
import './CreateUserForm.js';
import './AdminUsersList.js';
import './UserHistory.js';
import './reports/ReportData.js';
import './reports/XlsxExport.js';
import './reports/Reports.js';
import './samples/SampleData.js';
import './samples/SampleAccounting.js';
import './admin.css';
import './admin-forms.css';
import './admin-history.css';
import './reports/reports.css';
import './samples/samples.css';

export const admin = globalThis.VseAdmin;
export const renderUsersList = options => {
  const stage = document.createElement('div');
  stage.className = 'vse-app admin-story-stage';
  stage.style.padding = '28px';
  stage.style.background = 'var(--app-page)';
  stage.style.minHeight = '100vh';
  stage.append(admin.createUsersList({ restoreState: false, ...options }));
  stage.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.preventDefault()));
  return stage;
};

export const renderAdminComponent = (element, width = '960px') => {
  const stage = document.createElement('div');
  stage.className = 'vse-app admin-story-stage';
  stage.style.width = `min(${width}, calc(100vw - 32px))`;
  stage.style.margin = '0 auto';
  stage.style.padding = '28px 0';
  stage.append(element);
  stage.querySelectorAll('a').forEach(link => link.addEventListener('click', event => event.preventDefault()));
  return stage;
};

export const renderUserHistory = options => renderAdminComponent(admin.createUserHistory({ restoreState: false, ...options }), '920px');
export const renderReportComponent = (element, width = '1180px') => renderAdminComponent(element, width);
export const renderSampleComponent = (element, width = '1180px') => renderAdminComponent(element, width);
