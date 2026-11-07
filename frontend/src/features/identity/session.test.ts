/**
 * Session orchestration tests: completeLogin drops the anonymous state first,
 * then publishes the fresh CSRF token and the non-secret working scope.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { clearQueryCache, useContextStore } from "../../entities/session/context";
import { getCsrfToken, setCsrfToken } from "../../shared/api/csrf";
import { completeLogin } from "./session";

describe("completeLogin", () => {
  it("seeds the scope and the CSRF token after clearing the anonymous state", () => {
    setCsrfToken("stale-anonymous-token");
    const client = new QueryClient();
    client.setQueryData(["stale"], { any: "data" });
    useContextStore.getState().setScope({ userId: "old-user", labId: "old-lab", productId: "old-product" });

    completeLogin(client, {
      user: { id: "user-1" } as never,
      contexts: [{ laboratory_id: "lab-9", product_scope_id: "prod-3" }],
      csrf_token: "fresh-session-token",
    });

    expect(client.getQueryData(["stale"])).toBeUndefined();
    expect(getCsrfToken()).toBe("fresh-session-token");
    expect(useContextStore.getState()).toMatchObject({
      userId: "user-1",
      labId: "lab-9",
      productId: "prod-3",
    });
  });

  it("keeps the dirty flag reset semantics of clearQueryCache", () => {
    const client = new QueryClient();
    useContextStore.getState().setScope({ userId: "x" });
    clearQueryCache(client);
    completeLogin(client, {
      user: { id: "user-2" } as never,
      contexts: [],
      csrf_token: "t2",
    });
    expect(useContextStore.getState().userId).toBe("user-2");
    expect(useContextStore.getState().labId).toBeNull();
  });
});
