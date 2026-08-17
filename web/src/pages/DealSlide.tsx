// "The deal Follow Up Boss never asks you for" — a Day 1 slide the deck does not
// have, authored in the deck's own visual language.
//
// This replaced a plain text card. In a module made of Eric's slides, a bare block
// of prose reads as a leftover from an older version of the training, which is
// exactly how he spotted it. So it is a slide: same canvas, same gradient, same
// Playfair title over a brass rule, same footer and slide number as slides 1-18.
//
// It is React rather than exported markup for one reason — you have to be able to
// click it. Deals are the one part of Day 1 with no screenshot behind them, and
// telling somebody about a dialog they have never seen does not work. So the right
// half is a working mock of the Deals panel: press +, fill the dialog, watch the
// deal land on the record. Nothing here is graded; the exercise that follows is.
//
// Everything is sized in the deck's 1920-wide design pixels. SlideCanvas scales the
// whole thing, so a value here means the same thing it means on any other slide.
import { useState } from 'react';
import { SlideCanvas } from './SlideDeck';

const BRASS = 'var(--brass)';
const BRASS_LT = 'var(--brass-lt)';
const DIM = 'var(--dim)';
const TEXT = 'var(--text)';

/** One of the three things a deal will not go in without. */
function Part({ n, label, body }: { n: number; label: string; body: string }) {
  return (
    <div
      data-a={String(n)}
      style={{ borderLeft: `3px solid ${BRASS}`, paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ font: `600 var(--t-eyebrow)/1 'Hanken Grotesk'`, letterSpacing: '.18em', textTransform: 'uppercase', color: BRASS_LT }}>
        {label}
      </div>
      <p style={{ margin: 0, font: `400 var(--t-body)/1.4 'Hanken Grotesk'`, color: DIM }}>{body}</p>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  border: '1px solid #d7dee5', borderRadius: 5, padding: '11px 13px',
  fontSize: 20, color: '#2f3d4a', background: '#fff', width: '100%',
  boxSizing: 'border-box', fontFamily: 'inherit',
};

/** The Deals panel and its dialog, at the scale Follow Up Boss actually draws them. */
function DealMock() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [close, setClose] = useState('');
  const [deal, setDeal] = useState<{ name: string; price: string; close: string } | null>(null);

  const save = () => {
    if (!name.trim()) return;
    setDeal({ name: name.trim(), price: price.trim(), close: close.trim() });
    setOpen(false);
  };
  const reset = () => {
    setDeal(null); setName(''); setPrice(''); setClose(''); setOpen(false);
  };

  return (
    <div className="deck-mock">
      <div style={{
        background: '#fff', borderRadius: 10, border: '1px solid rgba(243,241,235,.12)',
        boxShadow: '0 26px 56px -30px rgba(0,0,0,.85)', padding: '22px 26px',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: '#2f3d4a',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span style={{ fontSize: 24, fontWeight: 600 }}>🗂 Deals</span>
          <button
            onClick={() => setOpen(true)}
            aria-label="Add a deal"
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 0, background: '#1a9cf0',
              color: '#fff', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: 0,
            }}
          >+</button>
        </div>
        {deal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 22, color: '#1877d2', fontWeight: 600 }}>{deal.name}</span>
            <span style={{ fontSize: 19, color: '#8a99a8' }}>
              {deal.price ? `$${deal.price}` : 'no price'}{deal.close ? ` · closes ${deal.close}` : ' · no close date'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 21, color: '#8a99a8' }}>No deals yet</span>
        )}
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute', left: -40, right: -40, top: -30, zIndex: 5,
            background: 'rgba(19,41,63,.45)', borderRadius: 12, padding: 30,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', background: '#fff', borderRadius: 8, padding: 26,
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: '#2f3d4a',
              boxShadow: '0 30px 70px -24px rgba(0,0,0,.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, fontSize: 24, fontWeight: 600 }}>
              <span>Create deal</span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 0, color: '#8a99a8', fontSize: 22, cursor: 'pointer' }}>✕</button>
            </div>
            <input style={{ ...fieldStyle, marginBottom: 14 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Add name" />
            <div style={{ fontSize: 19, color: '#5b6b7a', marginBottom: 16 }}>Buyers › Start (temp stage)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 18, fontWeight: 600 }}>
                Price
                <input style={fieldStyle} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Add price" />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 18, fontWeight: 600 }}>
                Close date
                <input style={fieldStyle} value={close} onChange={(e) => setClose(e.target.value)} placeholder="Add close date" />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, alignItems: 'center' }}>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 0, color: '#5b6b7a', fontSize: 20, cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={save}
                disabled={!name.trim()}
                style={{
                  border: 0, borderRadius: 6, padding: '11px 22px', fontSize: 20, fontWeight: 600,
                  color: '#fff', background: name.trim() ? '#1a9cf0' : '#a8cfe9',
                  cursor: name.trim() ? 'pointer' : 'default',
                }}
              >Create Deal</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, minHeight: 34 }}>
        {deal ? (
          <button
            onClick={reset}
            style={{
              background: 'none', border: `1px solid ${BRASS}`, color: BRASS_LT,
              borderRadius: 999, padding: '8px 20px', fontSize: 20, cursor: 'pointer',
              fontFamily: "'Hanken Grotesk', sans-serif",
            }}
          >Do it again ↺</button>
        ) : (
          <span style={{ font: `400 var(--t-small)/1.3 'Hanken Grotesk'`, color: DIM }}>
            {open ? 'Fill it in, then Create Deal.' : 'Press the blue + to open it.'}
          </span>
        )}
      </div>
    </div>
  );
}

export function DealSlide() {
  const [touched, setTouched] = useState(0);

  return (
    <SlideCanvas deck="zillow-day1" label="Deals" deps={touched}>
      <section
        onClickCapture={() => setTouched((t) => t + 1)}
        style={{
          display: 'flex', flexDirection: 'column',
          padding: 'var(--pt) var(--px) var(--pb)',
          background: 'radial-gradient(130% 105% at 10% -8%, #2C2218 0%, #211910 42%, #180F08 100%)',
          color: TEXT, fontFamily: "'Hanken Grotesk', sans-serif", overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1560 }}>
          <h2 data-a="" style={{ margin: 0, font: `600 var(--t-title)/1.06 'Playfair Display', serif`, letterSpacing: '-.015em' }}>
            The deal nobody asks you for.
          </h2>
          <div data-w="2" style={{ height: 2, width: 120, background: BRASS }} />
          <p data-a="2" style={{ margin: 0, font: `400 var(--t-sub)/1.32 'Hanken Grotesk'`, color: DIM, maxWidth: 1400, textWrap: 'pretty' }}>
            Moving the stage to Under contract is half the job. Follow Up Boss will not prompt you for the rest.
          </p>
        </div>

        <div style={{ marginTop: 30, display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 52, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <Part n={3} label="Name" body="What the deal is. The property address is what everyone will look for." />
            <Part n={4} label="Price" body="What it actually went under contract at — not what it was listed at." />
            <Part n={5} label="Close date" body="A real date. Without one the deal cannot be forecast by anybody." />

            <div data-a="6" style={{
              border: '1px solid rgba(191,110,80,.4)',
              background: 'linear-gradient(180deg,rgba(150,70,50,.14),rgba(150,70,50,.04))',
              boxShadow: '0 26px 56px -30px rgba(0,0,0,.8)', borderRadius: 16,
              padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ font: `600 var(--t-eyebrow)/1.3 'Hanken Grotesk'`, letterSpacing: '.14em', textTransform: 'uppercase', color: '#D08A6A' }}>
                What it looks like when you forget
              </div>
              <p style={{ margin: 0, font: `400 var(--t-quote)/1.3 'Playfair Display', serif`, color: TEXT }}>
                "Under contract" with no deal attached — invisible in the pipeline, and missing from the commission numbers.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div data-a="7" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ font: `600 var(--t-eyebrow)/1 'Hanken Grotesk'`, letterSpacing: '.18em', textTransform: 'uppercase', color: BRASS_LT }}>
                The Create Deal dialog — try it
              </div>
              <DealMock />
            </div>
            <p data-a="8" style={{ margin: 0, font: `600 var(--t-body)/1.4 'Hanken Grotesk'`, color: BRASS_LT, textWrap: 'pretty' }}>
              The deal panel sits on the right of every contact record. You will do this for real on the next screen.
            </p>
          </div>
        </div>

        <footer style={{
          marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 40,
          alignItems: 'center', whiteSpace: 'nowrap', font: `400 25px/1 'Hanken Grotesk'`,
          letterSpacing: '.01em', color: '#867A65',
        }}>
          <span>TRU · Zillow Preferred Onboarding</span>
          <span>Proprietary training material · 2026</span>
          <span style={{ textAlign: 'right', color: BRASS_LT }}>16a</span>
        </footer>
      </section>
    </SlideCanvas>
  );
}
