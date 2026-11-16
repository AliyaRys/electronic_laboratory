/**
 * User creation page (DR34 §5.3/§6, FT-ACC-09, mockup admin-user-create.html).
 * The «Создать пользователя» intent arrives with the saved list URL (returnTo,
 * navigation state): cancel and success both return there with the filters
 * intact. The create right is checked honestly — the button and the page use
 * the LOADED /me, never the not-yet-loaded state — and the dirty guard uses
 * the shared Dialog: «Продолжить редактирование» keeps the form, «Выйти без
 * сохранения» clears the password and returns to the list.
 */
import "../features/identity/identity.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  createUser,
  fetchAssignableOptions,
  type AssignableOptions,
  type Problem,
  type UserView,
} from "../features/identity/api";
import { UserCreateForm, type UserCreatePayload } from "../features/identity/UserCreateForm";
import { Dialog } from "../shared/ui/Dialog";
import { Icon } from "../shared/ui/Icon";
import { StatusView } from "../shared/ui/StatusView";
import { ME_QUERY_KEY, useMe } from "../shared/api/me";
import { useDirtyGuard } from "../features/context/SwitchContext";

export function UserCreatePage(): React.ReactElement {
  return (
    <RequireSession>
      <UserCreateContent />
    </RequireSession>
  );
}

function canCreateUsers(me: UserView): boolean {
  // FT-ACC-09: the right is confirmed by the loaded capabilities, not by the
  // "the identity has not arrived yet" state.
  return me.role === "ADMIN" && me.capabilities.includes("users:create");
}

function UserCreateContent(): React.ReactElement {
  const { user: me, loading, errorMessage } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [dirty, setDirty] = useState(false);
  const returnTo =
    typeof (location.state as { returnTo?: unknown } | null)?.returnTo === "string"
      ? ((location.state as { returnTo: string }).returnTo as string)
      : "/users";

  useDirtyGuard(dirty, "Создание пользователя");

  const allowed = me !== null && canCreateUsers(me);
  const options = useQuery({
    queryKey: ["users", "assignable", null, null, null, "/users/assignable"],
    queryFn: ({ signal }) => fetchAssignableOptions(signal),
    enabled: allowed,
  });

  const leave = useCallback(
    (notice: string | null): void => {
      void queryClient.invalidateQueries({ queryKey: [null, null, null, "/users"] });
      navigate(notice === null ? returnTo : returnTo, {
        state: notice === null ? undefined : { notice },
        replace: notice === null,
      });
    },
    [navigate, queryClient, returnTo],
  );

  if (loading) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание пользователя</h1>
        <StatusView state="loading" title="Загрузка профиля…" />
      </div>
    );
  }
  if (me === null) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание пользователя</h1>
        <StatusView
          state={errorMessage !== null ? "network-error" : "forbidden"}
          title={errorMessage !== null ? undefined : "Доступ запрещён."}
          detail={errorMessage ?? undefined}
          onRetry={
            errorMessage !== null
              ? () => void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
              : undefined
          }
        />
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="vse-app vse-page">
        <h1>Создание пользователя</h1>
        <StatusView
          state="forbidden"
          title="Доступ запрещён."
          detail="Недостаточно прав для создания пользователя."
        />
      </div>
    );
  }

  const optionsData: AssignableOptions | null =
    options.data !== undefined && !("code" in options.data) ? options.data : null;

  const submit = async (payload: UserCreatePayload, intentKey: string): Promise<Problem | null> => {
    const result = await createUser(payload, intentKey);
    if ("code" in result) return result;
    leave("Пользователь создан.");
    return null;
  };

  return (
    <div className="vse-app vse-page">
      <Link className="vse-create-back" to={returnTo} aria-label="К списку пользователей">
        <Icon name="chevron-left" />
        <span>К списку пользователей</span>
      </Link>
      <div className="vse-create-heading">
        <h1>Создание пользователя</h1>
        <p>
          {me.scopes.find((scope) => scope.territory_name !== null)?.territory_name ??
            "Новая учётная запись делегированной области"}
        </p>
      </div>
      {options.isLoading ? (
        <div className="vse-panel">
          <StatusView state="loading" title="Загрузка вариантов доступа…" />
        </div>
      ) : options.data !== undefined && "code" in options.data ? (
        <div className="vse-panel">
          <StatusView
            state={(options.data as Problem).code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
            detail={(options.data as Problem).detail}
            onRetry={() => void options.refetch()}
          />
        </div>
      ) : (
        <UserCreateForm
          options={optionsData}
          optionsLoading={options.isLoading}
          onSubmit={submit}
          onCancel={() => (dirty ? setConfirmLeave(true) : leave(null))}
          onDirtyChange={setDirty}
        />
      )}

      {/* §11: leaving with unsaved input asks first; leaving clears the secret. */}
      <Dialog
        open={confirmLeave}
        onOpenChange={(open) => {
          if (!open) setConfirmLeave(false);
        }}
        title="Изменения не сохранены"
        description="Введённые данные и выбранный доступ будут потеряны."
        confirmLabel="Выйти без сохранения"
        cancelLabel="Продолжить редактирование"
        onConfirm={() => {
          setConfirmLeave(false);
          setDirty(false);
          leave(null);
        }}
      />
    </div>
  );
}
