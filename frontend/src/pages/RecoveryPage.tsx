/**
 * Password recovery explanation (FT-ACC-07, ui-mapping: password-recovery →
 * /password-help). The functional requirements define recovery as an
 * administrator task: the screen collects nothing, sends nothing and does not
 * create tokens or e-mail — only the explanation of how to reach the
 * administrator and a way back to the login.
 */
import "../features/identity/identity.css";
import { Link } from "react-router";

export function RecoveryPage(): React.ReactElement {
  return (
    <div className="vse-auth vse-auth-page">
      <span className="auth-orb one" aria-hidden="true" />
      <span className="auth-orb two" aria-hidden="true" />
      <div className="auth-shell">
        <section className="auth-welcome" aria-label="Восстановление пароля">
          <h1>
            Пароль восстанавливает <span className="auth-accent">администратор</span>
          </h1>
          <p className="auth-welcome-text">
            Самостоятельное восстановление пароля в системе не предусмотрено: письма и одноразовые ссылки не
            создаются. Пароль для учётной записи задаёт администратор.
          </p>
        </section>
        <section className="auth-card" aria-label="Как восстановить доступ">
          <h1>Как восстановить доступ</h1>
          <ol className="vse-recovery-steps">
            <li>Обратитесь к администратору вашей лаборатории лично.</li>
            <li>Назовите свои ФИО и логин учётной записи.</li>
            <li>
              Администратор проверит ваши данные и задаст новый пароль — после этого вход станет доступен.
            </li>
          </ol>
          <p className="auth-hint">
            Если учётная запись заблокирована, восстановление доступа также выполняет администратор.
          </p>
          <Link className="auth-back-link" to="/login">
            Вернуться ко входу
          </Link>
        </section>
      </div>
    </div>
  );
}
