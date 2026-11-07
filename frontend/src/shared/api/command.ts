/**
 * Command transport for mutations (API-01/SPEC-04, ADR-008/010).
 *
 * ``useCommand()`` runs one mutation at a time and exposes submit/status/error.
 * It never retries automatically; the Idempotency-Key is held until an
 * unambiguous result, so a manual retry after a network ambiguity reuses the
 * same key. Forms keep their input in component state — a failed command does
 * not clear anything.
 */
import { useCallback, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Problem } from "./problem";
import { networkProblem, problemFromParsed } from "./problem";

/** Problem codes that mean "the server has newer state" (API-01). */
const CONFLICT_CODES = new Set(["REVISION_CONFLICT", "STATE_CONFLICT"]);

export type CommandStatus = "idle" | "pending" | "success" | "error";

/** Minimal openapi-fetch result shape used by executors. */
export interface CommandResponse<TData> {
  data?: TData;
  response: Response;
}

export interface CommandContext {
  /** Stable until an unambiguous result; reuse is the manual retry. */
  idempotencyKey: string;
  signal: AbortSignal;
}

export type CommandExecutor<TData> = (ctx: CommandContext) => Promise<CommandResponse<TData>>;

export interface SubmitOptions {
  /** Client-side timeout in ms; aborts the request without retrying it. */
  timeoutMs?: number;
  /**
   * Query key of the resource this command mutates. On REVISION_CONFLICT the
   * hook offers {@link Command.refresh} to re-read the actual state through
   * the normal query (API-01: 409 предлагает актуальное состояние без
   * слияния — nothing is merged and nothing is resent automatically).
   */
  queryKey?: readonly unknown[];
}

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Tolerate components outside a QueryClientProvider (pure command usage);
 * refresh() simply stays a no-op when there is no client and no bound key.
 */
function useQueryClientSafe(): QueryClient | null {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

/** Controllers aborted because a newer submit superseded them, not on failure. */
const superseded = new WeakSet<AbortController>();

export interface Command<TData> {
  submit: (run: CommandExecutor<TData>, options?: SubmitOptions) => Promise<void>;
  /** Re-run the last executor with the SAME idempotency key. */
  retry: () => Promise<void>;
  /**
   * Re-read the current state through the bound query after a conflict offer.
   * Never merges input and never resends the command.
   */
  refresh: () => Promise<void>;
  abort: () => void;
  reset: () => void;
  status: CommandStatus;
  error: Problem | null;
  /** True while the server answered a conflict: actual state may be loaded. */
  conflict: boolean;
}

export function useCommand<TData = unknown>(client?: QueryClient): Command<TData> {
  const contextClient = useQueryClientSafe();
  const queryClient = client ?? contextClient;
  const [status, setStatus] = useState<CommandStatus>("idle");
  const [error, setError] = useState<Problem | null>(null);
  const [conflict, setConflict] = useState(false);
  const keyRef = useRef<string | null>(null);
  const runRef = useRef<CommandExecutor<TData> | null>(null);
  const queryKeyRef = useRef<readonly unknown[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const execute = useCallback(
    async (run: CommandExecutor<TData>, key: string, options?: SubmitOptions): Promise<void> => {
      const previous = abortRef.current;
      if (previous !== null) {
        superseded.add(previous);
        previous.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("pending");
      setError(null);
      setConflict(false);
      try {
        if (typeof options?.timeoutMs === "number") {
          timeoutRef.current = setTimeout(() => controller.abort(), options.timeoutMs);
        }
        const result = await run({ idempotencyKey: key, signal: controller.signal });
        clearTimer();
        if (controller.signal.aborted && superseded.has(controller)) {
          return; // superseded; the newer submit owns the visible state
        }
        // An HTTP answer is always unambiguous: the server has seen the
        // request, so the idempotency key is released either way.
        keyRef.current = null;
        runRef.current = null;
        if (!result.response.ok) {
          const problem = problemFromParsed((result as { error?: unknown }).error, result.response.status);
          setError(problem);
          // A conflict means the server holds newer state: offer the actual
          // read instead of retrying or merging (API-01).
          setConflict(CONFLICT_CODES.has(problem.code));
          setStatus("error");
          return;
        }
        setStatus("success");
      } catch (caught) {
        clearTimer();
        if (superseded.has(controller)) {
          return;
        }
        // Network ambiguity (timeout included): the server may or may not have
        // processed the command. Keep the key and the executor for an explicit
        // retry; never retry on our own.
        keyRef.current = key;
        runRef.current = run;
        setError(networkProblem(caught instanceof Error ? caught.message : "Сеть недоступна."));
        setStatus("error");
      }
    },
    [clearTimer],
  );

  const submit = useCallback(
    async (run: CommandExecutor<TData>, options?: SubmitOptions): Promise<void> => {
      queryKeyRef.current = options?.queryKey ?? null;
      const key = keyRef.current ?? newIdempotencyKey();
      await execute(run, key, options);
    },
    [execute],
  );

  const retry = useCallback(async (): Promise<void> => {
    const run = runRef.current;
    const key = keyRef.current;
    if (run === null || key === null) {
      return;
    }
    await execute(run, key);
  }, [execute]);

  const refresh = useCallback(async (): Promise<void> => {
    const queryKey = queryKeyRef.current;
    if (queryClient === null || queryKey === null) {
      setConflict(false);
      return;
    }
    // Read the actual state through the normal query pipeline; no input value
    // is overwritten and the command itself is not resent.
    await queryClient.refetchQueries({ queryKey, exact: true, type: "active" });
    setConflict(false);
  }, [queryClient]);

  const abort = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    clearTimer();
    keyRef.current = null;
    runRef.current = null;
    queryKeyRef.current = null;
    setError(null);
    setConflict(false);
    setStatus("idle");
  }, [clearTimer]);

  return { submit, retry, refresh, abort, reset, status, error, conflict };
}
