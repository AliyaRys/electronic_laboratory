import { renderReportComponent } from '../story-support.js';

const reports = VseReports.createDemoReports();
const report = reports[0];

export default {
  id: 'admin-reports-components',
  title: 'Администрирование/Отчёты',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Общие компоненты отчётности. Страницы списка, создания, просмотра и печати используют этот runtime без копирования матрицы и меню действий.' } },
  },
};

export const List = {
  name: 'Список отчётов',
  render: () => renderReportComponent(VseReports.createReportsList({ reports, restoreState: false, links: { create: '#', view: '#', print: '#' } })),
};

export const ListEmpty = {
  name: 'Список · пусто',
  render: () => renderReportComponent(VseReports.createReportsList({ reports: [], restoreState: false, links: { create: '#' } })),
};

export const ListError = {
  name: 'Список · ошибка',
  render: () => renderReportComponent(VseReports.createReportsList({ reports, restoreState: false, initialState: 'error' })),
};

export const ListLoading = {
  name: 'Список · загрузка',
  render: () => renderReportComponent(VseReports.createReportsList({ reports, restoreState: false, initialState: 'loading' })),
};

export const Matrix = {
  name: 'Матрица формы 5-вет',
  render: () => renderReportComponent(VseReports.createReportMatrix(report)),
};

export const OrganizationHeader = {
  name: 'Шапка организации',
  render: () => renderReportComponent(VseReports.createOrganizationHeader(report)),
};

export const RequiredCodes = {
  name: 'Классификационные коды',
  render: () => renderReportComponent(VseReports.createOrganizationHeader({ ...report, codes: {} }, { editableCodes: true })),
};

export const Parameters = {
  name: 'Параметры создания',
  render: () => renderReportComponent(VseReports.createReportCreate({ links: { list: '#', view: '#' } })),
};

export const NarrowMatrix = {
  name: 'Матрица · узкий экран',
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => renderReportComponent(VseReports.createReportMatrix(report)),
};

export const OfficialPrintForm = {
  name: 'Официальная печатная форма',
  parameters: { layout: 'fullscreen' },
  render: () => VseReports.createPrintView(report),
};
