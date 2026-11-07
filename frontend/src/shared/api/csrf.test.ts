import { afterEach, describe, expect, it } from "vitest";
import { clearCsrfToken, getCsrfToken, setCsrfToken } from "./csrf";

describe("CSRF recovery", () => {
  afterEach(() => {
    clearCsrfToken();
    document.cookie = "vse_csrf=; Path=/; Max-Age=0; SameSite=Lax";
  });

  it("recovers the session token from the root cookie after an F5-like memory reset", () => {
    document.cookie = "vse_csrf=session-token-after-reload; Path=/; SameSite=Lax";
    setCsrfToken(null);

    expect(getCsrfToken()).toBe("session-token-after-reload");
  });

  it("prefers the current in-memory token while it is available", () => {
    document.cookie = "vse_csrf=cookie-token; Path=/; SameSite=Lax";
    setCsrfToken("memory-token");

    expect(getCsrfToken()).toBe("memory-token");
  });
});
