import { appHeader, renderHeader } from './story-support.js';

export default {
  id: 'system-app-header',
  title: 'Система/Шапка системы',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Единая шапка рабочих экранов. Размеры, интервалы, маршруты и иконки принадлежат AppHeader; страницы не задают их локально. Высота шапки всегда 76 px, логотип — 43 × 43 px, рабочие пункты — 42 px.',
      },
    },
  },
  argTypes: {
    product: { control: 'inline-radio', options: ['meat', 'milk'], description: 'Активный тип продукции' },
    mode: { control: 'inline-radio', options: ['work', 'admin', 'analyst'], description: 'Контекст навигации' },
    active: { control: 'inline-radio', options: ['arrivals', 'journal', 'directories', 'users', 'reports'], description: 'Активный раздел' },
    institution: { control: 'text', description: 'Название учреждения; длинное значение не меняет ширину бренда' },
    userName: { control: 'text' },
    userInitials: { control: 'text' },
    menuOpen: { control: 'boolean', description: 'Открыть меню продукции' },
  },
  args: {
    mode: 'work',
    product: 'milk',
    active: 'arrivals',
    institution: 'Лаборатория ВСЭ №1 г. Казань',
    userName: 'Анна Кузнецова',
    userInitials: 'АК',
    menuOpen: false,
  },
  render: args => renderHeader(args),
};

export const MilkArrivals = { name: 'Молоко · Поступления' };
export const MeatJournal = { name: 'Мясо · Журнал ВСЭ', args: { product: 'meat', active: 'journal' } };
export const Directories = { name: 'Справочники', args: { product: 'meat', active: 'directories' } };
export const ProductMenu = { name: 'Меню продукции открыто', args: { menuOpen: true } };
export const LongInstitution = {
  name: 'Длинное название учреждения',
  args: { institution: 'Государственная ветеринарная лаборатория ветеринарно-санитарной экспертизы №12' },
};
export const Narrow = {
  name: 'Узкий экран',
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const Administrator = {
  name: 'Администратор · Управление пользователями',
  args: {
    mode: 'admin',
    active: 'users',
    userName: 'Елена Морозова',
    userInitials: 'ЕМ',
    links: { brand: 'admin-users.html', adminUsers: 'admin-users.html', adminReports: 'admin-reports.html', profile: 'admin-profile.html' },
  },
};

export const AdministratorLongContext = {
  name: 'Администратор · длинные данные',
  args: {
    ...Administrator.args,
    institution: 'Государственная лаборатория ветеринарно-санитарной экспертизы муниципального района',
    userName: 'Елена Александровна Морозова',
  },
};

export const AdministratorReports = {
  name: 'Администратор · Отчёты',
  args: { ...Administrator.args, active: 'reports' },
};

export const Analyst = {
  name: 'Аналитик · Отчёты',
  args: {
    mode: 'analyst',
    active: 'reports',
    userName: 'Марат Хусаинов',
    userInitials: 'МХ',
    institution: 'Республика Татарстан',
    links: {
      brand: 'analyst-reports.html',
      arrivals: 'analyst-arrivals.html',
      journal: 'analyst-journal.html',
      directories: 'analyst-directories.html',
      reports: 'analyst-reports.html',
      profile: 'analyst-profile.html',
    },
  },
};

export const GeometryReference = {
  name: 'Спецификация размеров',
  parameters: {
    docs: {
      description: {
        story: `Канонические значения: ${appHeader.spec.height}px высота шапки; ${appHeader.spec.logoSize}px логотип; ${appHeader.spec.brandWidth}px зона бренда; ${appHeader.spec.controlHeight}px пункты навигации; ${appHeader.spec.navigationIconSize}px навигационные иконки; ${appHeader.spec.productSwitcherWidth}px переключатель продукции; ${appHeader.spec.avatarSize}px аватар.`,
      },
    },
  },
};
