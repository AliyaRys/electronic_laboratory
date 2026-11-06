import { renderSampleComponent } from '../story-support.js';

const screen = options => {
  VseSampleAccounting.resetDemo();
  return renderSampleComponent(VseSampleAccounting.createScreen({ restoreState: false, ...options }));
};

export default {
  id: 'admin-sample-accounting-components',
  title: 'Администрирование/Отчёты/Учёт проб',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Оперативный учёт отобранных проб: остатки по 20 видам продукции, первичные записи, история и регистрация полной утилизации остатка.',
      },
    },
  },
};

export const ReportTypeFilter = {
  name: 'Выбор типа отчёта',
  render: () => renderSampleComponent(VseReports.createReportTypeFilter({ active: 'sample-accounting', links: { form5Vet: '#', samples: '#' } }), '520px'),
};

export const CurrentBalances = {
  name: 'Текущие остатки',
  render: () => screen({ initialLaboratoryId: 'lab-kazan-1' }),
};

export const ReadOnlyBalances = {
  name: 'Аналитик · только просмотр',
  render: () => screen({ initialLaboratoryId: 'lab-kazan-1', canDispose: false }),
};

export const LaboratoryManager = {
  name: 'Заведующий · своя лаборатория',
  render: () => screen({ initialLaboratoryId: 'lab-kazan-1', canDispose: true, showLaboratorySelector: false }),
};

export const Doctor = {
  name: 'Ветеринарный врач · своя лаборатория',
  render: () => screen({ initialLaboratoryId: 'lab-kazan-1', canDispose: true, showLaboratorySelector: false }),
};

export const Empty = {
  name: 'Пустое состояние',
  render: () => screen({ initialState: 'empty' }),
};

export const Loading = {
  name: 'Загрузка',
  render: () => screen({ initialState: 'loading' }),
};

export const ErrorState = {
  name: 'Ошибка',
  render: () => screen({ initialState: 'error' }),
};

export const Narrow = {
  name: 'Узкий экран',
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => screen({ initialLaboratoryId: 'lab-kazan-1' }),
};
