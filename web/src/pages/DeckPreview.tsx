import { useEffect, useState } from 'react';
import { deckHash } from '../lib/deckRoute';
import { loadDeck, SlideView } from './SlideDeck';
import '../truHqDark.css';

/** Public, no-auth look at one native slide. Used by `?demo=1#/deck/<name>/<n>`. */
export default function DeckPreview({ deck, n }: { deck: string; n: number }) {
  const [total, setTotal] = useState(0);
  const [label, setLabel] = useState('');

  useEffect(() => {
    let alive = true;
    loadDeck(deck)
      .then((d) => {
        if (!alive) return;
        setTotal(d.slides.length);
        setLabel(d.slides.find((s) => s.n === n)?.label ?? '');
      })
      .catch(() => {
        if (alive) { setTotal(0); setLabel(''); }
      });
    return () => { alive = false; };
  }, [deck, n]);

  const go = (next: number) => { window.location.hash = deckHash(deck, next); };

  return (
    <div className="ac ac-shell tru-dark ac-shell-wide" style={{ ['--mac' as string]: '#e0a340' }}>
      <div className="ac-stage" style={{ padding: '28px 32px 40px' }}>
        <div className="ac-stage-inner">
          <div className="ac-lessonhead">
            <span className="ac-chip">{deck}</span>
            <span className="ac-count">{n}{total ? ` / ${total}` : ''}</span>
          </div>
          {label && <h2 className="ac-lessontitle" style={{ margin: '8px 0 18px' }}>{label}</h2>}
          <div className="ac-cardzone">
            <SlideView deck={deck} n={n} />
          </div>
          <div className="ac-nav">
            <button
              type="button"
              className="btn ghost"
              disabled={n <= 1}
              style={n <= 1 ? { visibility: 'hidden' } : undefined}
              onClick={() => go(n - 1)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn ac-btn"
              disabled={!total || n >= total}
              onClick={() => go(n + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
