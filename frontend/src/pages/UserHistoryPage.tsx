/**
 * User history (FT-ACC-10/FT-ADM, AT-24): ADMIN-only read-only trail without
 * secrets — the server already redacts password material; the screen never
 * renders a password field and no authorship data disappears.
 */
import "../features/identity/identity.css";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import { RequireSession } from "./RequireSession";
import { fetchUser, fetchUserHistory, type Problem } from "../features/identity/api";
import { StatusView } from "../shared/ui/StatusView";
import { DataTable, type DataTableRow } from "../shared/ui/DataTable";
import { Button } from "../shared/ui/Button";
import { useMe } from "../shared/api/me";

const COLUMNS = [
  { id: "at", header: "Время" },
  { id: "action", header: "Действие" },
  { id: "changed", header: "Изменённые поля" },
] as const;

export function UserHistoryPage(): React.ReactElement {
  return (
    <RequireSession>
      <UserHistoryContent />
    </RequireSession>
  );
}

function UserHistoryContent(): React.ReactElement {
  const { userId } = useParams();
  const { user: me } = useMe();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const user = useQuery({
    queryKey: ["users", "detail", userId],
    queryFn: ({ signal }) => fetchUser(userId ?? "", signal),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["users", "history", userId, page],
    queryFn: ({ signal }) => fetchUserHistory(userId ?? "", page, signal),
    retry: false,
  });

  if (me !== null && me.role !== "ADMIN") {
    return (
      <div className="vse-app vse-page">
        <h1>История пользователя</h1>
        <StatusView state="forbidden" detail="Раздел доступен только администратору." />
      </div>
    );
  }
  if (user.isLoading || history.isLoading) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="loading" title="Загрузка истории…" />
      </div>
    );
  }
  if (user.data !== undefined && "code" in user.data) {
    const problem = user.data as Problem;
    return (
      <div className="vse-app vse-page">
        <h1>История пользователя</h1>
        <StatusView
          state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          detail={problem.detail}
        />
      </div>
    );
  }
  if (history.data !== undefined && "code" in history.data) {
    const problem = history.data as Problem;
    return (
      <div className="vse-app vse-page">
        <h1>История пользователя</h1>
        <StatusView
          state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
          detail={problem.detail}
        />
      </div>
    );
  }
  if (user.data === undefined || history.data === undefined || "code" in history.data) {
    return (
      <div className="vse-app vse-page">
        <StatusView state="network-error" onRetry={() => void history.refetch()} />
      </div>
    );
  }

  const target = "user" in user.data ? user.data.user : null;
  const events = history.data;
  const total = events.total;

  const rows: DataTableRow[] = events.items.map((event) => ({
    id: event.id,
    cells: [
      { columnId: "at", value: new Date(event.at).toLocaleString("ru-RU") },
      { columnId: "action", value: event.action },
      { columnId: "changed", value: JSON.stringify(event.changed_fields) },
    ],
  }));

  return (
    <div className="vse-app vse-page">
      <h1>История пользователя{target !== null ? ` — ${target.full_name}` : ""}</h1>
      <div className="vse-panel">
        <p className="app-field-message">
          История содержит факты изменений без паролей и других секретов. Полное значение раскрытого поля
          видно в таблице без наведения курсора.
        </p>
        <DataTable caption="Журнал изменений учётной записи" columns={COLUMNS} rows={rows} />
        <nav className="vse-pagination" aria-label="Страницы истории">
          <Button
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("page", String(page - 1));
              setParams(next);
            }}
            disabled={page <= 1}
            label="Предыдущая страница"
            iconOnly
            icon="caret"
          >
            ‹
          </Button>
          <span>
            Страница {events.page} из {Math.max(1, Math.ceil(total / events.page_size))}
          </span>
          <Button
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("page", String(page + 1));
              setParams(next);
            }}
            disabled={events.page * events.page_size >= total}
            label="Следующая страница"
            iconOnly
            icon="caret"
          >
            ›
          </Button>
        </nav>
      </div>
    </div>
  );
}
