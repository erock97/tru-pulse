import { useEffect, useRef } from 'react';

/* ---------------------------------------------------------------------------
   THE LIGHT COMES OFF THE LETTERS. THE LETTERS ARE NEVER A PICTURE.

   Three earlier passes put a rendered plate of the wordmark on the page and
   travelled that. Every one of them read as a cut-out, for the same two
   reasons: a raster of type is not type, and a rendered "moving" plate turned
   out to hold no motion at all — the shipped clip measured 0.03/255 of mean
   change between frames, which is a still image in a video container.

   So nothing here is rendered artwork. The wordmark on the screen is the live
   `.arrive-type` element — the site's own Fraunces, the same three letters the
   header sets, crisp at every size because it is text. This canvas sits BEHIND
   it and draws only light: a field computed from the glyph outlines, so the
   bloom, the shafts and the embers all originate at the letterforms and move
   every frame under their own noise field.

   That ordering is the whole trick. Light is soft, so it can render at a
   fraction of the resolution and still look right; type is not, so it stays
   text and is never resampled. Neither layer is doing the other's job. */

/* The canvas is three times the wordmark's width, so the glyphs occupy the
   middle third of the texture and the light has a width of clear space either
   side to travel into. Everything below is derived from this one number, which
   is why the canvas and the live type cannot drift apart: the same constant
   sizes the element in CSS and places the glyphs in the field. */
export const GLOW_FRAME = 2.4;
const TEX_W = 1024;
/* Wide and shallow, because the wordmark is. A square-ish field spends most of
   its pixels on empty space above and below three capitals, and — since the
   canvas has to fit the viewport — that empty space is what ends up limiting
   how big the letters can be. 2.56:1 leaves about a cap height of room top and
   bottom, which is more than the bloom, the halo or the embers ever use. */
const TEX_H = 400;
/* Handed to the sizing pass, which has to know the shape of the light to know
   which axis of the viewport runs out first. */
export const GLOW_ASPECT = TEX_W / TEX_H;
/* How far out of the glyphs the distance field is worth knowing, in texture
   pixels. Past this the field saturates and the shader's falloff has already
   reached zero, so measuring further would cost time and change nothing. */
const SDF_RANGE = 140;

/* --- the distance field ---------------------------------------------------
   Felzenszwalb & Huttenlocher's exact euclidean transform, which is linear in
   the number of pixels — cheap enough to run on the main thread once, at mount
   and again if the webfont settles late.

   A blur of the glyphs would have been fewer lines and is what most of these
   effects use. It cannot work here: a blur tells you how much ink is nearby,
   not how far away the nearest edge is, so the falloff thickens wherever
   letters crowd — the inside of the R's bowl would glow harder than its stem
   for no reason an eye can accept. Distance is the quantity the light actually
   obeys. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
}

/* Rasterise the wordmark, then turn it into a signed distance field. The face,
   weight and letterforms are read off the live element rather than restated, so
   the field is a field of THIS wordmark — change the type in the stylesheet and
   the light changes shape with it, with nothing here to keep in step. */
function buildSDF(font: string, segments: readonly string[], tracking: string): Uint8Array {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, TEX_W, TEX_H);

  /* SET THE FONT AT THE PAGE'S OWN SIZE AND SCALE THE CANVAS, NEVER THE FONT.

     Fraunces is a variable face with an optical-size axis, so "the same font"
     at two sizes is not the same letterforms — the small-text design is heavier
     and lower in contrast than the display design. The hero sets the mark at
     around 25px and blows it up eightfold with a transform, and a transform
     does not re-resolve `opsz`: the page is showing the 25px drawing of
     Fraunces, enormous.

     Building the field at a nominal 200px therefore produced the light of a
     visibly different wordmark — thinner strokes, taller caps, wrong width per
     letter — sitting behind the real one. It read as a second, badly registered
     copy of the logo, which is the exact cut-out effect this component exists
     to get rid of.

     Setting the size the page sets and scaling the CONTEXT reproduces what the
     browser does: one optical size, one outline, geometrically enlarged. */
  ctx.font = font;
  if (tracking && 'letterSpacing' in ctx) ctx.letterSpacing = tracking;

  /* DRAW THE RUNS SEPARATELY, EXACTLY AS THE PAGE DOES.

     The mark is marked up as `T<i>RU</i>` so the R and the U can take the gold,
     and a kern pair does not cross an element boundary — the browser therefore
     sets T and R further apart than the font asks for. `measureText('TRU')`
     does apply that kern, so a field built from the whole string came out
     tighter than the type it was supposed to be lighting, and every letter
     after the first sat a few pixels left of its glow. At eight times size that
     is not subtle; it looks like a second wordmark in poor register, which is
     precisely the cut-out this component exists to avoid.

     Measuring and placing each run the way the DOM lays them out reproduces the
     page's own spacing, kerning gap included. */
  const runs = segments.map((t) => ({ t, w: ctx.measureText(t).width }));
  const total = runs.reduce((a, r) => a + r.w, 0);
  const k = TEX_W / GLOW_FRAME / Math.max(total, 1);
  ctx.setTransform(k, 0, 0, k, 0, 0);

  const m = ctx.measureText(segments.join(''));
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // Centre the INK box, not the em box. The em box carries the descender space
  // that "TRU" does not use, and centring on it hangs the light low.
  const baseline =
    TEX_H / 2 / k + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  let x = (TEX_W / 2) / k - total / 2;
  for (const r of runs) {
    ctx.fillText(r.t, x, baseline);
    x += r.w;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const px = ctx.getImageData(0, 0, TEX_W, TEX_H).data;
  const n = TEX_W * TEX_H;
  const outside = new Float64Array(n);
  const inside = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = px[i * 4 + 3] / 255;
    // Anti-aliased coverage split both ways, so the zero crossing sits on the
    // real outline instead of on whichever side of it the threshold fell.
    outside[i] = a > 0.5 ? 0 : 1e12;
    inside[i] = a > 0.5 ? 1e12 : 0;
  }
  edt2d(outside, TEX_W, TEX_H);
  edt2d(inside, TEX_W, TEX_H);

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.sqrt(outside[i]) - Math.sqrt(inside[i]);
    // 0.5 is the outline. Above it is inside the glyph, below it is out.
    out[i] = Math.max(0, Math.min(255, Math.round((0.5 - d / (2 * SDF_RANGE)) * 255)));
  }
  return out;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uSDF;
uniform float uTime;     // seconds
uniform float uFade;     // 1 while the mark owns the screen, 0 once it lands
uniform float uIgnite;   // 0 -> 1 over the first moment on the page
uniform float uRange;

/* Positive outside the glyph, negative inside, in texture pixels. */
float sdf(vec2 uv) { return (0.5 - texture(uSDF, uv).r) * 2.0 * uRange; }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = vUv;
  float d = sdf(uv);

  /* The field the light moves through. Two fbm samples steer a third, which is
     what stops it looking like a texture sliding past: the flow drags the
     detail rather than translating it, so the light licks and folds instead of
     panning. Slow — this is a wordmark breathing, not a fire. */
  vec2 flow = vec2(fbm(uv * 3.0 + vec2(0.0, -uTime * 0.06)),
                   fbm(uv * 3.0 + vec2(5.2, 3.1 - uTime * 0.05)));
  float lick = fbm(uv * 6.0 + flow * 1.4 + vec2(uTime * 0.05, -uTime * 0.13));

  /* THE INTERIOR MASK IS GONE, AND THAT IS A ROBUSTNESS FIX.

     There used to be a mask here suppressing light inside the glyphs. Its only
     visible job was invisible: the live type is opaque and sits on top, so
     light painted under it cannot be seen. What the mask DID do was turn every
     disagreement between the field and the DOM into a black hole.

     And they do disagree. Canvas 2D synthesises the 800 weight slightly fatter
     than the real variable axis the page renders, and the excess lands on the
     serif brackets — so the T grew two jagged black wedges at its foot, which
     is the "the T looks wrong" everyone could see and nobody could name.
     Isolating the terms into separate colour channels showed the mask dark
     exactly there.

     Without it, a field that is a shade fat simply lights a little further
     under a letter that already covers it. The failure mode goes from a torn
     black shape to nothing at all. */
  float outward = 1.0;

  /* THREE FALLOFFS, NOT ONE WITH A MOVING RADIUS.

     Modulating a single falloff's REACH per pixel looked like breathing until
     you saw what it does in the concave places: between the T's arm and its
     stem, or inside the bowl of the R, the nearest ink is far enough that a
     short radius has already died — so those pockets went black while
     everything around them stayed lit, and the wordmark read as blotched.

     A tight core plus a mid field plus a wide halo cannot do that, because the
     halo is still alive at the distances where the core has gone. The noise
     then modulates BRIGHTNESS rather than reach, which can only make light
     stronger or weaker where it already is — it can never open a hole. */
  float core = exp(-max(d, 0.0) / 18.0);
  float mid  = exp(-max(d, 0.0) / 78.0);
  /* WEIGHTED TOWARD THE MID FIELD, WHICH IS A CONTRAST DECISION, NOT A TASTE ONE.

     Leading with the tight core drove the first millimetre off every stroke
     past white while the pockets between strokes — inside the R's bowl, under
     the arm of the T — were still four or five stops down. The eye reads that
     spread as dirt on the letters rather than as light around them. Flattening
     the ratio costs some drama at the outline and buys a wordmark that is lit
     all over, which is what being in a light actually looks like. */
  float bloom = outward * (core * 0.46 * (0.70 + 0.42 * lick)
                         + mid * 0.62 * (0.74 + 0.46 * lick));

  // The far light, which is what puts the wordmark in a room rather than on a
  // background. Wide, slow, and almost flat.
  float halo = exp(-max(d, 0.0) / 190.0) * outward * (0.34 + 0.32 * fbm(uv * 2.0 + uTime * 0.03));

  /* Shafts. Marching back toward the mark accumulating glyph coverage is the
     standard occlusion sweep, and it is the one effect here that genuinely
     could not come from a filter: what it draws depends on which letters lie
     between this pixel and the middle, so the shafts fan out of the gaps
     between the strokes the way real light through a stencil does. */
  vec2 c = vec2(0.5);
  vec2 dir = uv - c;
  float jitter = hash(uv * 512.0 + uTime);
  float rays = 0.0, w = 1.0, wsum = 0.0;
  for (int i = 0; i < 20; i++) {
    float t = (float(i) + jitter) / 20.0;
    vec2 p = c + dir * (1.0 - t * 0.62);
    /* SOFT COVERAGE, NOT A COVERAGE TEST.

       Reading each sample as in-ink-or-not is very nearly a binary, and twenty
       binaries summed is a staircase: as a sightline swings past the edge of a
       stroke the total jumps, and the jump draws a hard-edged wedge in the
       light. That is what put crisp black triangles under the arm of the T,
       and no amount of retuning the falloffs could remove them because they
       were never a falloff. Letting each sample fade over thirty pixels makes
       the sum continuous in the sightline's angle, which is the only thing
       that was wrong with it. */
    rays += smoothstep(20.0, -6.0, sdf(p)) * w;
    wsum += w;
    w *= 0.90;
  }
  rays /= max(wsum, 1e-4);
  /* SHAFTS ARE A FAR-FIELD EFFECT. THIS LINE IS WHY THE T LOOKED WRONG.

     The sweep marches from this pixel back toward the mark counting ink, so
     within a few pixels of a stroke the count is dominated by that stroke's own
     local shape — and it traced hard, spiky wedges around the T's foot serifs
     that read as torn black shapes stuck to the letter. Isolating the term
     proved it: the wedges were entirely in the shaft channel, and the interior
     mask underneath them was clean.

     Light behaves the same way. You see shafts in the haze at a distance from a
     source, never clinging to it — up close there is only glow. So the shafts
     are held off until well clear of the ink, and the near field is left to the
     bloom, which is smooth by construction. */
  rays *= smoothstep(14.0, 105.0, d);
  rays *= smoothstep(0.02, 0.40, length(dir * vec2(1.0, 2.0)));
  // Shimmer by angle, so neighbouring shafts brighten independently.
  rays *= 0.42 + 0.78 * fbm(vec2(atan(dir.y, dir.x) * 3.0, uTime * 0.22));

  /* Embers. One cell of a coarse grid may hold one, it rises, it dies, and the
     cell's own hash decides whether it exists at all — so they do not pulse in
     unison, which is the tell that gives away a grid. Weighted by how near the
     cell sits to a letter, because they are supposed to be coming off the
     type, not off the canvas. */
  vec2 gp = uv * vec2(26.0, 13.0);
  vec2 gi = floor(gp);
  float h = hash(gi);
  float life = fract(uTime * (0.10 + 0.16 * h) + h * 7.0);
  vec2 sp = fract(gp) - vec2(0.5 + 0.26 * sin((h + uTime * 0.2) * 6.2832), 1.15 - life * 2.0);
  float near = exp(-max(sdf((gi + 0.5) / vec2(26.0, 13.0)), 0.0) / 65.0);
  float ember = exp(-dot(sp, sp) * 300.0) * (1.0 - life) * near * step(0.78, h);

  const vec3 GOLD = vec3(0.949, 0.698, 0.235);
  const vec3 WARM = vec3(1.000, 0.863, 0.576);
  const vec3 BONE = vec3(0.929, 0.949, 0.925);

  /* Weighted so the SHAFTS carry it and the collar only holds the letters.

     A bloom-led mix is a glow filter — which is what every version of this
     looks like when it is wrong — because an even collar of light around a
     shape says "outline", while light thrown across open space says "source".
     The bloom is here to make the letters look lit. The rays are here to make
     them look like they are doing the lighting. */
  /* An ambient floor, and the reason it has to exist.

     The shafts are the biggest term, and a shaft is zero wherever this pixel's
     sightline back to the mark happens to run down a gap between strokes
     without crossing any ink — under the arm of the T, beside the foot of its
     stem. Those places were coming out BLACK while everything around them was
     lit, in hard wedges that read as dirt on the letters rather than as light
     behaving. Light that a surface is not receiving directly is not black, it
     is dimmer; giving the shafts something to add to rather than something to
     define is the whole fix. */
  float ambient = outward * exp(-max(d, 0.0) / 210.0);

  /* RESTRAINT IS THE SPEC, NOT A TASTE.

     At the previous weights the glow was the subject and the wordmark was
     something floating in it: the letters' own colours shifted under the
     halation, the white T read as damaged against the furnace behind it, and
     the whole thing was "way too bright" — Eric's words, and he was right. The
     letters are the logo. The light's entire job is to make them look bold and
     alive, never to compete. Every term is roughly a third of what it was, and
     nothing is allowed near white except the embers, which are single pixels. */
  vec3 col = vec3(0.0);
  /* THE TWO WIDE TERMS ARE THE MILK, SO THEY ARE THE ONES THAT GET CUT.

     The ambient and the halo are broad and flat by design, which means they
     raise the floor everywhere at once — including the ground the letters have
     to be brighter than. No amount of darkness painted underneath can win
     against them, because this layer ADDS. So the fill comes down hard and the
     two terms that carry the character stay: the tight bloom that holds the
     strokes, and the shafts out in the open field. Ethereal, without the haze
     sitting on the mark itself. */
  col += GOLD * ambient * 0.04;
  col += WARM * bloom * 0.26;
  col += GOLD * halo * 0.14;
  col += mix(GOLD, BONE, 0.35) * rays * 0.20;
  col += WARM * ember * 1.7;

  /* THE LIGHT MUST REACH ZERO BEFORE THE CANVAS DOES.

     This is the guard that makes the whole approach safe. Any light drawn on a
     canvas will show the canvas's own rectangle the moment it is still non-zero
     at the edge of it, and a visible rectangle is exactly the cut-out that four
     versions of this hero have been trying to escape. Softening the shaft
     sampling once lifted the far field just enough to light the corners, and a
     gold slab with a hard bottom edge appeared across the hero instantly.

     So the edge is enforced rather than hoped for: whatever the terms above do,
     they are multiplied to nothing over the outer band of both axes. Tighter
     vertically, because that axis is shorter and the header sits above it. */
  vec2 q = abs(uv - 0.5) * 2.0;
  col *= (1.0 - smoothstep(0.44, 0.94, q.x)) * (1.0 - smoothstep(0.30, 0.88, q.y));

  /* PREMULTIPLIED, WHICH IS NOT A DETAIL — IT IS THE DIFFERENCE BETWEEN LIGHT
     AND A STENCIL.

     The canvas carries no ground of its own: alpha comes from the light's own
     strength, so the page's room shows through everywhere the light is not.
     Emitting that as STRAIGHT alpha is what wrecked the first version of this.
     The browser then composites col * a + (1 - a) * page, and since a is
     derived from col, every midtone gets squared — light at half strength
     landed at a quarter. The result was a wordmark with a blown-out white rind
     and hard black wedges in every pocket between strokes, which reads as dirt
     on the letters and was the single biggest reason this still looked cheap
     after the artwork was gone.

     Declaring the buffer premultiplied makes the composite col + (1 - a) * page
     instead: the light ADDS to the room, which is what light does. Midtones
     survive, the pockets sit where they belong, and nothing has to be blown out
     to look bright. */
  float k = uFade * uIgnite;
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  frag = vec4(min(col, vec3(1.6)) * k, a * k);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  }
  return s;
}

type Props = {
  /** The wordmark, taken from the same place the live type gets it. */
  text: string;
  /** Written by the scroll rig every frame: 1 at the top, 0 once landed. */
  fadeRef: React.MutableRefObject<number>;
};

export default function MarkGlow({ text, fadeRef }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    /* The light is soft at every scale, so it is drawn at a fixed, modest
       backing store and stretched. The wordmark it surrounds is text and is
       never stretched, which is the only reason this is allowed to be cheap. */
    canvas.width = 900;
    canvas.height = Math.round((900 * TEX_H) / TEX_W);
    // The stylesheet sizes the canvas in multiples of the wordmark; the shader
    // places the glyphs at the reciprocal of the same number. Passing it rather
    // than restating it is what keeps the light on the letters after a change.
    canvas.style.setProperty('--glow-frame', String(GLOW_FRAME));
    canvas.style.setProperty('--glow-aspect', `${TEX_W} / ${TEX_H}`);

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      // See the fragment shader's closing note: straight alpha squares every
      // midtone here, because the alpha is computed from the colour.
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    // No WebGL2 is not a failure state: the live type is already on the screen
    // and the page loses an effect, not its wordmark.
    if (!gl) return;

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    } catch {
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uFade = gl.getUniformLocation(prog, 'uFade');
    const uIgnite = gl.getUniformLocation(prog, 'uIgnite');
    gl.uniform1i(gl.getUniformLocation(prog, 'uSDF'), 0);
    gl.uniform1f(gl.getUniformLocation(prog, 'uRange'), SDF_RANGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.viewport(0, 0, canvas.width, canvas.height);

    let ready = false;
    let disposed = false;
    let lastFont = '';
    const upload = (force = false) => {
      // StrictMode mounts twice. The first instance's `fonts.ready` resolves
      // after its cleanup has already deleted this texture, and uploading to a
      // deleted object is a console warning on every single load.
      if (disposed) return;
      // Read the face off the live wordmark. Restating it here is how the light
      // and the letters end up drawn in two different fonts after a redesign.
      const type = document.querySelector<HTMLElement>('.truland .arrive-type');
      const cs = type ? getComputedStyle(type) : null;
      // The page's own size, not a nominal one — see buildSDF on optical sizing.
      const font = cs
        ? `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        : '800 25px Fraunces, Georgia, serif';
      /* Rebuilding an identical field costs a euclidean transform over 400k
         pixels, and resize fires in bursts — but the font STRING is not the
         whole story. When the webfont finishes loading, the computed style is
         byte-for-byte what it already was and the rasteriser quietly starts
         producing different outlines. Skipping that rebuild left the light
         shaped like the fallback face, glowing a Georgia wordmark behind a
         Fraunces one. Hence `force`: the size check guards resize, and nothing
         else. */
      if (!force && font === lastFont) return;
      lastFont = font;
      // The same split the markup uses: the first letter, then the rest.
      const data = buildSDF(font, [text[0], text.slice(1)], cs?.letterSpacing ?? '');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TEX_W, TEX_H, 0, gl.RED, gl.UNSIGNED_BYTE, data);

      /* Line up the canvas with the INK of the type, not with its line box.

         The field centres the glyphs' ink box in the texture, but the canvas is
         centred on the mark's line box — and for all-caps those are not the
         same point. The ink of "TRU" sits entirely above the baseline while the
         line box reserves room for descenders that never come, so centring on
         the box hangs the light low by a visible fraction of an em at 17x.

         The offset falls out of the font's own metrics, and the line height
         cancels out of the algebra entirely, so this holds whatever the header
         is set in:
             baseline  = (L - (fbA + fbD)) / 2 + fbA
             ink centre = baseline - ascent / 2
             delta      = ink centre - L / 2 = (fbA - fbD) / 2 - ascent / 2 */
      const mc = document.createElement('canvas').getContext('2d');
      if (mc) {
        mc.font = font;
        if (cs?.letterSpacing && 'letterSpacing' in mc) mc.letterSpacing = cs.letterSpacing;
        const m = mc.measureText(text);
        const em = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '200');
        const delta =
          (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 -
          (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
        canvas.style.setProperty('--glow-dy', `${(delta / em).toFixed(4)}em`);
      }
      ready = true;
    };
    upload();
    // The fallback face has different outlines, so a field built before the
    // webfont arrives is the light of a wordmark that is no longer there.
    const rebuild = (force = false) => {
      try { upload(force); } catch { /* keep the field we have */ }
    };
    /* The mark's size is written onto it by the measuring pass, and it is set in
       rem, so it moves with the viewport. Since the optical size the field is
       built at has to be the one the page is showing, a size change is a field
       change — this is not a resolution concern, it is the letterforms. */
    if (document.fonts?.ready) void document.fonts.ready.then(() => rebuild(true));
    let reFont = 0;
    const onResize = () => {
      clearTimeout(reFont);
      reFont = window.setTimeout(() => rebuild(), 120) as unknown as number;
    };
    window.addEventListener('resize', onResize, { passive: true });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const t0 = performance.now();

    const draw = (now: number) => {
      raf = 0;
      if (!ready) return;
      const elapsed = (now - t0) / 1000;
      const fade = Math.max(0, Math.min(1, fadeRef.current));
      // Ignition. Something has to happen for a reader who lands and does not
      // scroll, which is most of them for the first second.
      const ignite = Math.min(1, elapsed / 1.6) ** 1.5;

      gl.uniform1f(uTime, reduced.matches ? 6 : elapsed);
      gl.uniform1f(uFade, fade);
      gl.uniform1f(uIgnite, ignite);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Stop when there is nothing left to animate: landed, off-tab, or a
      // reader who has asked for stillness and has had their one frame.
      const done = fade <= 0.001 || document.hidden || (reduced.matches && ignite >= 1);
      if (!done) raf = requestAnimationFrame(draw);
    };

    // Kept alive by the scroll rig, which pokes this whenever the mark is
    // visible again after a stop.
    const wake = () => { if (!raf) raf = requestAnimationFrame(draw); };
    canvas.dataset.wake = '1';
    (canvas as HTMLCanvasElement & { __wake?: () => void }).__wake = wake;
    document.addEventListener('visibilitychange', wake);
    wake();

    return () => {
      disposed = true;
      clearTimeout(reFont);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', wake);
      cancelAnimationFrame(raf);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [text, fadeRef]);

  return <canvas className="arrive-glow" ref={ref} aria-hidden />;
}
