/**
 * SPA routing (UI-01). Routes are the canonical mapping of the reference
 * screens; each page implementation arrives with its owning task (F02/F03,
 * A01/A02, C02, D02, E04, R03, S03). History routing keeps deep links working;
 * the deploy nginx already serves index.html for non-API fallbacks.
 */
import { createBrowserRouter, type RouteObject, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../shared/ui/AppShell";
import { PlaceholderPage } from "../shared/ui/PlaceholderPage";
import { DirtyLeaveDialog, performLogout, switchContext } from "../features/context/SwitchContext";
import { LoginPage } from "../pages/LoginPage";
import { RecoveryPage } from "../pages/RecoveryPage";
import { ProfilePage } from "../pages/ProfilePage";
import { UsersPage } from "../pages/UsersPage";
import { UserEditorPage } from "../pages/UserEditorPage";
import { UserHistoryPage } from "../pages/UserHistoryPage";
import { AnalystLabsPage } from "../pages/AnalystLabsPage";
import { CatalogsPage } from "../pages/CatalogsPage";
import { ArrivalsPage } from "../pages/ArrivalsPage";
import { ReconciliationPage } from "../pages/ReconciliationPage";
import { SampleAccountingPage } from "../pages/SampleAccountingPage";
import { ExaminationCreatePage } from "../pages/ExaminationCreatePage";
import { ExaminationViewPage } from "../pages/ExaminationViewPage";
import { ExaminationJournalPage } from "../pages/ExaminationJournalPage";

/** Placeholder until the owning task delivers the real page. */
function Stub({ title, note }: { title: string; note: string }): React.ReactElement {
  return <PlaceholderPage title={title} note={note} />;
}

export const routes: RouteObject[] = [
  // The auth screens stand outside the working shell (login.html pattern).
  { path: "/login", element: <LoginPage /> },
  { path: "/password-help", element: <RecoveryPage /> },
  {
    // The shell owns the dirty-leave blocker once for the whole tree; every
    // working route renders inside it (AppShell → Outlet → page).
    element: <AppShellLayout />,
    children: [
      { path: "/profile", element: <ProfilePage /> },
      { path: "/users", element: <UsersPage /> },
      { path: "/users/new", element: <UserEditorPage mode="create" /> },
      {
        path: "/users/:userId/edit",
        element: <UserEditorPage mode="edit" />,
      },
      { path: "/users/:userId/history", element: <UserHistoryPage /> },
      // ANALYST selects one laboratory (API-02 «Начальные маршруты»).
      { path: "/labs", element: <AnalystLabsPage /> },
      { path: "/catalogs", element: <CatalogsPage /> },
      // Deep links into a specific tab land on the same page with the query.
      { path: "/catalogs/methods", element: <CatalogsPage /> },
      { path: "/catalogs/tariffs", element: <CatalogsPage /> },
      {
        path: "/labs/:labId/arrivals",
        element: <ArrivalsPage />,
      },
      {
        path: "/labs/:labId/arrivals/:partyId/reconciliation",
        element: <ReconciliationPage />,
      },
      {
        path: "/labs/:labId/arrivals/:partyId/examination/new",
        element: <ExaminationCreatePage />,
      },
      {
        path: "/labs/:labId/arrivals/:partyId/conclusion",
        element: <Stub title="Заключение" note="Задача D02." />,
      },
      { path: "/labs/:labId/examinations", element: <ExaminationJournalPage /> },
      {
        path: "/labs/:labId/examinations/:examinationId",
        element: <ExaminationViewPage />,
      },
      { path: "/labs/:labId/reports", element: <Stub title="Отчёты" note="Задача R03." /> },
      { path: "/labs/:labId/reports/new", element: <Stub title="Создание отчёта" note="Задача R03." /> },
      {
        path: "/labs/:labId/reports/:reportId",
        element: <Stub title="Просмотр отчёта" note="Задача R03." />,
      },
      { path: "/labs/:labId/reports/samples", element: <SampleAccountingPage /> },
      {
        path: "*",
        element: <PlaceholderPage title="Запись не указана" note="Такой маршрут отсутствует." notFound />,
      },
    ],
  },
];

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(routes);
}

/**
 * Layout wrapper (single source of truth lives in shared/ui/AppShell): the
 * dirty-leave decision and the logout command belong to the app layer.
 * Logout ends on the login screen (FT-ACC-01: after logout direct links do
 * not reopen session data).
 */
function AppShellLayout(): React.ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <AppShell
      onLogout={() => {
        void performLogout(queryClient).finally(() => {
          navigate("/login", { replace: true });
        });
      }}
      onProductChange={(product) => {
        // Switching the product context cancels in-flight reads (stale
        // answers of the previous context are ignored) and publishes the new
        // product type into the scope store.
        void switchContext(queryClient, { productType: product });
      }}
    >
      <DirtyLeaveDialog />
    </AppShell>
  );
}

export const appRouter = createAppRouter();
