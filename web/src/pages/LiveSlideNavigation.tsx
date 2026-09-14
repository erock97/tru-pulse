import { useEffect, useRef, useState } from "react";
import type { LiveSessionState } from "../../../shared/liveWorkshops";
import { sessionCommand } from "../lib/liveSessions";

/** Navigation changes the room's slide, never a private copy of the deck. */
export function LiveSlideNavigation({ state, refresh, keyboard = false }: {
  state: LiveSessionState;
  refresh: () => void;
  keyboard?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const slides = state.definition.slides;
  const found = slides.findIndex(s => s.id === state.session.currentSlideId);
  const index = Math.max(0, found);
  const allowed = state.canPresent && state.session.status !== "ended";
  async function move(next: number) {
    if (!allowed || pending.current || next < 0 || next >= slides.length || next === index) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await sessionCommand(state.session.id, { action: "slide", slideId: slides[next].id });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change slides. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!keyboard || !allowed) return;
    const keydown = (event: KeyboardEvent) => {
      // Respect editing, native practice controls, and enlarged-image dialogs,
      // including controls inside the slide's shadow root.
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.composedPath().some(target => target instanceof HTMLElement &&
        (target.matches('input, textarea, select, button, a, [role="button"], dialog') || target.isContentEditable))) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      void move(index + (event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  return <nav className="live-slide-navigation" aria-label="Slide navigation">
    {state.canPresent && <button disabled={!allowed || busy || index === 0} onClick={() => void move(index - 1)}>← Previous slide</button>}
    <span aria-live="polite">Slide {index + 1} of {slides.length}</span>
    {state.canPresent && <button disabled={!allowed || busy || index === slides.length - 1} onClick={() => void move(index + 1)}>Next slide →</button>}
    {!state.canPresent && <span>Following the presenter</span>}
    {error && <p role="alert">{error}</p>}
  </nav>;
}
