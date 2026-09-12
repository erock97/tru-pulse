import { workerFetch } from "./api";
import type {
  LiveAttempt,
  LiveCommand,
  LiveSessionState,
  LiveSubmission,
  LiveView,
} from "../../../shared/liveWorkshops";

export async function liveRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await workerFetch(`/rep/sessions${path}`, {
    signal,
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok)
    throw new Error(data.error || `Session request failed (${res.status}).`);
  return data;
}
export const sessionState = (
  id: string,
  view: LiveView,
  cursor = "",
  signal?: AbortSignal,
) =>
  liveRequest<
    LiveSessionState | { unchanged: true; cursor: string; serverTime: string }
  >(
    `/${id}?view=${view}&cursor=${encodeURIComponent(cursor)}`,
    undefined,
    signal,
  );
export const sessionCommand = (id: string, command: LiveCommand) =>
  liveRequest(`/${id}/commands`, command);

/** Retry exactly the persisted operation, including after an ambiguous network failure. */
export function prepareAttempt(
  key: string,
  activityId: string,
  response: Record<string, unknown>,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): LiveSubmission {
  const previous = storage.getItem(`${key}:pending`);
  if (previous) return JSON.parse(previous) as LiveSubmission;
  const operation = { id: crypto.randomUUID(), activityId, response };
  storage.setItem(`${key}:pending`, JSON.stringify(operation));
  return operation;
}
export async function submitAttempt(
  sessionId: string,
  key: string,
  activityId: string,
  response: Record<string, unknown>,
): Promise<LiveAttempt> {
  const operation = prepareAttempt(key, activityId, response);
  const result = await liveRequest<{ attempt: LiveAttempt }>(
    `/${sessionId}/submissions`,
    operation,
  );
  localStorage.removeItem(`${key}:pending`);
  return result.attempt;
}

export function readDraft<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
/** Stable option IDs are submitted; rotation is unrelated to certification positions. */
export function orderedChoices<T extends { id: string }>(
  choices: T[],
  seed: string,
): T[] {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const offset = hash % Math.max(choices.length, 1);
  return [...choices.slice(offset), ...choices.slice(0, offset)];
}
export function recordAttemptComplete(attempt: LiveAttempt) {
  const response = attempt.response.submission as
    | Record<string, unknown>
    | undefined;
  return (
    response?.phase !== "audit" &&
    attempt.response.phase !== "audit" &&
    (!attempt.grade || attempt.grade.passed)
  );
}
export function latestAttemptComplete(attempts: LiveAttempt[], dirty = false) {
  const latest = attempts
    .filter(
      (a) =>
        (a.response.submission as { phase?: string } | undefined)?.phase !==
          "audit" && a.response.phase !== "audit",
    )
    .at(-1);
  return !dirty && !!latest && recordAttemptComplete(latest);
}
