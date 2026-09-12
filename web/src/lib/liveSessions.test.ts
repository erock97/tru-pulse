import { describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ workerFetch: vi.fn() }));
import {
  orderedChoices,
  prepareAttempt,
  recordAttemptComplete,
  latestAttemptComplete,
} from "./liveSessions";
import { liveDraftKey, type LiveAttempt } from "../../../shared/liveWorkshops";

describe("live activity identity and retries", () => {
  it("namespaces drafts across agents, sessions, versions and activities", () => {
    const keys = [
      ["alice", "s1", "v1", "a1"],
      ["blair", "s1", "v1", "a1"],
      ["alice", "s2", "v1", "a1"],
      ["alice", "s1", "v2", "a1"],
      ["alice", "s1", "v1", "a2"],
    ].map(([u, s, v, a]) => liveDraftKey(u, s, v, a));
    expect(new Set(keys).size).toBe(5);
    expect(keys[0]).not.toContain("tru-rep-workshop-day");
  });
  it("reuses both request identity and submitted wording after an ambiguous failure", () => {
    const values = new Map<string, string>(),
      storage = {
        getItem: (k: string) => values.get(k) || null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      };
    const first = prepareAttempt(
      "private",
      "intro",
      { response: "My first attempt" },
      storage,
    );
    expect(
      prepareAttempt(
        "private",
        "intro",
        { response: "I edited the unsent draft" },
        storage,
      ),
    ).toEqual(first);
    values.delete("private:pending");
    const retry = prepareAttempt(
      "private",
      "intro",
      { response: "A new revision" },
      storage,
    );
    expect(retry.id).not.toBe(first.id);
  });
  it("changes display position while retaining option IDs and a stable reload order", () => {
    const choices = [{ id: "budget" }, { id: "invite" }, { id: "process" }];
    expect(orderedChoices(choices, "alice")).toEqual(
      orderedChoices(choices, "alice"),
    );
    const positions = new Set(
      ["alice", "blair", "casey"].map((s) =>
        orderedChoices(choices, s).findIndex((c) => c.id === "invite"),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
    expect(choices.map((c) => c.id)).toEqual(["budget", "invite", "process"]);
  });
  it("does not count a passed diagnosis as a completed repair", () => {
    const attempt: LiveAttempt = {
      id: "id",
      agentId: "alice",
      activityId: "repair",
      attempt: 1,
      assisted: false,
      submittedAt: "2026-09-12T12:00:00Z",
      response: { submission: { phase: "audit" } },
      grade: { passed: true, score: 4, max: 4, checks: [] },
    };
    expect(recordAttemptComplete(attempt)).toBe(false);
    expect(
      recordAttemptComplete({
        ...attempt,
        response: { submission: { stage: "Spoke with customer" } },
      }),
    ).toBe(true);
    expect(
      recordAttemptComplete({
        ...attempt,
        response: { submission: {} },
        grade: { passed: false } as LiveAttempt["grade"],
      }),
    ).toBe(false);
    const passed = {
      ...attempt,
      response: { submission: { stage: "Appointment set" } },
    };
    expect(latestAttemptComplete([passed])).toBe(true);
    expect(latestAttemptComplete([passed], true)).toBe(false);
    expect(
      latestAttemptComplete([
        passed,
        { ...passed, grade: { passed: false, score: 0, max: 2, checks: [] } },
      ]),
    ).toBe(false);
  });
});
