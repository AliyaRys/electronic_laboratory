/**
 * Minimal application shell for F01: real header/components arrive with F02
 * (shared/ui/AppHeader per UI-02). This layout only guarantees one dirty-leave
 * dialog owner and an outlet-free nesting point.
 */
import type { ReactNode } from "react";

export function AppLayout({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <main>
      <div>Электронная лаборатория ВСЭ</div>
      {children}
    </main>
  );
}
