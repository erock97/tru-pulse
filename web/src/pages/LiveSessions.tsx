import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  LiveAttempt,
  LiveGroup,
  LivePreflight,
  LiveSessionState,
  LiveSessionSummary,
  LiveView,
} from "../../../shared/liveWorkshops";
import {
  LIVE_IDLE_POLL_MS,
  LIVE_POLL_MS,
  liveDraftKey,
} from "../../../shared/liveWorkshops";
import { assignmentStatus } from "../../../shared/coachingAssignments";
import { learnerWorkshopDefinition, workshopCatalog } from "../../../shared/workshopCatalog";
import type { WorkshopActivity } from "../../../shared/workshopCatalog";
import {
  liveRequest,
  orderedChoices,
  readDraft,
  recordAttemptComplete,
  latestAttemptComplete,
  sessionCommand,
  sessionState,
  submitAttempt,
} from "../lib/liveSessions";
import { PracticeRecord, type PracticeScenario } from "./PracticeRecord";
import { DealMock } from "./DealSlide";
import { RecordMap } from "./RecordMap";
import CoachingAssignments from "../components/CoachingAssignments";
import { adminReturn, hasAdminReturn } from "../lib/api";
import workshopCss from "../workshops/workshop.css?inline";
import recordCss from "../workshops/practiceRecord.css?inline";
import "./liveSessions.css";
import { LiveSlideNavigation } from "./LiveSlideNavigation";
import { PresentationFit } from "./PresentationFit";
import { day2SpeakingNotes } from "./day2SpeakingNotes";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "The request could not be completed.";
const activityOf = (state: LiveSessionState, id: string | null) =>
  state.definition.slides.find((s) => s.activity?.id === id)?.activity;
const nameOf = (state: LiveSessionState, id: string | null) =>
  state.participants.find((p) => p.agentId === id)?.name ||
  "Coach / not assigned";
const link = (id: string, view: LiveView = "agent") =>
  `#/rep/sessions/${id}/${view}`;

function Frame({
  title,
  children,
  shared = false,
}: {
  title: string;
  children: ReactNode;
  shared?: boolean;
}) {
  return (
    <main className={`live-rep ${shared ? "live-shared" : ""}`}>
      <header className="live-top">
        <a href="#/rep">
          TRU <span>REP</span>
        </a>
        <span>{shared ? "SHARED PRESENTATION" : "LIVE TRAINING"}</span>
      </header>
      <div className="live-wrap">
        <h1>{title}</h1>
        {!shared && hasAdminReturn() && (
          <p className="live-notice">
            You are viewing a team's workspace. To lead training across teams,
            return to your own workspace.{" "}
            <button onClick={() => void adminReturn()}>
              Return to my workspace
            </button>
          </p>
        )}
        {children}
      </div>
    </main>
  );
}

export default function LiveSessions({ route }: { route: string }) {
  const requestedDay = Number(new URLSearchParams(route.split('?')[1] || '').get('day'));
  const initialDay = [1, 2, 3, 4].includes(requestedDay) ? requestedDay : 1;
  const notesOnly = new URLSearchParams(route.split('?')[1] || '').get('notes') === '1';
  const match = route.split('?')[0].match(
    /^\/rep\/sessions\/([a-f0-9-]+)\/(presenter|shared|agent|coach)$/i,
  );
  return match ? (
    <Session
      key={`${match[1]}:${match[2]}:${notesOnly}`}
      id={match[1]}
      view={match[2] as LiveView}
      notesOnly={notesOnly && match[2] === 'presenter'}
    />
  ) : (
    <Lobby key={initialDay} initialDay={initialDay} />
  );
}

export function Lobby({ initialDay = 1 }: { initialDay?: number }) {
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [sessions, setSessions] = useState<LiveSessionSummary[]>([]),
    [preflight, setPreflight] = useState<LivePreflight | null>(null);
  const [error, setError] = useState(""),
    [enabled, setEnabled] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false);
  const [day, setDay] = useState(initialDay),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [roster, setRoster] = useState<Record<string, string>>({}),
    [presenters, setPresenters] = useState<string[]>([]);
  const load = useCallback(async () => {
    try {
      const result = await liveRequest<{
        enabled: boolean;
        sessions: LiveSessionSummary[];
      }>("");
      setEnabled(result.enabled);
      setSessions(result.sessions);
      if (result.enabled)
        setPreflight(await liveRequest<LivePreflight>("/preflight"));
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const filteredAgents = (preflight?.agents ?? []).filter(
    (a) =>
      (!team || a.teamId === team) &&
      a.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  async function create(testOnly = false) {
    setBusy(true);
    setError("");
    try {
      const result = await liveRequest<{ id: string }>("", {
        id: crypto.randomUUID(),
        day,
        timezone,
        participants: testOnly ? [] : Object.keys(roster).map((agentId) => ({ agentId })),
        presenterIds: testOnly ? [] : presenters,
      });
      window.location.hash = link(result.id, "presenter");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Live training">
      <p className="live-intro">
        {preflight?.canCreate
          ? "Select your agents, create a session, and start teaching. Their responses and follow-up come back to you."
          : "Open your assigned session and follow along. Your responses reach your presenter when you submit."}
      </p>
      {error && (
        <div role="alert" className="live-error">
          {error} <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {enabled === false && (
        <section className="live-card">
          <h2>Live sessions are not enabled</h2>
          <p>
            Your existing training and certifications are still available in
            Rep.
          </p>
        </section>
      )}
      {enabled === null && !error && <p role="status">Loading sessions…</p>}
      {sessions.length > 0 && <h2>Resume a saved session</h2>}
      <section className="live-grid">
        {sessions.map((s) => (
          <article className="live-card" key={s.id}>
            <span className="live-kicker">
              DAY {s.day} · {s.status}
            </span>
            <h2>{s.title}</h2>
            <p>
              {s.timezone} · Version {s.version}
            </p>
            <div className="live-actions">
              <a
                className="live-button"
                href={link(
                  s.id,
                  s.canPresent ? "presenter" : s.canReview ? "coach" : "agent",
                )}
              >
                Resume Day {s.day} session
              </a>
              {s.canPresent && (
                <a href={link(s.id, "presenter")}>Presenter console →</a>
              )}
              {s.canReview && (
                <a href={link(s.id, "coach")}>Coach evidence & follow-up →</a>
              )}
            </div>
          </article>
        ))}
      </section>
      {enabled && sessions.length === 0 && (
        <p>No sessions are assigned to this account yet.</p>
      )}
      {preflight?.canCreate && (
        <section className="live-card">
          <h2>Start a new Day {day} session</h2>
          <p>
            Choose your training and agents. You lead the session and receive
            their follow-up automatically.
          </p>
          <div className="live-grid">
            <label>
              Training
              <select
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Object.values(workshopCatalog).map(d=><option key={d.day} value={d.day}>Day {d.day} · {d.title}</option>)}
              </select>
            </label>
            <label>
              Session timezone
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                list="live-zones"
              />
              <datalist id="live-zones">
                {[
                  "America/Los_Angeles",
                  "America/Denver",
                  "America/Chicago",
                  "America/New_York",
                ].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </datalist>
            </label>
          </div>
          <section aria-label="Test on your own">
            <button disabled={busy || !timezone} onClick={() => void create(true)}>
              Test Day {day} without agents
            </button>
            <p>{day <= 3 ? 'Test the presentation, submit as a test learner, and review saved responses and feedback.' : 'Open the real presenter and shared presentation screens on your own.'} No agents are added and no agent follow-up is created.</p>
          </section>
          <fieldset>
            <legend>Select agents</legend>
            <div className="live-grid">
              <label>
                Find an agent
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name"
                />
              </label>
              <label>
                Filter roster by team
                <select value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">All teams</option>
                  {[
                    ...new Map(
                      preflight.agents.map((a) => [a.teamId, a.teamName]),
                    ).entries(),
                  ].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p role="status">
              {filteredAgents.length} matching agents |{" "}
              {Object.keys(roster).length} selected. Selections stay selected
              when you change filters.
            </p>
            <div className="live-roster-list">
              {filteredAgents.map((a) => (
                <div className="live-roster-choice" key={a.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={a.id in roster}
                      onChange={(e) =>
                        setRoster((r) => {
                          const next = { ...r };
                          if (e.target.checked) next[a.id] = "";
                          else delete next[a.id];
                          return next;
                        })
                      }
                    />
                    {a.name} · {a.teamName}
                  </label>
                  <span>
                    {!a.userId
                      ? "Account not linked"
                      : !a.email
                        ? "Email missing"
                        : "Account linked"}
                  </span>
                </div>
              ))}
            </div>
          </fieldset>
          <details>
            <summary>Add another presenter (optional)</summary>
            <fieldset>
              <legend>Additional presenter</legend>
              {preflight.coaches
                .filter((c) => c.id !== preflight.viewerId)
                .map((c) => (
                  <label className="live-inline" key={c.id}>
                    <input
                      type="checkbox"
                      checked={presenters.includes(c.id)}
                      onChange={(e) =>
                        setPresenters((p) =>
                          e.target.checked
                            ? [...p, c.id]
                            : p.filter((id) => id !== c.id),
                        )
                      }
                    />
                    {c.name}
                  </label>
                ))}
            </fieldset>
          </details>
          <p>
            Selected agents will see this session in their existing TRU
            accounts. No new invitation is needed. An agent whose account is not
            yet linked must complete their existing account setup.
          </p>
          <button
            disabled={busy || Object.keys(roster).length === 0 || !timezone}
            onClick={() => void create()}
          >
            {busy ? `Creating Day ${day}…` : `Create Day ${day} session`}
          </button>
        </section>
      )}
      {preflight?.canCreate && <DeliveryLog preflight={preflight} />}
    </Frame>
  );
}

function DeliveryLog({ preflight }: { preflight: LivePreflight }) {
  const [rows, setRows] = useState<
      Array<{
        user_id: string;
        day: string;
        status: string;
        attempts: number;
        last_error: string | null;
      }>
    >([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  async function load() {
    try {
      const result = await liveRequest<{ deliveries: typeof rows }>(
        "/deliveries",
      );
      setRows(result.deliveries);
      setLoaded(true);
      setError("");
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <details className="live-card">
      <summary>Daily digest delivery</summary>
      <p>
        Email status is separate from assignment completion. Failed messages
        retry up to eight times; unresolved failures need an operator check.
      </p>
      <button onClick={() => void load()}>Refresh delivery status</button>
      {error && <p role="alert">{error}</p>}
      {loaded && !rows.length && <p>No delivery attempts recorded.</p>}
      {rows.map((r) => (
        <p key={`${r.user_id}:${r.day}`}>
          <b>
            {preflight.coaches.find((c) => c.id === r.user_id)?.name ||
              preflight.agents.find((a) => a.userId === r.user_id)?.name ||
              "Former session participant"}
          </b>{" "}
          · {r.day} · {r.status} · {r.attempts} attempts
          {r.last_error ? ` · ${r.last_error}` : ""}
        </p>
      ))}
    </details>
  );
}

function Session({ id, view, responseOnly = false, notesOnly = false }: { id: string; view: LiveView; responseOnly?: boolean; notesOnly?: boolean }) {
  const [state, setState] = useState<LiveSessionState | null>(null),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [now, setNow] = useState(Date.now());
  const cursor = useRef(""),
    refresh = useRef<() => void>(() => {});
  const ended = useRef(false);
  ended.current = state?.session.status === "ended";
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    let busy = false;
    const heartbeat =
      view === "agent"
        ? setInterval(() => {
            if (!document.hidden && !ended.current)
              void liveRequest(`/${id}/join`, {}).catch(() =>
                setConnected(false),
              );
          }, 10000)
        : undefined;
    const poll = async (force = false) => {
      if (busy || stopped) return;
      busy = true;
      try {
        const result = await sessionState(
          id,
          view,
          force ? "" : cursor.current,
          abort.signal,
        );
        if (stopped) return;
        if (!("unchanged" in result)) {
          setState(result);
          cursor.current = result.cursor;
        }
        setConnected(true);
        setError("");
      } catch (e) {
        if (!stopped) {
          setConnected(false);
          setError(message(e));
        }
      } finally {
        busy = false;
        if (!stopped)
          timer = setTimeout(
            () => void poll(),
            document.hidden || ended.current ? LIVE_IDLE_POLL_MS : LIVE_POLL_MS,
          );
      }
    };
    refresh.current = () => {
      clearTimeout(timer);
      void poll(true);
    };
    if (view === "agent")
      void liveRequest(`/${id}/join`, {})
        .catch((e) => setError(message(e)))
        .finally(() => void poll());
    else void poll();
    const onVisible = () => {
      if (!document.hidden) refresh.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      abort.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, view]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!state && responseOnly) return <p role={error ? "alert" : "status"}>{error || "Connecting your response form…"}</p>;
  if (state && responseOnly) return <><p role="status">{connected ? "Connected · responses save to this session" : "Connection interrupted · retrying"}</p>{error && <p role="alert">{error}</p>}<ResponseWorkspace state={state} refresh={() => refresh.current()} /></>;
  if (!state)
    return (
      <Frame title="Live training">
        <p role={error ? "alert" : "status"}>
          {error || "Connecting to your session…"}
        </p>
        <a href="#/rep/sessions">All sessions</a>
      </Frame>
    );
  const seconds = state.timerEndsAt
    ? Math.max(0, Math.ceil((Date.parse(state.timerEndsAt) - now) / 1000))
    : null;
  return (
    <Frame title={`Day ${state.session.day} · ${state.session.title}`} shared={(view !== "coach" && state.session.day <= 4) || view === "shared"}>
      <div className="live-session-bar">
        {view !== "shared" && <a href="#/rep/sessions">All sessions</a>}
        <span role="status">
          {connected ? "Connected" : "Connection interrupted · retrying"}
        </span>
        <span>
          {state.session.status} · {state.session.timezone}
        </span>
        {seconds !== null && (
          <time aria-label="Activity time remaining">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </time>
        )}
      </div>
      {error && (
        <p className="live-error" role="alert">
          {error}
        </p>
      )}
      {state.rehearsal && state.session.day > 3 && view !== 'shared' && <section className="live-notice">
        <strong>Solo rehearsal · test evidence only</strong>
        <p>Submit as the test learner, then review and reveal from the presenter console. Responses and feedback are saved for this test; no agents receive assignments.</p>
        <div className="live-actions"><a href={link(id,'agent')} target="_blank" rel="noreferrer">Open test learner</a><a href={link(id,'presenter')} target="_blank" rel="noreferrer">Open presenter console</a><a href={link(id,'shared')} target="_blank" rel="noreferrer">Open presentation</a></div>
      </section>}
      {notesOnly ? <PresenterSpeakingNotes state={state} /> : state.session.day <= 4 && view !== "coach" ? (
        <SimpleLiveStage state={state} refresh={() => refresh.current()} view={view} />
      ) : view === "presenter" ? (
        <Presenter state={state} refresh={() => refresh.current()} />
      ) : view === "shared" ? (
        <Projection state={state} refresh={() => refresh.current()} />
      ) : view === "coach" ? (
        <CoachEvidence state={state} />
      ) : (
        <AgentWorkspace state={state} refresh={() => refresh.current()} />
      )}
    </Frame>
  );
}

type Slide = LiveSessionState["definition"]["slides"][number];
export function PresenterSpeakingNotes({state}:{state:LiveSessionState}) {
  useEffect(()=>{document.scrollingElement?.scrollTo?.({top:0});},[state.session.currentSlideId]);
  if (!state.canPresent) return <p role="alert">Only the presenter can open these notes.</p>;
  const index = Math.max(0,state.definition.slides.findIndex(s=>s.id === state.session.currentSlideId));
  const slide = state.definition.slides[index];
  const prompts = state.definition.day === 2 ? day2SpeakingNotes[slide.id === 'day2-lead-discussion' && slide.activity?.choices?.some(c=>c.id === 'five') ? 'response-time' : slide.id.replace(/^day2-/,'')] : undefined;
  return <article className="live-speaking-notes">
    <p>PRIVATE PRESENTER NOTES · Slide {index+1} of {state.definition.slides.length} · {slide.time} minutes</p>
    <h1>{slide.title}</h1>
    <p className="live-notes-help">These notes follow the live slide automatically. Keep this tab on your other screen or device. In your meeting, share only the presentation tab or window.</p>
    <h2>What to say</h2><p className="live-speaking-script">{prompts?.[0] || slide.notes.split('Handoff:')[0].split('Sources:')[0]}</p>
    {prompts && <><h2>Ask or demonstrate</h2><p>{prompts[1]}</p></>}
    {slide.activity?.choices && <><h2>Run the question</h2><p>Ask for a choice and a reason. People with HQ access submit their own responses. For people answering aloud, select the group’s choice in the presenter window and click Submit answer to show the explanation.</p><p><strong>Answer to discuss: </strong>{slide.activity.choices.find(c=>c.id === slide.activity?.correctChoiceId)?.text}</p><p>{slide.activity.model}</p></>}
    <h2>{index === state.definition.slides.length-1 ? 'Close the session' : 'Move to the next slide'}</h2><p className="live-speaking-script">{slide.cue}</p>
    <a href={link(state.session.id,'presenter')} target="_blank" rel="noreferrer">Open presenter controls</a>
  </article>;
}
function SlideBody({
  slide,
  children,
  presentation = false,
}: {
  slide: Slide;
  children?: ReactNode;
  presentation?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    [root, setRoot] = useState<ShadowRoot | null>(null);
  useEffect(() => {
    if (host.current)
      setRoot(
        host.current.shadowRoot || host.current.attachShadow({ mode: "open" }),
      );
  }, []);
  useEffect(() => {
    if (!root) return;
    const controller = new AbortController();
    root
      .querySelectorAll<HTMLImageElement>(".screen-figure img")
      .forEach((img) => {
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", `Enlarge ${img.alt}`);
      });
    const interact = (event: Event) => {
      const target = event.target as HTMLElement;
      if (
        event instanceof KeyboardEvent &&
        event.key !== "Enter" &&
        event.key !== " "
      )
        return;
      if (target.closest('[data-action="resources"]')) {
        event.preventDefault();
        const day = slide.id.match(/^day([1-4])-/)?.[1];
        if (day)
          window.open(
            `/workshops/day${day}-resources.html`,
            "_blank",
            "noopener",
          );
        return;
      }
      const img =
        target.closest(".details-focus")?.querySelector("img") ||
        (target.matches(".screen-figure img")
          ? (target as HTMLImageElement)
          : null);
      if (!img) return;
      event.preventDefault();
      const dialog = document.createElement("dialog");
      dialog.className = "image-dialog";
      const close = document.createElement("button");
      close.textContent = "Close image";
      close.onclick = () => dialog.close();
      const enlarged = document.createElement("img");
      enlarged.src = img.src;
      enlarged.alt = img.alt;
      dialog.append(close, enlarged);
      root.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      dialog.showModal();
    };
    root.addEventListener("click", interact, { signal: controller.signal });
    root.addEventListener("keydown", interact, { signal: controller.signal });
    return () => controller.abort();
  }, [root, slide.id]);
  return (
    <div ref={host}>
      {root &&
        createPortal(
          <>
            <style>
              {workshopCss}
              {recordCss}
              {`:host{display:block;min-height:0;background:transparent;color:#182321}*{box-sizing:border-box} .workshop{min-height:0;background:#f2f0e9;color:#182321;padding:0}.slide{min-height:0;padding:28px;display:block}.content{max-width:none}.native-lab .pr{max-width:none;color:#182321}.native-lab .pr-jobs{background:#253734;color:#f3f0e6;padding:20px;position:relative;top:0;--ac-text:#f3f0e6;--ac-text-60:#c9d5cd}.native-lab .pr-after{color:#182321}.native-lab{--gold:#c4d5ab;--ac:#c4d5ab;--ac-text:#182321;--ac-text-60:#52625a}.native-lab button{cursor:pointer}button,input,textarea,select{font:inherit}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #527c61;outline-offset:3px}.btn{padding:10px 18px;border-radius:6px}.screen-figure img{max-width:100%;height:auto}.err{color:#9c3227} .live-native-disabled{pointer-events:none;opacity:.7} @media(max-width:600px){.slide{padding:14px}}`}
            </style>
            {presentation && <style>{`
              :host{min-height:0;background:transparent}
              .workshop,.preferred-live-workshop{min-height:0;margin:0;max-width:none}
              .slide,.slide.tru{display:flex;flex-direction:column;gap:20px;overflow:visible;min-height:0;padding:clamp(22px,3vw,44px);border:0;border-radius:0;box-shadow:none}
              .slide h2,.preferred-live-workshop .slide.tru h2{font:600 clamp(30px,3.2vw,52px)/1.15 Manrope,system-ui,sans-serif;letter-spacing:-.04em;margin:0}
              .slide .content{min-width:0;flex:0;gap:20px}
              .slide,.slide.tru{padding:24px 32px;gap:12px;animation:none}
              .slide.alms{background:transparent!important}
              .workshop:has(.lesson-photo),.workshop:has(.lesson-practice-photo),.workshop:has(.lesson-closing-photo),.workshop:has(.alms-cover){background:transparent}
              .slide.lesson-photo>*,.slide.lesson-photo h2,.slide.lesson-photo .lead,.slide.lesson-practice-photo>*,.slide.lesson-closing-photo>*,.slide.lesson-practice-photo .lead,.slide.lesson-closing-photo .lead{max-width:65%}
              .slide h2,.preferred-live-workshop .slide.tru h2{font-size:36px}
              .slide .lead{font-size:20px;max-width:none}
              .slide .content{font-size:18px;gap:14px}
              .slide .row,.slide.tru .row{padding:14px 0;gap:24px;grid-template-columns:210px minmax(0,1fr)}
              .slide .row p,.slide.tru .row p{font-size:18px;line-height:1.45}
              .slide .row h3,.slide.tru .row h3{font-size:22px}
              .slide.training-depth.lesson-photo>*,.slide.training-depth.lesson-photo h2,.slide.training-depth.lesson-photo .lead{max-width:58%}
              .slide.training-depth.quadrant-cover{min-height:600px;color:#17232d}
              .slide.training-depth .quadrant-agenda{gap:24px 36px}
              .slide.training-depth .quadrant-agenda h3{font-size:22px}
              .slide.training-depth .quadrant-agenda p{font-size:18px}
              .reference-screen-scroll{overflow:visible;border:0}
              .slide .reference-screen img,.slide.tru .reference-screen img,.product-reference img,.product-pair img,.screen-figure>img{width:auto;min-width:0;max-width:100%;max-height:440px;height:auto;object-fit:contain;margin-inline:auto}
              .reference-screen figcaption,.product-reference figcaption{font-size:12px}
              .native-lab .pr-jobs{padding:14px}
              @media(max-width:600px){.slide,.slide.tru{padding:20px 16px}.slide h2,.preferred-live-workshop .slide.tru h2{font-size:30px}}
            `}</style>}
            <div className={slide.theme?.split(" ").includes("tru") ? "workshop preferred-live-workshop" : "workshop"}>
              <section className={`slide ${slide.theme || ""}`}>
                <div className="meta">
                  {slide.chapter} · {slide.time} {slide.time === 1 ? 'minute' : 'minutes'}
                </div>
                <h2>{slide.title}</h2>
                <p className="lead">{slide.lead}</p>
                {!slide.native && (
                  <div
                    className="content"
                    dangerouslySetInnerHTML={{
                      __html: (presentation ? slide.body.replace('Scroll to inspect the full screen. ', 'Full-screen reference. ').replace('Full People reference image; scroll to inspect all controls', 'Full People reference image') : slide.body).replace(
                        /<button\b[^>]*data-action="restart"[^>]*>[\s\S]*?<\/button>/g,
                        "",
                      ),
                    }}
                  />
                )}
                {slide.native === "map" && <RecordMap />}
                {children}
              </section>
            </div>
          </>,
          root,
        )}
    </div>
  );
}
function DiscussionChoices({sessionId,activity,presenting,showSelection,disabled,onSubmit}:{sessionId:string;activity:WorkshopActivity;presenting:boolean;showSelection:boolean;disabled:boolean;onSubmit:()=>Promise<boolean>}) {
  const key = 'tru-discussion-choice:' + sessionId + ':' + activity.id;
  const [selected,setSelected] = useState(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });
  const [submitted,setSubmitted] = useState(false);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if(event.key === key) setSelected(event.newValue || ''); };
    window.addEventListener('storage',sync);
    return () => window.removeEventListener('storage',sync);
  },[key]);
  function choose(id:string) {
    setSubmitted(false);
    const next=selected === id ? '' : id;
    setSelected(next);
    try { localStorage.setItem(key,next); } catch { /* The presenter can still select in this window. */ }
  }
  return <section className="live-card live-alms-activity"><ol className="live-choice-options" type="A">{activity.choices!.map(c => <li key={c.id} className={showSelection && selected === c.id ? 'discussion-selected' : ''}>{presenting ? <button className="live-discussion-choice" disabled={disabled} aria-pressed={selected === c.id} onClick={() => choose(c.id)}>{c.text}</button> : <span className="live-discussion-option">{c.text}</span>}</li>)}</ol>{presenting && <div className="live-discussion-hint"><p>Choose the group’s answer and ask why. Submit to show the explanation.</p><button disabled={disabled || !selected || submitted} onClick={async()=>{if(await onSubmit()) setSubmitted(true);}}>{submitted ? 'Answer submitted' : 'Submit answer'}</button></div>}</section>;
}

/** One current slide drives both the learner's form and the presenter's inbox. */
export function SimpleLiveStage({ state, refresh, view }: { state: LiveSessionState; refresh: () => void; view: LiveView }) {
  const definition = learnerWorkshopDefinition(state.definition, state.revealedActivityIds);
  const slide = definition.slides.find(s => s.id === state.session.currentSlideId) || definition.slides[0];
  const activity = slide.activity;
  const presenting = view === "presenter" && state.canPresent;
  const learner = view === "agent" || (view === "shared" && !state.canPresent);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commandPending = useRef(false);
  async function run(command: Parameters<typeof sessionCommand>[1]) {
    if (commandPending.current) return false;
    commandPending.current = true;
    setBusy(true); setError("");
    try { await sessionCommand(state.session.id, command); refresh(); return true; }
    catch (e) { setError(message(e)); return false; }
    finally { commandPending.current = false; setBusy(false); }
  }

  const rawActivity = activityOf(state, activity?.id || null);
  const answers = state.participants.map(p => ({ p, attempt: state.attempts.filter(a => a.agentId === p.agentId && a.activityId === activity?.id).at(-1) }));
  return <>
    <div className="live-simple-toolbar">
      <LiveSlideNavigation state={{...state, canPresent: presenting}} refresh={refresh} keyboard={presenting} />
      {presenting && <details className="live-session-tools"><summary>Session</summary><div>
        <a href={link(state.session.id,"shared")} target="_blank" rel="noreferrer">Open screen to share</a>
        <a href={link(state.session.id,"agent")} target="_blank" rel="noreferrer">{state.rehearsal ? "Open test learner" : "Agent join link"}</a>
        <p>{state.rehearsal ? "Solo test · no real agents. Submit in the test learner tab; answers arrive here." : "Share the presentation window in your meeting. Agents open the join link on their own devices."}</p>
        <button disabled={busy || state.session.status === "ended"} onClick={() => void run({action:"end"})}>End {state.rehearsal ? "rehearsal" : "session"}</button>
      </div></details>}
      {presenting && <a className="live-open-notes" href={link(state.session.id,'presenter')+'?notes=1'} target="_blank" rel="noreferrer">Open presenter notes ↗</a>}
    </div>
    {error && <p role="alert">{error}</p>}
    <div className={`live-presentation-layout ${activity && (presenting || learner) ? "with-responses" : ""}`}>
      <PresentationFit key={slide.id} theme={slide.theme}>
        <SlideBody slide={slide} presentation>
          {slide.native === "deal" && <DealMock />}
          {slide.native === "practice" && !learner && <PracticeRecord scenario={slide.scenario as PracticeScenario} record={false} />}
        </SlideBody>
        {activity?.choices && <DiscussionChoices key={state.session.id + activity.id} sessionId={state.session.id} activity={activity} presenting={presenting} showSelection={presenting || (view === "shared" && state.canPresent)} disabled={busy || state.session.status === 'ended'} onSubmit={()=>run({action:'reveal',activityId:activity.id})} />}
        {activity && (activity.model || activity.explanation) && <section className="live-card live-alms-activity"><h3>Discuss</h3><p>{activity.model || activity.explanation}</p></section>}
      </PresentationFit>
      {activity && learner && <aside className="live-response-panel" aria-label="Answer the current question">
        {view === "agent" ? <ResponseWorkspace state={state} refresh={refresh} /> : <Session id={state.session.id} view="agent" responseOnly />}
      </aside>}
      {activity && presenting && <aside className="live-response-panel" aria-label="Current question responses">
        <h2>Answers · {answers.filter(a => a.attempt).length} / {answers.length}</h2>
        {!answers.some(a => a.attempt) && <p>Answers appear here as agents submit.</p>}
        {answers.filter(a => a.attempt).map(({p,attempt}) => <section className="live-card" key={p.agentId}><h3>{p.name}</h3><Attempt attempt={attempt!} activity={rawActivity} /></section>)}
        <button disabled={busy || state.session.status === "ended" || state.revealedActivityIds.includes(activity.id)} onClick={() => void run({action:"reveal",activityId:activity.id})}>{state.revealedActivityIds.includes(activity.id) ? "Answer shared" : "Share answer & discuss"}</button>
        {rawActivity && <details><summary>Teaching notes</summary><p>{rawActivity.explanation}</p><blockquote>{rawActivity.model}</blockquote></details>}
        {activity.kind === "roleplay" && <PartnerSetup state={state} activity={rawActivity} run={run} simple />}
      </aside>}
    </div>
    {presenting && (state.session.day === 2 || state.session.day === 3) && <p className="live-presenter-cue"><strong>Presenter cue:</strong> {state.definition.slides.find(s => s.id === slide.id)?.cue}</p>}
  </>;
}

export function Projection({ state, refresh }: { state: LiveSessionState; refresh: () => void }) {
  const slide =
    state.definition.slides.find(
      (s) => s.id === state.session.currentSlideId,
    ) ||
    state.definition.slides.find(
      (s) => s.activity?.id === state.session.currentActivityId,
    ) ||
    state.definition.slides[0];
  const activity = slide.activity,
    totals = activity ? state.choiceTotals[activity.id] : null;
  const [showResponses,setShowResponses]=useState(state.rehearsal || !state.canPresent);
  const nextActivity = state.definition.slides.slice(state.definition.slides.indexOf(slide) + 1).find(s => s.activity);
  const [activityError,setActivityError]=useState('');
  const [opening,setOpening]=useState(false);
  useEffect(()=>setActivityError(''),[slide.id]);
  async function startActivity() {
    if(!activity || opening || state.session.status==='ended')return;
    setOpening(true);setActivityError('');
    try { await sessionCommand(state.session.id,{action:'open',activityId:activity.id}); refresh(); }
    catch(e){setActivityError(message(e));}
    finally{setOpening(false);}
  }

  return (
    <>
      <LiveSlideNavigation state={state} refresh={refresh} keyboard />
      <p className="live-presentation-help">
        {state.canPresent ? "Present from this window. Use Previous / Next or the left and right arrow keys. " : "Slides change when the presenter advances. "}
        The whole slide fits this window.
      </p>
      <div className="live-participation-toolbar">
        <span>{activity ? "Your turn · choose or write, then submit" : nextActivity ? `Next participation: ${nextActivity.title}` : "Session wrap-up"}</span>
        <button aria-pressed={showResponses} onClick={() => setShowResponses(!showResponses)}>{showResponses ? "Hide response panel" : state.rehearsal ? "Answer as test learner" : "Open my response panel"}</button>
        {state.canPresent && <a href={link(state.session.id,"presenter")} target="_blank" rel="noreferrer">Presenter console</a>}
      </div>
      {activity && <div className="live-engagement-bar">
        <strong>{activity.kind==='choice'?'VOTE NOW':activity.kind==='roleplay'?'BREAKOUT PRACTICE':'WRITE & DISCUSS'} · {slide.time} minutes</strong>
        <span>{showResponses ? "Submit in the response panel beside this slide." : "Open your response panel to answer."}</span>
        {state.canPresent && <>
          {state.openedActivityIds.includes(activity.id)?<span>Responses open</span>:<button disabled={opening || state.session.status==='ended'} onClick={()=>void startActivity()}>{opening?'Opening…':'Open responses for agents'}</button>}
          <a href={link(state.session.id,'presenter')} target="_blank" rel="noreferrer">{activity.kind==='roleplay'?'Assign pairs / trios':'Review responses & reveal'}</a>
        </>}
        {activityError && <span role="alert">{activityError}</span>}
      </div>}
      <div className={`live-presentation-layout ${showResponses ? "with-responses" : ""}`}>
      <PresentationFit key={slide.id} theme={slide.theme}>
      <SlideBody slide={slide} presentation>
        {slide.native === "deal" && (
          <div style={{ maxWidth: 720, position: "relative", minHeight: 400 }}>
            <DealMock />
          </div>
        )}
        {slide.native === "practice" && (
          <div className="native-lab">
            <p>Presenter demonstration · excluded from learner results.</p>
            <PracticeRecord
              scenario={slide.scenario as PracticeScenario}
              record={false}
            />
          </div>
        )}
      </SlideBody>
      {activity && !showResponses && (
        <section className={`live-card ${slide.theme?.includes('alms') ? 'live-alms-activity' : ''}`}>
          {activity.prompt !== slide.lead && activity.prompt !== slide.title && <h2>{activity.prompt}</h2>}
          {!totals && activity.choices && <ol className="live-choice-options" type="A">{activity.choices.map(c => <li key={c.id}>{c.text}</li>)}</ol>}
          {activity.fields?.filter(f => f.label !== slide.lead && f.label !== activity.prompt).map((f) => (
            <p key={f.id}>{f.label}</p>
          ))}
          <p>
            Submit from your own signed-in workspace. Ask for help when you need
            it.
          </p>
          {totals && (
            <div className="live-grid">
              {activity.choices?.map((c) => (
                <div key={c.id}>
                  {c.text}
                  <strong className="live-total">{totals[c.id] || 0}</strong>
                </div>
              ))}
            </div>
          )}
          {activity.model && <blockquote>{activity.model}</blockquote>}
          {activity.explanation && <p>{activity.explanation}</p>}
        </section>
      )}
      </PresentationFit>
      {showResponses && <aside className="live-response-panel" aria-label="Live response panel">
        <h2>{state.rehearsal ? "Test learner · your responses" : "Your responses"}</h2>
        {state.rehearsal && <p className="live-response-note">Rehearsal: submissions and presenter feedback are saved here. No real agents are added.</p>}
        <Session id={state.session.id} view="agent" responseOnly />
      </aside>}
      </div>
    </>
  );
}

function Presenter({
  state,
  refresh,
}: {
  state: LiveSessionState;
  refresh: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [team, setTeam] = useState(""),
    [filter, setFilter] = useState("all"),
    [activityId, setActivityId] = useState(""),
    [ending, setEnding] = useState(false),
    [seconds, setSeconds] = useState(120);
  const current =
    state.definition.slides.find(
      (s) => s.id === state.session.currentSlideId,
    ) || state.definition.slides[0];
  const activity = activityOf(
    state,
    activityId || state.session.currentActivityId,
  );
  async function command(c: Parameters<typeof sessionCommand>[1]) {
    setBusy(true);
    setError("");
    try {
      await sessionCommand(state.session.id, c);
      refresh();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const rows = state.participants
    .filter((p) => !team || p.teamId === team)
    .map((p) => {
      const progress = state.progress.find(
        (x) => x.agentId === p.agentId && x.activityId === activity?.id,
      );
      const attempts = state.attempts.filter(
          (a) => a.agentId === p.agentId && a.activityId === activity?.id,
        ),
        latest = attempts.at(-1);
      const missing = latest?.grade?.checks.filter((c) => !c.pass) || [];
      const submitted = latestAttemptComplete(attempts, progress?.dirty);
      return {
        p,
        progress,
        attempts,
        missing,
        submitted,
        priority: progress?.help ? 0 : missing.length ? 1 : !submitted ? 2 : 3,
      };
    })
    .filter(
      (r) =>
        filter === "all" ||
        (filter === "help" && !!r.progress?.help) ||
        (filter === "unfinished" && !r.submitted),
    )
    .sort(
      (a, b) => a.priority - b.priority || a.p.name.localeCompare(b.p.name),
    );
  const commonGaps = Object.entries(
    rows.reduce<Record<string, number>>((counts, r) => {
      for (const c of r.missing) counts[c.label] = (counts[c.label] || 0) + 1;
      return counts;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const firstResponses = rows.flatMap((r) => {
    const a = r.attempts.find((a) => !a.assisted);
    return a ? [a] : [];
  });
  if (!state.canPresent)
    return <p role="alert">This account is not an authorized presenter.</p>;
  return (
    <>
      <div className="live-actions">
        <a
          href={link(state.session.id, "shared")}
          className="live-button"
          target="_blank"
          rel="noreferrer"
        >
          Open shared presentation ↗
        </a>
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(
                `${location.origin}${location.pathname}${link(state.session.id)}`,
              )
              .catch(() =>
                setError(
                  "Copy the agent workspace address from the link below.",
                ),
              )
          }
        >
          Copy agent join link
        </button>
        <a href={link(state.session.id)}>Agent join link</a>
      </div>
      <p className="live-private">
        Private console. Share the separate presentation window in your meeting
        platform. You can advance slides from either window; both stay in sync.
      </p>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      <div className="live-presenter-grid">
        <section className="live-card">
          <h2>Run the room</h2>
          <LiveSlideNavigation state={state} refresh={refresh} />
          <label>
            Presentation slide
            <select
              value={current.id}
              disabled={busy || state.session.status === "ended"}
              onChange={(e) =>
                void command({ action: "slide", slideId: e.target.value })
              }
            >
              {state.definition.slides.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.title}
                  {s.activity ? " · activity" : ""}
                </option>
              ))}
            </select>
          </label>
          <p>{current.lead}</p>
          <p>{current.cue}</p>
          <details>
            <summary>Presenter notes</summary>
            <div dangerouslySetInnerHTML={{ __html: current.notes }} />
          </details>
          <div className="live-actions">
            {current.activity && (
              <>
                <button
                  disabled={busy || state.session.status === "ended"}
                  onClick={() =>
                    void command({
                      action: "open",
                      activityId: current.activity!.id,
                    })
                  }
                >
                  Open activity for agents
                </button>
                <button
                  disabled={
                    busy ||
                    !state.openedActivityIds.includes(current.activity.id) ||
                    (!current.activity.model &&
                      !current.activity.choices?.length &&
                      !current.activity.explanation)
                  }
                  onClick={() =>
                    void command({
                      action: "reveal",
                      activityId: current.activity!.id,
                    })
                  }
                >
                  Reveal teaching example / totals
                </button>
              </>
            )}
          </div>
          <label>
            Timer seconds
            <input
              type="number"
              min={0}
              max={3600}
              value={seconds}
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
          </label>
          <div className="live-actions">
            <button
              disabled={busy || state.session.status === "ended"}
              onClick={() => void command({ action: "timer", seconds })}
            >
              Start / reset timer
            </button>
            <button
              disabled={busy || state.session.status === "ended"}
              onClick={() =>
                void command({
                  action: "timer",
                  seconds: Math.min(
                    3600,
                    Math.max(
                      0,
                      Math.ceil(
                        (Date.parse(state.timerEndsAt || "") - Date.now()) /
                          1000,
                      ) || 0,
                    ) + 60,
                  ),
                })
              }
            >
              Add one minute
            </button>
            <button
              disabled={busy || state.session.status === "ended"}
              onClick={() => void command({ action: "timer", seconds: 0 })}
            >
              Stop timer
            </button>
          </div>
          <p>
            Advance the slide without clearing unfinished work. Previously
            opened activities stay available.
          </p>
        </section>
        <section className="live-card">
          <h2>Coach this activity</h2>
          <div className="live-grid">
            <label>
              Evidence for
              <select
                value={activityId || state.session.currentActivityId || ""}
                onChange={(e) => setActivityId(e.target.value)}
              >
                <option value="">Choose activity</option>
                {state.definition.slides
                  .filter((s) => s.activity)
                  .map((s) => (
                    <option key={s.activity!.id} value={s.activity!.id}>
                      {s.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Team
              <select value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All authorized teams</option>
                {[
                  ...new Map(
                    state.participants.map((p) => [p.teamId, p.teamName]),
                  ).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Show
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Everyone</option>
                <option value="help">Help requested</option>
                <option value="unfinished">Unfinished work</option>
              </select>
            </label>
          </div>
          <div className="live-metrics">
            <strong>
              {rows.filter((r) => r.attempts.length).length} / {rows.length}{" "}
              attempted
            </strong>
            <span>
              {rows.filter((r) => r.progress?.help).length} explicit help
              requests
            </span>
            <span>
              {rows.filter((r) => !r.p.joinedAt).length} have not joined
            </span>
          </div>
          {activity && (
            <>
              <h3>{activity.prompt}</h3>
              {activity.choices && (
                <div className="live-choice-list">
                  {activity.choices.map((c) => (
                    <p key={c.id}>
                      <b>
                        {
                          firstResponses.filter(
                            (a) => a.response.choiceId === c.id,
                          ).length
                        }{" "}
                        / {firstResponses.length}
                      </b>{" "}
                      · {c.text}
                    </p>
                  ))}
                  <small>
                    First independent answers.{" "}
                    {rows.length - firstResponses.length} learners without an
                    independent submission in this filtered roster.
                  </small>
                </div>
              )}
              {activity.model && (
                <details>
                  <summary>
                    {state.revealedActivityIds.includes(activity.id)
                      ? "Teaching example (revealed)"
                      : "Teaching example (private until revealed)"}
                  </summary>
                  <blockquote>{activity.model}</blockquote>
                  <p>{activity.explanation}</p>
                </details>
              )}
            </>
          )}
          {commonGaps.length > 0 && (
            <p className="live-notice">
              Most common correction: {commonGaps[0][0]} · {commonGaps[0][1]} /{" "}
              {rows.length} learners. Coach this action, then retry.
            </p>
          )}
          {!activity && (
            <p>Choose an activity to review its submitted evidence.</p>
          )}
          {rows.map(({ p, progress, attempts, missing, submitted }) => (
            <details className="live-person" key={p.agentId}>
              <summary>
                <b>{p.name}</b>
                <span>
                  {progress?.help === "finding-control"
                    ? "Needs help finding a control"
                    : progress?.help === "practice"
                      ? "Practice help requested"
                      : missing.length
                        ? `Correction needed: ${missing.map((c) => c.label).join(", ")}`
                        : progress?.dirty
                          ? "Current work changed — needs another check"
                          : submitted
                            ? "Submitted"
                            : progress
                              ? "Working"
                              : "Not started"}
                </span>
                <small>
                  {p.teamName} ·{" "}
                  {!p.joinedAt
                    ? "Not joined"
                    : Date.now() - Date.parse(p.lastSeenAt || "") > 30000
                      ? "Connection interrupted"
                      : "Joined"}
                </small>
              </summary>
              {activity?.kind === 'record' && <p>
                {progress?.actions.join(" · ") ||
                  "No reported simulator actions yet."}
              </p>}
              {attempts.map((a) => (
                <Attempt key={a.id} attempt={a} activity={activity} />
              ))}
              {!attempts.length && (
                <p>No submitted wording or record yet. Drafts are private.</p>
              )}
            </details>
          ))}
        </section>
      </div>
      <PartnerSetup state={state} activity={activity} run={command} />
      <SessionSummary state={state} />
      <section className="live-card">
        <h2>Finish and follow through</h2>
        <p>
          {state.rehearsal ? 'Ending saves this rehearsal and its test evidence. No agent coaching assignments are created.' : <>Ending saves the session and creates the 24-hour, three-day, and
          seven-day coaching checks once. Practice evidence does not change
          certifications or activation.</>}
        </p>
        {state.session.status === "ended" ? (
          <p>
            Session ended. {state.followups.length} follow-ups visible to you.
          </p>
        ) : ending ? (
          <div className="live-actions">
            <button
              disabled={busy}
              onClick={() => void command({ action: "end" })}
            >
              {state.rehearsal ? 'End rehearsal' : 'End session and create follow-ups'}
            </button>
            <button onClick={() => setEnding(false)}>Keep session open</button>
          </div>
        ) : (
          <button onClick={() => setEnding(true)}>Review session finish</button>
        )}
      </section>
    </>
  );
}

function CoachEvidence({ state }: { state: LiveSessionState }) {
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedActivity, setSelectedActivity] = useState("");
  const participant =
    state.participants.find((p) => p.agentId === selectedAgent) ||
    state.participants[0];
  if (!state.canReview)
    return <p>Coach access is required to review this session.</p>;
  return (
    <>
      <p className="live-private">
        Private coaching evidence · Only agents you are authorized to review
        appear here. Keep this view out of screen sharing.
      </p>
      {state.canPresent && (
        <p>
          <a href={link(state.session.id, "presenter")}>
            Open presenter controls →
          </a>
        </p>
      )}
      <section className="live-card">
        <h2>Compare the attempt with the correction</h2>
        <p>
          Review the original submission and later practice together. Record
          your follow-up below; session controls stay in the presenter console.
        </p>
        <div className="live-grid">
          <label>
            Agent to review
            <select
              value={participant?.agentId || ""}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              {!state.participants.length && (
                <option value="">No authorized agents</option>
              )}
              {state.participants.map((p) => (
                <option key={p.agentId} value={p.agentId}>
                  {p.name} · {p.teamName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evidence activity
            <select
              value={selectedActivity}
              onChange={(e) => setSelectedActivity(e.target.value)}
            >
              <option value="">All opened activities</option>
              {state.definition.slides
                .filter(
                  (s) =>
                    s.activity &&
                    state.openedActivityIds.includes(s.activity.id),
                )
                .map((s) => (
                  <option key={s.activity!.id} value={s.activity!.id}>
                    {s.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {participant && (
          <p>
            Follow-up coach: {participant.coachName || "Named coach"} ·{" "}
            {state.session.timezone}
          </p>
        )}
        {participant &&
          state.definition.slides
            .filter(
              (s) =>
                s.activity &&
                state.openedActivityIds.includes(s.activity.id) &&
                (!selectedActivity || s.activity.id === selectedActivity),
            )
            .map((slide) => {
              const activity = slide.activity!;
              const attempts = state.attempts.filter(
                (a) =>
                  a.agentId === participant.agentId &&
                  a.activityId === activity.id,
              );
              const observations = state.observations.filter(
                (o) =>
                  o.agentId === participant.agentId &&
                  o.activityId === activity.id,
              );
              const rounds = state.groups.filter(
                (g) =>
                  g.agentId === participant.agentId &&
                  g.activityId === activity.id,
              );
              const progress = state.progress.find(
                (p) =>
                  p.agentId === participant.agentId &&
                  p.activityId === activity.id,
              );
              return (
                <details
                  className="live-person"
                  key={`${participant.agentId}:${activity.id}`}
                >
                  <summary>
                    {slide.title} · {attempts.length} submitted{" "}
                    {attempts.length === 1 ? "attempt" : "attempts"} ·{" "}
                    {observations.length} observations
                  </summary>
                  <p>{activity.prompt}</p>
                  {progress?.help && (
                    <p className="live-notice">
                      Requested help:{" "}
                      {progress.help === "finding-control"
                        ? "finding a control"
                        : "practice"}
                      .
                    </p>
                  )}
                  {progress?.dirty && (
                    <p>
                      The current work has changed since its last submission.
                    </p>
                  )}
                  {attempts.map((a) => (
                    <Attempt key={a.id} attempt={a} activity={activity} />
                  ))}
                  {!attempts.length && (
                    <p>No submitted response. Drafts are private.</p>
                  )}
                  {observations.map((o) => (
                    <article key={o.id} className="live-attempt">
                      <h3>
                        Round {o.round} ·{" "}
                        {o.coachReviewed
                          ? "Coach reviewed"
                          : "Partner observed"}
                      </h3>
                      <p>
                        Submitted {new Date(o.submittedAt).toLocaleString()} ·{" "}
                        {o.speakingObserved
                          ? "Speaking turn observed"
                          : "Speaking observation outstanding"}{" "}
                        ·{" "}
                        {o.retryObserved
                          ? "Retry observed"
                          : "Retry observation outstanding"}
                      </p>
                      <ul>
                        {activity.rubric?.map((c) => (
                          <li key={c.id}>
                            {c.label}:{" "}
                            {o.criteria[c.id] === true
                              ? "observed"
                              : "not yet observed"}
                          </li>
                        ))}
                      </ul>
                      <p>
                        <strong>Correction:</strong>{" "}
                        {o.correction || "None recorded"}
                      </p>
                      <p>
                        <strong>Retry:</strong> {o.retry || "None recorded"}
                      </p>
                    </article>
                  ))}
                  {rounds
                    .filter(
                      (g) => !observations.some((o) => o.groupId === g.id),
                    )
                    .map((g) => (
                      <p key={g.id}>
                        Round {g.round}: observation outstanding.
                      </p>
                    ))}
                </details>
              );
            })}
      </section>
      {participant && (
        <CoachingAssignments
          key={participant.agentId}
          agentId={participant.agentId}
          leader
        />
      )}
      <p>Session totals below cover only the agents visible to you.</p>
      <SessionSummary state={state} />
    </>
  );
}

function Attempt({
  attempt: a,
  activity,
}: {
  attempt: LiveAttempt;
  activity?: WorkshopActivity;
}) {
  const audit =
    (a.response.submission as { phase?: string } | undefined)?.phase ===
    "audit";
  function value(v: unknown): ReactNode {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object")
      return (
        <dl>
          {Object.entries(v).map(([k, item]) => (
            <div key={k}>
              <dt>
                {activity?.fields?.find((f) => f.id === k)?.label ||
                  (
                    {
                      choiceId: "Selected response",
                      submission: "Submitted record",
                      stageSaved: "Stage saved",
                      dueDate: "Due date",
                      closeDate: "Close date",
                    } as Record<string, string>
                  )[k] ||
                  k}
              </dt>
              <dd>
                {k === "choiceId"
                  ? activity?.choices?.find((c) => c.id === item)?.text ||
                    value(item)
                  : value(item)}
              </dd>
            </div>
          ))}
        </dl>
      );
    return String(v);
  }
  return (
    <article className="live-attempt">
      <h3>
        Attempt {a.attempt} ·{" "}
        {a.assisted ? "Assisted after reveal" : "Independent"}{" "}
        <small>{new Date(a.submittedAt).toLocaleTimeString()}</small>
      </h3>
      {a.grade && (
        <p>
          {a.grade.passed
            ? audit
              ? "Diagnosis check passed; repair still required"
              : "Record check passed"
            : "Correction needed"}{" "}
          · {a.grade.score}/{a.grade.max}{" "}
          {audit ? "diagnosis checks" : "required actions"}
        </p>
      )}
      {a.grade?.checks
        .filter((c) => !c.pass)
        .map((c) => (
          <p key={c.id}>
            {c.label}: {c.message}
          </p>
        ))}
      <div className="live-answer">{value(a.response)}</div>
    </article>
  );
}

function PartnerSetup({
  state,
  activity,
  run,
  simple = false,
}: {
  state: LiveSessionState;
  activity?: WorkshopActivity;
  run: (c: Parameters<typeof sessionCommand>[1]) => Promise<boolean>;
  simple?: boolean;
}) {
  const [agent, setAgent] = useState(""),
    [buyer, setBuyer] = useState(""),
    [observer, setObserver] = useState(""),
    [round, setRound] = useState(1);
  const [grouping, setGrouping] = useState(false);
  async function rotate(size: number) {
    if (!activity) return;
    setGrouping(true);
    try {
      const people = state.participants.filter((p) => p.joinedAt);
      for (let i = 0; i < people.length; i += size) {
        const members = people.slice(i, i + size);
        for (let turn = 0; turn < members.length; turn++) {
          if (state.groups.some(g => g.activityId === activity.id && g.agentId === members[turn].agentId && g.round === turn + 1)) continue;
          const saved = await run({
            action: "group",
            group: {
              id: crypto.randomUUID(),
              activityId: activity.id,
              round: turn + 1,
              agentId: members[turn].agentId,
              buyerId:
                members.length > 1
                  ? members[(turn + 1) % members.length].agentId
                  : null,
              observerId:
                members.length > 2
                  ? members[(turn + 2) % members.length].agentId
                  : members.length > 1
                    ? members[(turn + 1) % members.length].agentId
                    : null,
              coachId: members.length === 1 ? state.viewerId : undefined,
            },
          });
          if (!saved) return;
        }
      }
    } finally {
      setGrouping(false);
    }
  }
  if (!activity?.rubric?.length) return null;
  const allAssigned = state.participants.filter(p => p.joinedAt).length > 0 && state.participants.filter(p => p.joinedAt).every(p => state.groups.some(g => g.activityId === activity.id && g.agentId === p.agentId));
  if (simple) return <section className="live-card">
    <h3>Breakout practice</h3>
    <p>Use your meeting platform for video rooms. Each person’s speaking turn and rotating roles appear automatically after setup.</p>
    <button disabled={grouping || allAssigned || !state.participants.some(p => p.joinedAt)} onClick={() => void rotate(activity.useCases ? 3 : 2)}>{allAssigned ? "Roles assigned" : grouping ? "Assigning…" : "Assign speaking turns"}</button>
    {state.groups.filter(g => g.activityId === activity.id).map(g => <p key={g.id}>Round {g.round}: {nameOf(state,g.agentId)} speaks · {g.buyerId ? nameOf(state,g.buyerId) + " is the buyer" : "presenter plays the buyer"}</p>)}
    <ObservationForms state={state} activityId={activity.id} presenter onSaved={() => {}} />
  </section>;
  const choose = (title: string, value: string, set: (v: string) => void) => (
    <label>
      {title}
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Not assigned</option>
        {state.participants.map((p) => (
          <option key={p.agentId} value={p.agentId}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="live-card">
      <h2>Partner practice · {activity.prompt}</h2>
      <p>
        Assign a speaking learner for each round, then place the group in your
        meeting platform’s breakout room. In pairs, assign the buyer as observer
        too. For a solo learner, submit a coach observation or leave it
        outstanding.
      </p>
      <div className="live-actions">
        <button
          disabled={
            grouping ||
            state.groups.some((g) => g.activityId === activity.id) ||
            !state.participants.some((p) => p.joinedAt)
          }
          onClick={() => void rotate(2)}
        >
          {state.rehearsal ? 'Set up solo speaking practice' : 'Create rotating pairs from joined agents'}
        </button>
        {!state.rehearsal && <button
          disabled={
            grouping ||
            state.groups.some((g) => g.activityId === activity.id) ||
            !state.participants.some((p) => p.joinedAt)
          }
          onClick={() => void rotate(3)}
        >
          Create rotating trios from joined agents
        </button>}
      </div>
      <p>
        Every joined learner receives a speaking round. Add late arrivals or
        replacement partners below.
      </p>
      <div className="live-grid">
        {choose("Speaking agent", agent, setAgent)}
        {choose("Buyer", buyer, setBuyer)}
        {choose("Observer", observer, setObserver)}
        <label>
          Round
          <input
            type="number"
            min={1}
            max={20}
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
          />
        </label>
      </div>
      <button
        disabled={!agent || agent === buyer || agent === observer}
        onClick={() =>
          void run({
            action: "group",
            group: {
              id: crypto.randomUUID(),
              activityId: activity.id,
              round,
              agentId: agent,
              buyerId: buyer || null,
              observerId: observer || buyer || null,
              coachId: !buyer && !observer ? state.viewerId : undefined,
            },
          })
        }
      >
        Assign speaking round
      </button>
      {state.groups
        .filter((g) => g.activityId === activity.id)
        .map((g) => (
          <p key={g.id}>
            Round {g.round}: {nameOf(state, g.agentId)} speaks · buyer{" "}
            {nameOf(state, g.buyerId)} · observer {nameOf(state, g.observerId)}{" "}
            ·{" "}
            {state.observations.some((o) => o.groupId === g.id)
              ? "Feedback received"
              : "Observation outstanding"}
          </p>
        ))}
      <div className="live-grid">
        {state.definition.slides
          .find((s) => s.activity?.id === activity.id)
          ?.body.includes('id="scenario"') &&
          state.definition.cases?.map((c) => (
            <article key={c.name}>
              <h3>{c.name}</h3>
              <blockquote>{c.quote}</blockquote>
              <p>{c.goal}</p>
            </article>
          ))}
      </div>
      <ObservationForms
        state={state}
        activityId={activity.id}
        presenter
        onSaved={() => {}}
      />
    </section>
  );
}

function SessionSummary({ state }: { state: LiveSessionState }) {
  const total = state.participants.length,
    attempted = new Set(
      state.attempts
        .filter((a) => recordAttemptComplete(a))
        .map((a) => a.agentId),
    ).size;
  return (
    <details className="live-card">
      <summary>Session evidence and follow-up</summary>
      <EvidenceTable state={state} />
      <p>
        {attempted} / {total} participants submitted a completed activity.{" "}
        {state.attempts.filter((a) => a.assisted).length} assisted attempts of{" "}
        {state.attempts.length} total attempts.
      </p>
      <p>
        {new Set(state.observations.map((o) => o.groupId)).size} /{" "}
        {state.groups.length} assigned speaking rounds have observations.
        Missing observations remain outstanding.
      </p>
      {state.participants.map((p) => {
        const first = state.attempts.find((a) => a.agentId === p.agentId);
        return (
          <p key={p.agentId}>
            {p.name}: first attempt{" "}
            {first
              ? `${Math.max(0, Math.round((Date.parse(first.submittedAt) - Date.parse(p.joinedAt || state.session.createdAt)) / 60000))} minutes after joining`
              : "not observed"}
          </p>
        );
      })}
      <p>
        {state.progress.reduce((n, p) => n + (p.helpResolvedCount || 0), 0)}{" "}
        explicit help requests resolved.{" "}
        {state.progress.filter((p) => p.help).length} remain open.
      </p>
      <p>
        {state.followups.filter((f) => f.outcome === "complete").length} /{" "}
        {state.followups.length} follow-ups completed. Coach-confirmed real-work
        application:{" "}
        {state.followups.filter((f) => f.applicationObserved === true).length};
        not yet observed:{" "}
        {state.followups.filter((f) => f.applicationObserved !== true).length}.
      </p>
      <p>
        Attendance and clicks do not establish skill. Compare an initial attempt
        with the later fresh case and the named coach’s review.
      </p>
    </details>
  );
}

function EvidenceTable({ state }: { state: LiveSessionState }) {
  const population = state.participants.length;
  const rows = state.definition.activities.map((activity) => {
    const attempts = state.attempts.filter((a) => a.activityId === activity.id);
    const people = [...new Set(attempts.map((a) => a.agentId))];
    const first: LiveAttempt[] = [],
      last: LiveAttempt[] = [];
    for (const person of people) {
      const checked = attempts.filter(
        (a) =>
          a.agentId === person &&
          a.grade &&
          (a.response.submission as { phase?: string } | undefined)?.phase !==
            "audit",
      );
      if (checked.length) {
        first.push(checked[0]);
        last.push(checked.at(-1)!);
      }
    }
    const actions = (values: LiveAttempt[]) =>
      values.length
        ? `${values.reduce((n, a) => n + (a.grade?.score || 0), 0)} / ${values.reduce((n, a) => n + (a.grade?.max || 0), 0)} actions (${values.length} checked learners)`
        : "No record checks";
    const observed = state.observations.filter(
      (o) => o.activityId === activity.id,
    );
    const speakers = new Set(
      observed.filter((o) => o.speakingObserved === true).map((o) => o.agentId),
    ).size;
    const retried = new Set(
      observed
        .filter((o) => "retryObserved" in o && o.retryObserved === true)
        .map((o) => o.agentId),
    ).size;
    return {
      id: activity.id,
      title: activity.title,
      attempts: `${people.length} / ${population}`,
      assistance: `${attempts.filter((a) => !a.assisted).length} independent; ${attempts.filter((a) => a.assisted).length} assisted`,
      actions:
        activity.kind === "record"
          ? `${actions(first)} → ${actions(last)}`
          : "Coach evaluates quality",
      practice:
        activity.kind === "roleplay"
          ? `${speakers} / ${population} speakers observed; ${retried} / ${population} retries observed`
          : "Not a speaking activity",
    };
  });
  function download() {
    const text = [
      "# " + state.session.title,
      "Version " + state.session.version + " · " + state.session.timezone,
      "Authorized roster: " + population,
      "",
      ...rows.map(
        (r) =>
          `## ${r.title}\nUnique participants attempted: ${r.attempts}\n${r.assistance}\nFirst → latest check: ${r.actions}\n${r.practice}\n`,
      ),
      ...state.participants.map((p) => {
        const a = state.attempts.find((a) => a.agentId === p.agentId);
        return (
          p.name +
          ": first attempt " +
          (a
            ? Math.max(
                0,
                Math.round(
                  (Date.parse(a.submittedAt) -
                    Date.parse(p.joinedAt || state.session.createdAt)) /
                    60000,
                ),
              ) + " minutes after joining"
            : "not yet observed")
        );
      }),
      "Explicit help requests resolved: " +
        state.progress.reduce((n, p) => n + (p.helpResolvedCount || 0), 0),
      "Follow-ups reviewed: " +
        state.followups.filter((f) => f.outcome === "complete").length +
        " / " +
        state.followups.length,
      "Coach-confirmed application: " +
        state.followups.filter((f) => f.applicationObserved === true).length,
      "Counts reflect this viewer’s authorized teams. Unobserved learners are not failures. Compare fresh-case follow-up with the original evidence before concluding effectiveness.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `TRU-session-${state.session.id}-summary.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <button onClick={download}>Download pilot summary</button>
      <div className="live-table-wrap">
        <table className="live-report">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Unique participants attempted</th>
              <th>Independent / assisted attempts</th>
              <th>First → latest required actions</th>
              <th>Observed practice</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th>{r.title}</th>
                <td>{r.attempts}</td>
                <td>{r.assistance}</td>
                <td>{r.actions}</td>
                <td>{r.practice}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Denominators use your authorized roster. Missing attempts and
        observations remain visible. Record action counts do not assess note
        quality; retries after a model are assisted.
      </p>
    </>
  );
}

function AgentWorkspace({
  state,
  refresh,
}: {
  state: LiveSessionState;
  refresh: () => void;
}) {
  const positionKey = `tru:rep-position:${state.viewerId}:${state.session.id}:${state.session.version}`;
  const [chosen, setChosen] = useState(() =>
      readDraft<string>(positionKey, state.session.currentSlideId),
    ),
    [error, setError] = useState("");
  const slide =
    state.definition.slides.find((s) => s.id === chosen) ||
    state.definition.slides[0];
  const activity = slide.activity,
    id = activity?.id;
  const latestState = useRef(state);
  latestState.current = state;
  useEffect(() => {
    setChosen((previous) => {
      const s = latestState.current,
        prior = s.definition.slides.find((x) => x.id === previous)?.activity;
      const unfinished =
        prior &&
        s.openedActivityIds.includes(prior.id) &&
        (!latestAttemptComplete(
          s.attempts.filter(
            (a) => a.agentId === s.myAgentId && a.activityId === prior.id,
          ),
        ) ||
          s.progress.some(
            (p) =>
              p.agentId === s.myAgentId && p.activityId === prior.id && p.dirty,
          ));
      return unfinished ? previous : s.session.currentSlideId;
    });
  }, [state.session.currentSlideId]);
  useEffect(() => {
    try {
      localStorage.setItem(positionKey, JSON.stringify(chosen));
    } catch {
      /* Activity draft shows a storage error separately. */
    }
  }, [chosen, positionKey]);
  const mine = state.participants.find((p) => p.agentId === state.myAgentId);
  async function help(value: "finding-control" | "practice" | null) {
    if (!id) return;
    try {
      await liveRequest(`/${state.session.id}/progress`, {
        activityId: id,
        status: "working",
        help: value,
      });
      refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  if (!state.myAgentId)
    return (
      <section className="live-card">
        <p>This account is not a learner in this session.</p>
        {state.canPresent && (
          <a href={link(state.session.id, "presenter")}>
            Open presenter console
          </a>
        )}
      </section>
    );
  return (
    <>
      <div className="live-actions">
        <label>
          Current activity / catch-up
          <select
            value={activity ? chosen : ""}
            onChange={(e) =>
              setChosen(e.target.value || state.session.currentSlideId)
            }
          >
            <option value="">Follow the presentation</option>
            {state.definition.slides
              .filter(
                (s) =>
                  s.activity && state.openedActivityIds.includes(s.activity.id),
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {latestAttemptComplete(
                    state.attempts.filter(
                      (a) =>
                        a.agentId === state.myAgentId &&
                        a.activityId === s.activity!.id,
                    ),
                    state.progress.find(
                      (p) =>
                        p.agentId === state.myAgentId &&
                        p.activityId === s.activity!.id,
                    )?.dirty,
                  )
                    ? " · submitted"
                    : " · unfinished"}
                </option>
              ))}
          </select>
        </label>
        <button onClick={() => setChosen(state.session.currentSlideId)}>
          Return to presenter
        </button>
      </div>
      {chosen !== state.session.currentSlideId && (
        <p role="status" className="live-notice">
          The presenter has moved on. Finish this work or return to the current
          activity.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!activity ? (
        <SlideBody slide={slide}>
          {slide.native === "deal" && (
            <div
              style={{ maxWidth: 720, minHeight: 400, position: "relative" }}
            >
              <DealMock />
            </div>
          )}
        </SlideBody>
      ) : !state.openedActivityIds.includes(activity.id) ? (
        <p>Waiting for the presenter to open this activity.</p>
      ) : (
        <>
          <div className="live-actions">
            <button onClick={() => void help("finding-control")}>
              I need help finding a control
            </button>
            <button onClick={() => void help("practice")}>
              I need practice help
            </button>
            <button onClick={() => void help(null)}>Help resolved</button>
          </div>
          <Activity
            key={activity.id}
            state={state}
            slide={slide}
            activity={activity}
            refresh={refresh}
            onContinue={() => setChosen(state.session.currentSlideId)}
          />
        </>
      )}
      <PracticeGroups state={state} activityId={activity?.id} />
      <ObservationForms
        state={state}
        activityId={activity?.id}
        onSaved={refresh}
      />
      {!state.rehearsal && <section className="live-card">
        <h2>Your follow-up</h2>
        <p>
          {mine?.coachId
            ? `Your follow-up coach: ${mine.coachName || "assigned coach"}.`
            : "A coach has not yet been assigned."}{" "}
          Due dates use {state.session.timezone}. Find submitted practice and
          review feedback in your coaching assignments.
        </p>
        {state.followups.map((f) => (
          <p key={f.id}>
            {f.checkpoint === 1
              ? "Recall and retry"
              : f.checkpoint === 3
                ? "Fresh case"
                : "Application review"}{" "}
            · due {f.dueDate} · {assignmentStatus(f)}
          </p>
        ))}
        <a href="#/learn">Open my coaching assignments →</a>
      </section>}
    </>
  );
}

/** A second tab can follow along without competing to overwrite an active editor. */
function useEditorLock(key: string) {
  const [editable, setEditable] = useState(false),
    [supported, setSupported] = useState(true);
  useEffect(() => {
    let closed = false;
    let release: () => void = () => {};
    if (!navigator.locks) {
      setSupported(false);
      setEditable(true);
      return;
    }
    void navigator.locks.request(key, { mode: "exclusive" }, async () => {
      if (closed) return;
      setEditable(true);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return () => {
      closed = true;
      release();
    };
  }, [key]);
  return { editable, supported };
}

export function ResponseWorkspace({ state, refresh }: { state: LiveSessionState; refresh: () => void }) {
  const slide = state.definition.slides.find(s => s.id === state.session.currentSlideId) || state.definition.slides[0];
  const activity = slide.activity;
  if (!state.myAgentId) return <p>This account is presenting. Agents can open their response panel from this same presentation link. Use a solo test session to rehearse submitting without agents.</p>;
  if (!activity) return <p>Following the presenter.</p>;
  if (!state.openedActivityIds.includes(activity.id)) return <p>Waiting for the presenter to open responses.</p>;
  return <>
    <Activity key={activity.id} state={state} slide={slide} activity={activity} refresh={refresh} onContinue={refresh} compact />
    <PracticeGroups state={state} activityId={activity.id} />
    <ObservationForms state={state} activityId={activity.id} onSaved={refresh} />
  </>;
}

export function Activity({
  state,
  slide,
  activity,
  refresh,
  onContinue,
  compact = false,
}: {
  state: LiveSessionState;
  slide: Slide;
  activity: WorkshopActivity;
  refresh: () => void;
  onContinue: () => void;
  compact?: boolean;
}) {
  const key = liveDraftKey(
      state.viewerId,
      state.session.id,
      state.session.version,
      activity.id,
    ),
    { editable, supported } = useEditorLock(key);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
      readDraft(key, {}),
    ),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [pending, setPending] = useState(() => !!readDraft(`${key}:pending`, null));
  const progressRef = useRef({ actions: [] as string[], dirty: false }),
    lastProgress = useRef(""),
    submittedRef = useRef(false);
  const attempts = state.attempts.filter(
    (a) => a.activityId === activity.id && a.agentId === state.myAgentId,
  );
  submittedRef.current = latestAttemptComplete(attempts);
  const lastRecord = attempts
    .filter(
      (a) =>
        a.grade &&
        (a.response.submission as { phase?: string } | undefined)?.phase !==
          "audit",
    )
    .at(-1);
  const sendProgress = useCallback(
    (
      actions: string[] = progressRef.current.actions,
      dirty = progressRef.current.dirty,
    ) => {
      progressRef.current = { actions, dirty };
      const body = {
          activityId: activity.id,
          status: submittedRef.current && !dirty ? "submitted" : "working",
          actions,
          dirty,
        },
        fingerprint = JSON.stringify(body);
      if (lastProgress.current === fingerprint) return;
      lastProgress.current = fingerprint;
      void liveRequest(`/${state.session.id}/progress`, body).catch(() => {
        lastProgress.current = "";
      });
    },
    [activity.id, state.session.id],
  );
  useEffect(() => {
    if (editable) sendProgress();
  }, [editable, sendProgress]);
  useEffect(() => {
    if (editable) setDraft(readDraft(key, {}));
  }, [editable, key]);
  function change(field: string, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setStatus("Draft · visible only to you");
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError(
        "Draft could not be saved in this browser. Submit before closing.",
      );
    }
    sendProgress(undefined, attempts.length > 0);
  }
  async function submit(response: Record<string, unknown>) {
    setSending(true);
    setStatus("Sending…");
    setError("");
    try {
      const attempt = await submitAttempt(
        state.session.id,
        key,
        activity.id,
        response,
      );
      setPending(false);
      setStatus("Submitted");
      refresh();
      return attempt;
    } catch (e) {
      setPending(true);
      setStatus("Not sent — retry");
      setError(message(e));
      throw e;
    } finally {
      setSending(false);
    }
  }
  const fields = activity.fields?.length
    ? activity.fields
    : activity.kind === "choice"
      ? []
      : [{ id: "response", label: activity.prompt }];
  const complete =
    fields.every((f) => draft[f.id]?.trim()) &&
    (!activity.choices?.length || !!draft.choiceId);
  return (
    <section className="live-activity">
      {(!compact || !editable) && <p role="status">
        {!editable
          ? "This activity is open for editing in another tab. Close it there to continue here."
          : !supported
            ? "Use one tab while editing; this browser cannot coordinate edit ownership."
            : state.revealedActivityIds.includes(activity.id)
              ? "The example has been revealed. New attempts will be marked assisted."
              : "Your first independent attempt is preserved."}
      </p>}
      {editable && (!compact || slide.native) && (
        <SlideBody slide={slide}>
          {slide.native === "practice" && (
            <div className="native-lab">
              <PracticeRecord
                scenario={slide.scenario as PracticeScenario}
                live={{
                  draftKey: key,
                  lastGrade: lastRecord?.grade,
                  lastSubmission: lastRecord?.response.submission as
                    | Parameters<
                        typeof import("../lib/api").gradeRecordPractice
                      >[1]
                    | undefined,
                  diagnosed: attempts.some(
                    (a) =>
                      a.grade?.passed &&
                      (a.response.submission as { phase?: string } | undefined)
                        ?.phase === "audit",
                  ),
                  submit: async (submission) => {
                    const a = await submit({ submission });
                    if (!a.grade)
                      throw new Error(
                        "No server grade was returned. Retry the check.",
                      );
                    return a.grade;
                  },
                  progress: sendProgress,
                }}
              />
            </div>
          )}
          {slide.native === "deal" && <DealMock />}
        </SlideBody>
      )}
      {activity.kind !== "record" && editable && (
        <div className="live-card">
          <h3>{activity.prompt === slide.lead ? 'Your response' : activity.prompt}</h3>
          <p>
            {compact ? "Submit your answer to the presenter." : activity.kind === "choice" && !fields.length ? "Choose an answer and submit it. You can continue with the presenter without getting the answer right." : <>Write what you think, including “I’m not sure.” Short answers are not
            graded and there are no required keywords. Submit to share your response
            with your presenter, or continue with the presentation and return later.</>}
          </p>
          <fieldset disabled={sending || pending}>
            <legend className="live-sr">Your response</legend>
            {activity.choices?.length && (
              <div className="live-choice-list">
                {(compact ? activity.choices : orderedChoices(activity.choices, key)).map((c) => (
                  <label key={c.id}>
                    <input
                      type="radio"
                      name={activity.id}
                      checked={draft.choiceId === c.id}
                      onChange={() => change("choiceId", c.id)}
                    />
                    {c.text}
                  </label>
                ))}
              </div>
            )}
            {fields.map((f) => (
              <label key={f.id}>
                {f.label}
                <textarea
                  rows={3}
                  value={draft[f.id] || ""}
                  onChange={(e) => change(f.id, e.target.value)}
                />
              </label>
            ))}
          </fieldset>
          <button
            disabled={sending || (!pending && !complete)}
            onClick={() => void submit(draft).catch(() => {})}
          >
            {sending
              ? "Sending…"
              : pending
                ? "Retry previous submission"
                : attempts.length
                  ? "Submit a new attempt"
                  : "Submit response"}
          </button>
          {!compact && <><button onClick={onContinue}>Continue with presenter</button>
          <p>{activity.kind === "choice" && !fields.length ? "Continuing does not submit your choice. You can return to it later." : "Continuing does not submit your writing. Your draft stays here for you to finish later."}</p></>}
          {activity.kind === "roleplay" && (
            <p>
              This reflection does not replace your partner’s observation.
              Complete your speaking turn and targeted retry in the breakout
              room.
            </p>
          )}
        </div>
      )}
      <p role="status" className="live-submit-status">
        {status}
      </p>
      {error && (
        <p role="alert" className="live-error">
          {error}
        </p>
      )}
      {(activity.model || activity.explanation) && (
        <section className="live-card">
          <h3>Revealed example</h3>
          <blockquote>{activity.model}</blockquote>
          <p>{activity.explanation}</p>
        </section>
      )}
      {state.observations.filter(o => o.agentId === state.myAgentId && o.activityId === activity.id).map(o => (
        <section className="live-card" key={o.id}>
          <h3>{o.coachReviewed ? 'Presenter feedback' : 'Partner feedback'} · round {o.round}</h3>
          <p>{o.correction}</p><p>Retry: {o.retry}</p>
          <small>{o.retryObserved ? 'Retry observed' : 'Retry not yet observed'}{state.rehearsal ? ' · test evidence only' : ''}</small>
        </section>
      ))}
      {attempts.length > 0 && (
        <details className="live-card">
          <summary>Your submitted attempts ({attempts.length})</summary>
          {attempts.map((a) => (
            <Attempt key={a.id} attempt={a} activity={activity} />
          ))}
        </details>
      )}
    </section>
  );
}

export function PracticeGroups({
  state,
  activityId,
}: {
  state: LiveSessionState;
  activityId?: string;
}) {
  return (
    <>
      {state.groups
        .filter(
          (g) =>
            g.activityId === activityId &&
            [g.agentId, g.buyerId, g.observerId].includes(state.myAgentId),
        )
        .map((g) => {
          const useCases = state.definition.activities.find(a => a.id === g.activityId)?.useCases || state.definition.slides
            .find((s) => s.activity?.id === g.activityId)
            ?.body.includes('id="scenario"');
          const card = useCases
            ? state.definition.cases?.[
                (g.round - 1) % (state.definition.cases?.length || 1)
              ]
            : null;
          return (
            <section className="live-card" key={g.id}>
              <h2>Your speaking group · round {g.round}</h2>
              <p>
                Agent: {nameOf(state, g.agentId)} · Buyer:{" "}
                {nameOf(state, g.buyerId)} · Observer:{" "}
                {nameOf(state, g.observerId || g.buyerId)}
              </p>
              {card && (
                <>
                  <h3>{card.name}</h3>
                  <blockquote>{card.quote}</blockquote>
                  {(state.rehearsal || g.agentId !== state.myAgentId) && <p>{card.goal}</p>}
                </>
              )}
              <p>
                Use the assigned breakout room. Each agent speaks, receives one
                correction, then retries.
              </p>
            </section>
          );
        })}
    </>
  );
}

function ObservationForms({
  state,
  activityId,
  presenter = false,
  onSaved,
}: {
  state: LiveSessionState;
  activityId?: string;
  presenter?: boolean;
  onSaved: () => void;
}) {
  const groups = state.groups.filter(
    (g) =>
      g.activityId === activityId &&
      (presenter ||
        g.observerId === state.myAgentId ||
        (!g.observerId && g.buyerId === state.myAgentId)),
  );
  return (
    <>
      {groups.map((g) => (
        <Observation
          key={g.id}
          group={g}
          state={state}
          presenter={presenter}
          onSaved={onSaved}
        />
      ))}
    </>
  );
}
function Observation({
  group: g,
  state,
  presenter,
  onSaved,
}: {
  group: LiveGroup;
  state: LiveSessionState;
  presenter: boolean;
  onSaved: () => void;
}) {
  const key = liveDraftKey(
    state.viewerId,
    state.session.id,
    state.session.version,
    `observation:${g.id}`,
  );
  const [draft] = useState(() =>
    readDraft<{
      criteria: Record<string, boolean>;
      correction: string;
      retry: string;
      speakingObserved?: boolean;
      retryObserved?: boolean;
    }>(key, { criteria: {}, correction: "", retry: "" }),
  );
  const [criteria, setCriteria] = useState<Record<string, boolean>>(
      draft.criteria,
    ),
    [correction, setCorrection] = useState(draft.correction),
    [retry, setRetry] = useState(draft.retry),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const { editable } = useEditorLock(key),
    [ready, setReady] = useState(false),
    [speakingObserved, setSpeakingObserved] = useState(
      draft.speakingObserved === true,
    ),
    [retryObserved, setRetryObserved] = useState(draft.retryObserved === true);
  useEffect(() => {
    if (editable) {
      const latest = readDraft(key, draft);
      setCriteria(latest.criteria);
      setCorrection(latest.correction);
      setRetry(latest.retry);
      setSpeakingObserved(latest.speakingObserved === true);
      setRetryObserved(latest.retryObserved === true);
      setReady(true);
    }
  }, [editable, key, draft]);
  useEffect(() => {
    if (editable && ready)
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            criteria,
            correction,
            retry,
            speakingObserved,
            retryObserved,
          }),
        );
      } catch {
        setError(
          "This feedback draft cannot be saved in the browser. Submit before closing.",
        );
      }
  }, [
    key,
    editable,
    ready,
    criteria,
    correction,
    retry,
    speakingObserved,
    retryObserved,
  ]);
  const attemptId = useRef(crypto.randomUUID()),
    activity = activityOf(state, g.activityId),
    existing = state.observations
      .filter((o) => o.groupId === g.id)
      .sort(
        (a, b) =>
          Number(a.coachReviewed) - Number(b.coachReviewed) ||
          a.submittedAt.localeCompare(b.submittedAt),
      )
      .at(-1);
  async function save() {
    setBusy(true);
    try {
      await liveRequest(`/${state.session.id}/observations`, {
        id: attemptId.current,
        groupId: g.id,
        criteria,
        correction,
        retry,
        speakingObserved,
        retryObserved,
        coachReviewed: presenter,
      });
      setDone(true);
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="live-card">
      <summary>
        {presenter ? "Coach review" : "Partner feedback"} ·{" "}
        {nameOf(state, g.agentId)} · round {g.round} ·{" "}
        {existing?.coachReviewed
          ? "coach reviewed"
          : existing
            ? "partner observed"
            : "outstanding"}
      </summary>
      {existing && (
        <>
          <p>Observed correction: {existing.correction}</p>
          <p>
            Retry: {existing.retry} ·{" "}
            {existing.retryObserved ? "observed" : "not yet observed"}
          </p>
        </>
      )}
      {done ? (
        <p role="status">Observation submitted.</p>
      ) : (
        <>
          {!editable && (
            <p>
              Feedback is open in another tab. Close it there to continue here.
            </p>
          )}
          <fieldset disabled={busy || !editable}>
            <legend>Behaviors actually observed</legend>
            <label className="live-inline">
              <input
                type="checkbox"
                checked={speakingObserved}
                onChange={(e) => setSpeakingObserved(e.target.checked)}
              />
              I observed this learner speak
            </label>
            <label className="live-inline">
              <input
                type="checkbox"
                checked={retryObserved}
                onChange={(e) => setRetryObserved(e.target.checked)}
              />
              I observed the targeted retry
            </label>
            {activity?.rubric?.map((c) => (
              <label className="live-inline" key={c.id}>
                <input
                  type="checkbox"
                  checked={criteria[c.id] === true}
                  onChange={(e) =>
                    setCriteria((v) => ({ ...v, [c.id]: e.target.checked }))
                  }
                />
                {c.label}
              </label>
            ))}
          </fieldset>
          <label>
            One correction
            <textarea
              disabled={!editable}
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </label>
          <label>
            What changed on the retry? (If no retry happened, say so.)
            <textarea
              disabled={!editable}
              value={retry}
              onChange={(e) => setRetry(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !editable ||
              !speakingObserved ||
              !correction.trim() ||
              !retry.trim()
            }
            onClick={() => void save()}
          >
            {busy
              ? "Sending…"
              : presenter
                ? "Submit coach review"
                : "Submit partner observation"}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
