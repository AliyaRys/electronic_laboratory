/**
 * Users list (FT-ACC-08, FT-ADM, ui-mapping: admin-users → /users): ADMIN
 * only. Search/filters/page live in the URL (FT-COM-01/02), the table stays
 * read-only until a confirmed dialog action, and every state — forbidden,
 * empty, no-match, network error — is honest.
 */
import "../features/identity/identity.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  blockUser,
  fetchUsers,
  deleteUser,
  revisionEtag,
  resetUserPassword,
  ROLE_LABELS,
  unblockUser,
  type Problem,
  type UserView,
  type UserRole,
} from "../features/identity/api";
import { Button } from "../shared/ui/Button";
import { Dialog } from "../shared/ui/Dialog";
import { StatusView } from "../shared/ui/StatusView";
import { DataTable, type DataTableRow } from "../shared/ui/DataTable";
import { useMe } from "../shared/api/me";

const COLUMNS = [
  { id: "user", header: "Пользователь" },
  { id: "role", header: "Роль" },
  { id: "status", header: "Статус" },
  { id: "scopes", header: "Назначения" },
] as const;

interface Filters {
  q: string;
  role: string;
  status: string;
  page: number;
}

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    q: params.get("q") ?? "",
    role: params.get("role") ?? "",
    status: params.get("status") ?? "",
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

export function UsersPage(): React.ReactElement {
  return (
    <RequireSession>
      <UsersContent />
    </RequireSession>
  );
}

type UserAction =
  | { kind: "none" }
  | { kind: "block" | "unblock"; user: UserView }
  | { kind: "reset"; user: UserView }
  | { kind: "delete"; user: UserView };

function UsersContent(): React.ReactElement {
  const { user: me } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const filters = filtersFromParams(params);
  const searchRef = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState<UserAction>({ kind: "none" });
  const [actionError, setActionError] = useState("");
  const [actionDone, setActionDone] = useState("");

  const isAdmin = me === null || me.role === "ADMIN";

  const query = {
    role: filters.role === "" ? null : (filters.role as UserRole),
    status: filters.status === "" ? null : (filters.status as "active" | "inactive"),
    q: filters.q === "" ? null : filters.q,
    page: filters.page,
  };
  const users = useQuery({
    queryKey: [null, null, null, "/users", query],
    queryFn: ({ signal }) => fetchUsers(query, signal),
    enabled: isAdmin,
  });

  const page = users.data !== undefined && !("code" in users.data) ? users.data : null;

  const applyFilters = (next: Partial<Filters>): void => {
    const merged = { ...filters, ...next };
    const search = new URLSearchParams();
    if (merged.q !== "") search.set("q", merged.q);
    if (merged.role !== "") search.set("role", merged.role);
    if (merged.status !== "") search.set("status", merged.status);
    if (merged.page > 1) search.set("page", String(merged.page));
    setParams(search);
  };

  const rows: DataTableRow[] = (page?.items ?? []).map((item) => ({
    id: item.id,
    href: `/users/${item.id}/edit`,
    cells: [
      { columnId: "user", value: item.full_name },
      { columnId: "role", value: ROLE_LABELS[item.role] },
      { columnId: "status", value: item.active ? "Активен" : "Заблокирован" },
      { columnId: "scopes", value: String(item.scopes.length) },
    ],
    menu: [
      { id: "history", label: "История пользователя" },
      item.active ? { id: "block", label: "Заблокировать" } : { id: "unblock", label: "Разблокировать" },
      { id: "reset", label: "Сброс пароля" },
      { id: "delete", label: "Удалить" },
    ],
  }));

  const runAction = async (problem: Problem | null, successText: string): Promise<void> => {
    if (problem === null) {
      setActionError("");
      setAction({ kind: "none" });
      setActionDone(successText);
      await queryClient.invalidateQueries({ queryKey: [null, null, null, "/users"] });
      return;
    }
    setActionError(problem.detail !== "" ? problem.detail : problem.code);
  };

  const current = "user" in action ? action.user : null;

  if (!isAdmin) {
    return (
      <div className="vse-app vse-page">
        <h1>Пользователи</h1>
        <StatusView state="forbidden" detail="Раздел доступен только администратору." />
      </div>
    );
  }

  return (
    <div className="vse-app vse-page">
      <h1>Управление пользователями</h1>
      <div className="vse-panel">
        <form
          className="vse-admin-controls"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters({ q: searchRef.current?.value ?? "", page: 1 });
          }}
        >
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="users-q">Поиск (ФИО, логин, email)</label>
            </div>
            <input id="users-q" ref={searchRef} type="text" defaultValue={filters.q} key={filters.q} />
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="users-role">Роль</label>
            </div>
            <select
              id="users-role"
              value={filters.role}
              onChange={(event) => applyFilters({ role: event.target.value, page: 1 })}
            >
              <option value="">Все роли</option>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="app-field">
            <div className="app-field-heading">
              <label htmlFor="users-status">Статус</label>
            </div>
            <select
              id="users-status"
              value={filters.status}
              onChange={(event) => applyFilters({ status: event.target.value, page: 1 })}
            >
              <option value="">Все статусы</option>
              <option value="active">Активен</option>
              <option value="inactive">Заблокирован</option>
            </select>
          </div>
          <div>
            <Button type="submit" variant="primary">
              Найти
            </Button>
          </div>
        </form>

        {actionDone !== "" ? (
          <div className="auth-success" role="status">
            {actionDone}
          </div>
        ) : null}

        {users.isLoading ? (
          <StatusView state="loading" title="Загрузка пользователей…" />
        ) : users.data !== undefined && "code" in users.data ? (
          <StatusView
            state={(users.data as Problem).code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
            title={
              (users.data as Problem).code === "ACCESS_DENIED"
                ? undefined
                : "Не удалось загрузить пользователей."
            }
            detail={(users.data as Problem).detail}
            onRetry={() => void users.refetch()}
          />
        ) : page === null ? (
          <StatusView
            state="network-error"
            title="Не удалось загрузить пользователей."
            onRetry={() => void users.refetch()}
          />
        ) : (
          <>
            <DataTable
              caption="Пользователи делегированной области"
              columns={COLUMNS}
              rows={rows}
              onMenuAction={(_event, rowId, actionId) => {
                const target = page?.items.find((item) => item.id === rowId);
                if (target === undefined) return;
                setActionError("");
                if (actionId === "history") {
                  navigate(`/users/${rowId}/history`);
                } else if (actionId === "block" || actionId === "unblock") {
                  setAction({ kind: actionId, user: target });
                } else if (actionId === "reset") {
                  setAction({ kind: "reset", user: target });
                } else if (actionId === "delete") {
                  setAction({ kind: "delete", user: target });
                }
              }}
            />
            <nav className="vse-pagination" aria-label="Страницы списка пользователей">
              <Button
                onClick={() => applyFilters({ page: filters.page - 1 })}
                disabled={filters.page <= 1}
                label="Предыдущая страница"
                iconOnly
                icon="caret"
              >
                ‹
              </Button>
              <span>
                Страница {page?.page ?? filters.page} из{" "}
                {page !== null ? Math.max(1, Math.ceil(page.total / page.page_size)) : 1}
              </span>
              <Button
                onClick={() => applyFilters({ page: filters.page + 1 })}
                disabled={page === null || page.page * page.page_size >= page.total}
                label="Следующая страница"
                iconOnly
                icon="caret"
              >
                ›
              </Button>
            </nav>
          </>
        )}
      </div>

      {/* Block/unblock: explicit confirmation, If-Match of the shown revision. */}
      <Dialog
        open={action.kind === "block" || action.kind === "unblock"}
        onOpenChange={(open) => {
          if (!open) setAction({ kind: "none" });
        }}
        title={action.kind === "block" ? "Заблокировать пользователя?" : "Разблокировать пользователя?"}
        description={
          current === null
            ? undefined
            : `${current.full_name} (${current.login}). ${
                action.kind === "block"
                  ? "Вход в систему станет недоступен, назначение сохранится."
                  : "Вход в систему будет разрешён."
              }`
        }
        danger={action.kind === "block"}
        confirmLabel={action.kind === "block" ? "Заблокировать" : "Разблокировать"}
        error={actionError}
        onConfirm={() => {
          if (current === null) return;
          const etag = revisionEtag(current);
          void (action.kind === "block" ? blockUser(current.id, etag) : unblockUser(current.id, etag)).then(
            (result) =>
              runAction(
                result instanceof Object && "code" in result ? result : null,
                "Статус пользователя обновлён.",
              ),
          );
        }}
      />

      {/* Reset: password fields live in the dialog; secrets are cleared after submit. */}
      <ResetDialog
        open={action.kind === "reset"}
        user={current}
        onClose={() => setAction({ kind: "none" })}
        onDone={(message) => {
          setAction({ kind: "none" });
          setActionDone(message);
          void queryClient.invalidateQueries({ queryKey: [null, null, null, "/users"] });
        }}
      />

      <Dialog
        open={action.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setAction({ kind: "none" });
        }}
        title="Удалить пользователя?"
        description={
          current === null
            ? undefined
            : `${current.full_name} (${current.login}). Учётная запись перестанет существовать; записи, созданные этим пользователем, сохранятся.`
        }
        danger
        confirmLabel="Удалить"
        error={actionError}
        onConfirm={() => {
          if (current === null) return;
          void deleteUser(current.id, crypto.randomUUID()).then((problem) =>
            runAction(problem, "Пользователь удалён."),
          );
        }}
      />
    </div>
  );
}

/** Reset dialog with its own password trio (FT-ADM, secrets cleared on close). */
function ResetDialog({
  open,
  user,
  onClose,
  onDone,
}: {
  open: boolean;
  user: UserView | null;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.ReactElement {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = (): void => {
    // The typed secret never outlives the dialog (ТЗ-02).
    setPassword("");
    setConfirmation("");
    setError("");
    onClose();
  };

  const submit = async (): Promise<void> => {
    if (user === null) return;
    if (password.length < 12 || password.length > 128) {
      setError("Пароль — от 12 до 128 символов.");
      return;
    }
    if (password !== confirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      const problem = await resetUserPassword(user.id, password, confirmation, revisionEtag(user));
      if (problem === null) {
        setPassword("");
        setConfirmation("");
        onDone("Пароль сброшен. Все сеансы пользователя отозваны.");
      } else {
        setError(problem.detail !== "" ? problem.detail : problem.code);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Сброс пароля пользователя"
      description={
        user === null
          ? undefined
          : `${user.full_name} (${user.login}). Новый пароль задайте вручную и передайте его пользователю лично. Все сеансы будут отозваны; блокировка и назначение не изменятся.`
      }
      confirmLabel="Сбросить"
      busy={busy}
      error={error}
      onConfirm={() => void submit()}
    >
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="reset-password">Новый пароль</label>
        </div>
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="app-field">
        <div className="app-field-heading">
          <label htmlFor="reset-confirmation">Подтверждение</label>
        </div>
        <input
          id="reset-confirmation"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
