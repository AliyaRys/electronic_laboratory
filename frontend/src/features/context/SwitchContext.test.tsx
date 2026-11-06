/**
 * Context scoping tests (ADR-008, UI-03).
 *
 * Test IDs required by the F01 brief:
 *  - test_stale_context_response_ignored
 *  - test_logout_clears_cache
 * plus the dirty-switch cancellation and the URL-backed page navigation proof.
 */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  createMemoryRouter,
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
  useSearchParams,
} from "react-router";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  switchContext,
  currentScope,
  useContextScope,
  performLogout,
  useDirtyGuard,
  DirtyLeaveDialog,
} from "./SwitchContext";
import { scopedKey } from "../../shared/api/queryKeys";
import { apiClient, SESSION_EXPIRED_EVENT } from "../../shared/api/client";
import { AppProviders } from "../../app/providers";
import { routes } from "../../app/router";
import { useContextStore, useDirtyStore, LOGOUT_EVENT } from "../../entities/session/context";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  useContextStore.getState().reset();
  useDirtyStore.getState().setDirty(false);
});
afterAll(() => server.close());

const USER_ID = "00000000-0000-0000-0000-00000000000a";
const LAB_A = "11111111-1111-1111-1111-111111111111";
const LAB_B = "22222222-2222-2222-2222-222222222222";

interface RawResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}
const raw = apiClient as unknown as {
  GET: (path: string, options?: Record<string, unknown>) => Promise<RawResult>;
};

describe("context switching", () => {
  it("test_stale_context_response_ignored", async () => {
    server.use(
      http.get("*/api/v1/arrivals", async ({ request }) => {
        const lab = new URL(request.url).searchParams.get("laboratory_id");
        if (lab === LAB_A) {
          await delay(500);
          return HttpResponse.json({ lab: LAB_A, items: ["A-данные"] }, { headers: { ETag: '"1"' } });
        }
        return HttpResponse.json({ lab: LAB_B, items: ["B-данные"] }, { headers: { ETag: '"2"' } });
      }),
    );

    function ArrivalsProbe(): ReactElement {
      const scope = useContextScope();
      const query = useQuery({
        queryKey: scopedKey(scope, "arrivals", { laboratory_id: scope.labId }),
        queryFn: ({ signal }) =>
          raw.GET("/api/v1/arrivals", { signal, params: { query: { laboratory_id: scope.labId ?? "" } } }),
        select: (result: RawResult) => result.data as { lab: string; items: string[] } | undefined,
        enabled: scope.labId !== null,
      });
      return <div>очередь: {query.data?.items.join(",") ?? "загрузка"}</div>;
    }

    function Probe(): ReactElement {
      const scope = useContextScope();
      return (
        <>
          <span aria-label="Лаборатория">{scope.labId}</span>
          <ArrivalsProbe />
        </>
      );
    }

    const [queryClient] = [new QueryClient({ defaultOptions: { queries: { retry: false } } })];
    switchContext(queryClient, { userId: USER_ID, labId: LAB_A });
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );

    // Still inside laboratory А: the late response would be legitimate here.
    await act(async () => {
      await switchContext(queryClient, { labId: LAB_B });
    });
    await waitFor(() => expect(screen.getByText(/очередь: B-данные/)).toBeInTheDocument());

    // Give the laboratory А answer time to arrive after the switch: it must
    // never appear in laboratory Б's UI and must be absent from the cache.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText(/A-данные/)).not.toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        scopedKey({ userId: USER_ID, labId: LAB_A, productId: null }, "arrivals", {
          laboratory_id: LAB_A,
        }),
      ),
    ).toBeUndefined();
  });
});

describe("router blockers", () => {
  it("dirty switch is cancelled on request", async () => {
    function DirtyForm(): ReactElement {
      const [dirty] = useState(true);
      useDirtyGuard(dirty);
      return (
        <>
          <DirtyLeaveDialog />
          <input aria-label="Причина возврата" defaultValue="несохранённый ввод" />
          <NavigateButton
            to="/labs/22222222-2222-2222-2222-222222222222/arrivals"
            label="К другой лаборатории"
          />
        </>
      );
    }
    function NavigateButton({ to, label }: { to: string; label: string }): ReactElement {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate(to)}>
          {label}
        </button>
      );
    }
    function LabShell(): ReactElement {
      return (
        <>
          <Outlet />
        </>
      );
    }

    const router = createMemoryRouter(
      [
        {
          path: "/labs/:labId",
          element: <LabShell />,
          children: [
            { path: "arrivals", element: <DirtyForm /> },
            { path: "examinations", element: <div>Журнал ВСЭ</div> },
          ],
        },
        { path: "*", element: <Navigate to="/labs/11111111-1111-1111-1111-111111111111/arrivals" replace /> },
      ],
      { initialEntries: ["/labs/11111111-1111-1111-1111-111111111111/arrivals"] },
    );

    render(<RouterProvider router={router} />);
    expect(await screen.findByLabelText("Причина возврата")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "К другой лаборатории" }));

    // The blocker stops the navigation and asks the user; staying keeps both
    // the location and the unsaved input.
    const stay = await screen.findByRole("button", { name: "Остаться" });
    await userEvent.setup().click(stay);
    expect(await screen.findByLabelText("Причина возврата")).toBeInTheDocument();
    expect(screen.queryByText("Журнал ВСЭ")).not.toBeInTheDocument();
  });
});

describe("URL-backed list state", () => {
  it("navigation back re-requests page 2", async () => {
    const pageRequests: string[] = [];
    server.use(
      http.get("*/api/v1/arrivals", ({ request }) => {
        const page = new URL(request.url).searchParams.get("page") ?? "1";
        pageRequests.push(page);
        return HttpResponse.json(
          { items: [`страница-${page}`], total: 40, page: Number(page), page_size: 20 },
          { headers: { ETag: '"1"' } },
        );
      }),
    );

    function ArrivalsPage(): ReactElement {
      const scope = useContextScope();
      const [params] = useSearchParams();
      const page = params.get("page") ?? "1";
      const query = useQuery({
        queryKey: scopedKey(scope, "arrivals", { page }),
        queryFn: ({ signal }) =>
          raw.GET("/api/v1/arrivals", {
            signal,
            params: { query: { page, laboratory_id: scope.labId ?? "" } },
          }),
        select: (result: RawResult) => result.data as { items: string[] },
      });
      return (
        <div>
          список: {query.data?.items.join(",") ?? "…"}
          <Link to="/labs/11111111-1111-1111-1111-111111111111/examinations">Журнал ВСЭ</Link>
        </div>
      );
    }
    function ExaminationsPage(): ReactElement {
      return <h1>Журнал ВСЭ</h1>;
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });

    const router = createMemoryRouter(
      [
        {
          path: "/labs/:labId/arrivals",
          element: (
            <QueryClientProvider client={queryClient}>
              <ArrivalsPage />
            </QueryClientProvider>
          ),
        },
        { path: "/labs/:labId/examinations", element: <ExaminationsPage /> },
      ],
      { initialEntries: ["/labs/11111111-1111-1111-1111-111111111111/arrivals?page=2"] },
    );

    render(<RouterProvider router={router} />);
    await screen.findByText(/страница-2/);
    expect(pageRequests).toEqual(["2"]);

    await userEvent.setup().click(await screen.findByRole("link", { name: "Журнал ВСЭ" }));
    expect(await screen.findByRole("heading", { name: "Журнал ВСЭ" })).toBeInTheDocument();
    expect(pageRequests).toEqual(["2"]);

    // Back returns to the URL with page=2 (filters/page live in the URL),
    // and the page-2 data is requested again instead of being cached.
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() => expect(pageRequests).toEqual(["2", "2"]));
    await screen.findByText(/страница-2/);
  });

  it("from > to answers 422 and keeps the form input", async () => {
    server.use(
      http.get("*/api/v1/arrivals", ({ request }) => {
        const params = new URL(request.url).searchParams;
        const from = params.get("from") ?? "";
        const to = params.get("to") ?? "";
        if (from > to) {
          return HttpResponse.json(
            {
              type: "about:blank",
              title: "422",
              status: 422,
              detail: "Начало позже конца.",
              code: "VALIDATION_ERROR",
            },
            { status: 422, headers: { "content-type": "application/problem+json" } },
          );
        }
        return HttpResponse.json(
          { items: ["страница-1"], total: 0, page: 1, page_size: 20 },
          { headers: { ETag: '"1"' } },
        );
      }),
    );

    function ArrivalsPage(): ReactElement {
      const scope = useContextScope();
      const [params] = useSearchParams();
      const period = { from: params.get("from") ?? "", to: params.get("to") ?? "" };
      const query = useQuery({
        queryKey: scopedKey(scope, "arrivals", period),
        queryFn: ({ signal }) => raw.GET("/api/v1/arrivals", { signal, params: { query: period } }),
        select: (result: RawResult) => {
          if (result.response.ok) {
            return { items: (result.data as { items: string[] } | undefined)?.items, code: null };
          }
          return { items: undefined, code: (result.error as { code?: string } | null)?.code ?? "UNKNOWN" };
        },
      });
      return (
        <div>
          диапазон: {query.data?.items?.join(",") ?? "…"}
          {query.data?.code !== null && <output aria-label="Ошибка фильтра">{query.data?.code}</output>}
        </div>
      );
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [
        {
          path: "/labs/:labId/arrivals",
          element: (
            <QueryClientProvider client={queryClient}>
              <ArrivalsPage />
            </QueryClientProvider>
          ),
        },
      ],
      {
        initialEntries: ["/labs/11111111-1111-1111-1111-111111111111/arrivals?from=2026-11-02&to=2026-11-01"],
      },
    );

    render(<RouterProvider router={router} />);
    // The 422 problem is surfaced with its stable code; the URL filters stay
    // intact so the user can correct the range (no silent reset).
    await screen.findByText(/VALIDATION_ERROR/);
    expect(router.state.location.search).toContain("from=2026-11-02&to=2026-11-01");
  });
});

describe("logout", () => {
  it("test_logout_clears_cache", async () => {
    server.use(
      http.post("*/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })),
      http.get("*/api/v1/contexts", () =>
        HttpResponse.json([{ laboratory_id: LAB_A, product_scope_id: null, help_contacts: [] }]),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    switchContext(queryClient, { userId: USER_ID, labId: LAB_A });
    queryClient.setQueryData(["seed"], { closed: "данные закрытого контура" });
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    await performLogout(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(currentScope()).toMatchObject({ userId: null, labId: null, productId: null });
  });

  it("performLogout notifies open screens exactly once (regression F01-r1)", async () => {
    server.use(http.post("*/api/v1/auth/logout", () => new HttpResponse(null, { status: 204 })));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let clears = 0;
    const originalClear = queryClient.clear.bind(queryClient);
    queryClient.clear = () => {
      clears += 1;
      originalClear();
    };
    let notifications = 0;
    const onLogout = (): void => {
      notifications += 1;
    };
    window.addEventListener(LOGOUT_EVENT, onLogout);

    switchContext(queryClient, { userId: USER_ID, labId: LAB_A });
    queryClient.setQueryData(["seed"], { closed: "данные закрытого контура" });

    // The provider tree is mounted as in the app, but the LOGOUT_EVENT must
    // not re-enter the cleanup (dispatchEvent is synchronous).
    render(
      <AppProviders queryClient={queryClient}>
        <div>экран</div>
      </AppProviders>,
    );
    await performLogout(queryClient);

    expect(clears).toBe(1);
    expect(notifications).toBe(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(currentScope()).toMatchObject({ userId: null, labId: null, productId: null });
    window.removeEventListener(LOGOUT_EVENT, onLogout);
  });

  it("a 401 session expiry clears the cache exactly once without recursion (regression F01-r1)", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let clears = 0;
    const originalClear = queryClient.clear.bind(queryClient);
    queryClient.clear = () => {
      clears += 1;
      originalClear();
    };

    switchContext(queryClient, { userId: USER_ID, labId: LAB_A });
    queryClient.setQueryData(["seed"], { closed: "данные закрытого контура" });

    render(
      <AppProviders queryClient={queryClient}>
        <div>экран</div>
      </AppProviders>,
    );

    // SESSION_EXPIRED_EVENT is dispatched by the transport on 401; the handler
    // must not dispatch anything back (recursion would overflow the stack).
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));

    expect(clears).toBe(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(currentScope()).toMatchObject({ userId: null, labId: null, productId: null });
  });
});

describe("app shell routing", () => {
  it("a dirty route change in the real router opens the blocker dialog (F01-r1 #2)", async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/labs/11111111-1111-1111-1111-111111111111/arrivals"],
    });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText(/Поступления/)).toBeInTheDocument();

    // A real dirty form syncs through useDirtyGuard; the flag in the store is
    // what the shell dialog reads.
    act(() => {
      useDirtyStore.getState().setDirty(true, "Сверка");
    });

    await act(async () => {
      await router.navigate("/labs/22222222-2222-2222-2222-222222222222/examinations");
    });

    expect(screen.getByRole("dialog", { name: "Несохранённый ввод" })).toBeInTheDocument();
    expect(screen.queryByText("Журнал ВСЭ")).not.toBeInTheDocument();

    // Safe cancel first: staying keeps the current page and the dirty flag.
    await userEvent.setup().click(screen.getByRole("button", { name: "Остаться" }));
    expect(screen.getByText(/Поступления/)).toBeInTheDocument();

    await act(async () => {
      useDirtyStore.getState().setDirty(false);
    });
  });
});

describe("product context switch", () => {
  it("switchContext publishes the product type and ignores stale in-flight reads", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let settle: (value: string) => void = () => undefined;
    const stale = queryClient.prefetchQuery({
      queryKey: ["meat-context", "read"],
      queryFn: () => new Promise<string>((resolve) => (settle = resolve)),
    });

    await act(async () => {
      await switchContext(queryClient, { productType: "milk" });
    });

    // The in-flight read of the previous context is cancelled — it can never
    // land in the new product context.
    expect(useContextStore.getState().productType).toBe("milk");
    await act(async () => {
      settle("stale-answer");
    });
    // A cancelled prefetch resolves with no data; the stale answer is dropped.
    await expect(stale).resolves.toBeUndefined();
    expect(queryClient.getQueryData(["meat-context", "read"])).toBeUndefined();
    useContextStore.getState().reset();
  });
});
