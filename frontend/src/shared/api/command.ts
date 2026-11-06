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
import type { Problem } from "./problem";
import { networkProblem, problemFromParsed } from "./problem";

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
}

function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Controllers aborted because a newer submit superseded them, not on failure. */
const superseded = new WeakSet<AbortController>();

export interface Command<TData> {
  submit: (run: CommandExecutor<TData>, options?: SubmitOptions) => Promise<void>;
  /** Re-run the last executor with the SAME idempotency key. */
  retry: () => Promise<void>;
  abort: () => void;
  reset: () => void;
  status: CommandStatus;
  error: Problem | null;
}

export function useCommand<TData = unknown>(): Command<TData> {
  const [status, setStatus] = useState<CommandStatus>("idle");
  const [error, setError] = useState<Problem | null>(null);
  const keyRef = useRef<string | null>(null);
  const runRef = useRef<CommandExecutor<TData> | null>(null);
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
          const parsed = (result as { error?: unknown }).error;
          setError(problemFromParsed(parsed, result.response.status));
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

  const abort = useCallback((): void => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback((): void => {
    clearTimer();
    keyRef.current = null;
    runRef.current = null;
    setError(null);
    setStatus("idle");
  }, [clearTimer]);

  return { submit, retry, abort, reset, status, error };
}
