/**
 * User create/edit page (FT-ACC-09, ui-mapping: admin-user-create/edit).
 * ADMIN only; the server stays the authority (duplicate login, foreign
 * laboratory, role issuance). An ADMIN target is shown read-only: the
 * administrator role is issued by the closed bootstrap, not by this form.
 */
import "../features/identity/identity.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { RequireSession } from "./RequireSession";
import {
  createUser,
  fetchUser,
  updateUser,
  type Problem,
  type UserEditorPayload,
  type UserView,
} from "../features/identity/api";
import {
  UserEditor,
  userEditorDefaults,
  type UserEditorParsed,
  type UserEditorSubmit,
} from "../features/identity/UserEditor";
import { StatusView } from "../shared/ui/StatusView";
import { InfoField } from "../shared/ui/InfoField";
import { useMe } from "../shared/api/me";

export function UserEditorPage({ mode }: { mode: "create" | "edit" }): React.ReactElement {
  return (
    <RequireSession>
      <UserEditorContent mode={mode} />
    </RequireSession>
  );
}

function UserEditorContent({ mode }: { mode: "create" | "edit" }): React.ReactElement {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { user: me } = useMe();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const loaded = useQuery({
    queryKey: ["users", "detail", userId],
    queryFn: ({ signal }) => fetchUser(userId ?? "", signal),
    enabled: mode === "edit" && userId !== undefined,
    retry: false,
  });

  if (me !== null && me.role !== "ADMIN") {
    return (
      <div className="vse-app vse-page">
        <h1>{mode === "create" ? "Создание пользователя" : "Редактирование пользователя"}</h1>
        <StatusView state="forbidden" detail="Раздел доступен только администратору." />
      </div>
    );
  }

  if (mode === "edit") {
    if (loaded.isLoading) {
      return (
        <div className="vse-app vse-page">
          <StatusView state="loading" title="Загрузка пользователя…" />
        </div>
      );
    }
    if (loaded.data !== undefined && "code" in loaded.data) {
      const problem = loaded.data as Problem;
      return (
        <div className="vse-app vse-page">
          <h1>Редактирование пользователя</h1>
          <StatusView
            state={problem.code === "ACCESS_DENIED" ? "forbidden" : "network-error"}
            detail={problem.detail}
          />
        </div>
      );
    }
    if (loaded.data !== undefined && "user" in loaded.data && loaded.data.user.role === "ADMIN") {
      const admin = loaded.data.user;
      return (
        <div className="vse-app vse-page">
          <h1>Редактирование пользователя</h1>
          <div className="vse-panel">
            <InfoField label="ФИО" value={admin.full_name} />
            <InfoField label="Логин" value={admin.login} />
            <InfoField label="Email" value={admin.email} />
            <InfoField label="Роль" value="Администратор" />
            <p>Назначения и роль администратора управляются закрытой командой установки.</p>
          </div>
        </div>
      );
    }
  }

  const target: UserView | null =
    mode === "edit" && loaded.data !== undefined && "user" in loaded.data ? loaded.data.user : null;

  const submit = async (parsed: UserEditorParsed | UserEditorSubmit): Promise<Problem | null> => {
    let result: { user?: UserView } | Problem;
    if (mode === "create") {
      result = await createUser(parsed as UserEditorPayload, crypto.randomUUID());
    } else {
      if (target === null) return null;
      result = await updateUser(target.id, parsed as UserEditorPayload, `"${target.revision}"`);
    }
    if ("code" in result) {
      return result as Problem;
    }
    setSaved(true);
    void queryClient.invalidateQueries({ queryKey: [null, null, null, "/users"] });
    void queryClient.invalidateQueries({ queryKey: ["users", "detail"] });
    setTimeout(() => navigate("/users"), 400);
    return null;
  };

  return (
    <div className="vse-app vse-page">
      <h1>{mode === "create" ? "Создание пользователя" : "Редактирование пользователя"}</h1>
      <div className="vse-panel">
        {saved ? (
          <div className="auth-success" role="status">
            Пользователь сохранён. Пароль передаётся пользователю лично; поля пароля очищены.
          </div>
        ) : null}
        <UserEditor
          mode={mode}
          key={target !== null ? `${target.id}-${target.revision}` : "create"}
          initial={target !== null ? userEditorDefaults(target) : undefined}
          onSubmit={(parsed) => submit(parsed as UserEditorParsed)}
        />
      </div>
    </div>
  );
}
