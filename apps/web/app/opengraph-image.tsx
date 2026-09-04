import { ImageResponse } from 'next/og';

/**
 * The card that appears when a Syncline link is pasted anywhere.
 *
 * Generated rather than committed as a PNG, so it cannot drift from the tagline it quotes — there
 * is one copy of that string and both the card and the page metadata read it.
 *
 * Deliberately plain: no imported font, no external image. Both are the two things that make
 * `ImageResponse` fail at build time rather than at request time, and a broken build over a social
 * preview would be a poor trade. System type renders fine at this size.
 */

export const alt =
  'Syncline — every layer of your stack, folded onto one timeline';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** The three strata, same order and meaning as the mark. */
const STRATA = [
  { color: '#1795b1', width: 760 },
  { color: '#bd7816', width: 560 },
  { color: '#8043cd', width: 360 },
];

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: '#0a0a0b',
        padding: '80px',
        color: '#fafafa',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {STRATA.map((stratum) => (
          <div
            key={stratum.color}
            style={{
              width: stratum.width,
              height: 18,
              borderRadius: 9,
              background: stratum.color,
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 78,
          fontWeight: 700,
          marginTop: 56,
          letterSpacing: '-0.03em',
        }}
      >
        syncline
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 34,
          color: '#a1a1aa',
          marginTop: 18,
          letterSpacing: '-0.01em',
        }}
      >
        Every layer of your stack, folded onto one timeline.
      </div>

      <div
        style={{
          display: 'flex',
          fontSize: 24,
          color: '#71717a',
          marginTop: 40,
        }}
      >
        Session replay · distributed tracing · self-hostable
      </div>
    </div>,
    size,
  );
}
