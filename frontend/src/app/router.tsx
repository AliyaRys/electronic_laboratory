/**
 * SPA routing (UI-01). Routes are the canonical mapping of the reference
 * screens; each page implementation arrives with its owning task (F02/F03,
 * A01/A02, C02, D02, E04, R03, S03). History routing keeps deep links working;
 * the deploy nginx already serves index.html for non-API fallbacks.
 */
import { createBrowserRouter, Outlet, type RouteObject } from "react-router";
import { AppLayout } from "../shared/ui/AppLayout";
import { PlaceholderPage } from "../shared/ui/PlaceholderPage";
import { DirtyLeaveDialog } from "../features/context/SwitchContext";

/** Placeholder until the owning task delivers the real page. */
function Stub({ title, note }: { title: string; note: string }): React.ReactElement {
  return (
    <AppLayout>
      <PlaceholderPage title={title} note={note} />
    </AppLayout>
  );
}

export const routes: RouteObject[] = [
  { path: "/login", element: <Stub title="Вход" note="Страница входа — задача F03." /> },
  { path: "/password-help", element: <Stub title="Восстановление пароля" note="Задача F03." /> },
  { path: "/profile", element: <Stub title="Профиль" note="Задача F03." /> },
  { path: "/users", element: <Stub title="Пользователи" note="Задача F03." /> },
  { path: "/users/new", element: <Stub title="Создание пользователя" note="Задача F03." /> },
  { path: "/users/:userId/edit", element: <Stub title="Редактирование пользователя" note="Задача F03." /> },
  { path: "/users/:userId/history", element: <Stub title="История пользователя" note="Задача F03." /> },
  { path: "/catalogs", element: <Stub title="Справочники" note="Задача C02." /> },
  { path: "/catalogs/methods", element: <Stub title="Нормы исследований" note="Задача C02." /> },
  { path: "/catalogs/tariffs", element: <Stub title="Стоимость исследований" note="Задача C02." /> },
  {
    path: "/labs/:labId/arrivals",
    element: <Stub title="Поступления" note="Очереди expected/work/accepted — задача A01." />,
  },
  {
    path: "/labs/:labId/arrivals/:partyId/reconciliation",
    element: <Stub title="Сверка эВСД" note="Задача A02." />,
  },
  {
    path: "/labs/:labId/arrivals/:partyId/examination/new",
    element: <Stub title="Создание ВСЭ" note="Задача E04." />,
  },
  {
    path: "/labs/:labId/arrivals/:partyId/conclusion",
    element: <Stub title="Заключение" note="Задача D02." />,
  },
  { path: "/labs/:labId/examinations", element: <Stub title="Журнал ВСЭ" note="Задача E04." /> },
  {
    path: "/labs/:labId/examinations/:examinationId",
    element: <Stub title="Просмотр ВСЭ" note="Задача E04." />,
  },
  { path: "/labs/:labId/reports", element: <Stub title="Отчёты" note="Задача R03." /> },
  { path: "/labs/:labId/reports/new", element: <Stub title="Создание отчёта" note="Задача R03." /> },
  { path: "/labs/:labId/reports/:reportId", element: <Stub title="Просмотр отчёта" note="Задача R03." /> },
  { path: "/labs/:labId/reports/samples", element: <Stub title="Учёт проб" note="Задача S03." /> },
  {
    path: "*",
    element: (
      <AppLayout>
        <PlaceholderPage title="Запись не указана" note="Такой маршрут отсутствует." notFound />
      </AppLayout>
    ),
  },
];

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(routes);
}

/** Layout wrapper: the dirty-leave decision lives at the shell level. */
export function AppShell(): React.ReactElement {
  return (
    <>
      <Outlet />
      <DirtyLeaveDialog />
    </>
  );
}

export const appRouter = createAppRouter();
