"""Turn Eric's bundled Day 1 deck into assets TRU Rep can render natively.

The bundle is a JS app whose scripts the app's CSP blocks, so we do not ship the
bundle. We ship: the 18 slide <section>s as HTML, their images as real files, and
the deck's own CSS variables. The app then renders each slide itself.
"""
import re, io, json, os, base64, zlib

SRC = r"C:\Users\ericg\Downloads\Zillow Preferred Day 1.html"
OUTDIR = r"C:\Users\ericg\Desktop\truhq\pulse\web\public\decks"
IMGDIR = os.path.join(OUTDIR, "zillow-day1")

raw = io.open(SRC, encoding="utf-8", errors="replace").read()


def unesc_once(t):
    t = t.replace("\\u002F", "/").replace("\\u003C", "<").replace("\\u003E", ">")
    t = t.replace("\\u0026", "&").replace('\\"', '"')
    t = t.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
    return t


def unesc(t):
    for _ in range(2):
        t = unesc_once(t)
    return t


# ── 1. the asset manifest: "uuid":{"mime":..,"compressed":bool,"data":base64} ──
assets = {}
for m in re.finditer(
    r'"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"\s*:\s*\{'
    r'"mime"\s*:\s*"([^"]+)"\s*,\s*"compressed"\s*:\s*(true|false)\s*,\s*"data"\s*:\s*"([^"]*)"',
    raw,
):
    assets[m.group(1)] = {"mime": m.group(2), "compressed": m.group(3) == "true", "data": m.group(4)}
print("assets in bundle:", len(assets))

# ── 2. the slides ──
starts = [mm.start() for mm in re.finditer(r"<section data-label", raw)]
starts.append(len(raw))
slides = []
for i in range(len(starts) - 1):
    chunk = unesc(raw[starts[i]:starts[i + 1]])
    end = chunk.rfind("</section>")
    if end != -1:
        chunk = chunk[: end + len("</section>")]
    slides.append({
        "n": i + 1,
        "label": (re.search(r'data-label="([^"]*)"', chunk) or [None, "Slide"])[1],
        "notes": (re.search(r'data-speaker-notes="([^"]*)"', chunk) or [None, ""])[1],
        "html": chunk,
    })

EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
       "image/svg+xml": "svg"}

os.makedirs(IMGDIR, exist_ok=True)
written, missing = set(), set()


def asset_url(uid):
    a = assets.get(uid)
    if not a:
        missing.add(uid)
        return None
    ext = EXT.get(a["mime"], "bin")
    name = "%s.%s" % (uid, ext)
    if uid not in written:
        blob = base64.b64decode(a["data"])
        if a["compressed"]:
            blob = zlib.decompress(blob)
        io.open(os.path.join(IMGDIR, name), "wb").write(blob)
        written.add(uid)
    return "/decks/zillow-day1/" + name


UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

for s in slides:
    # <img src="uuid"> -> real file
    def fix_img(m):
        u = asset_url(m.group(1))
        return 'src="%s"' % u if u else 'src=""'
    s["html"] = re.sub(r'src="(%s)"' % UUID_RE, fix_img, s["html"])

    # <image-slot src="uuid" fit="cover" placeholder="..."> -> a plain <img>
    def fix_slot(m):
        tag = m.group(0)
        uid = re.search(UUID_RE, tag)
        alt = re.search(r'placeholder="([^"]*)"', tag)
        fit = re.search(r'fit="([^"]*)"', tag)
        url = asset_url(uid.group(0)) if uid else None
        if not url:
            return ""
        return ('<img src="%s" alt="%s" style="display:block;width:100%%;height:100%%;'
                'object-fit:%s">' % (url, (alt.group(1) if alt else ""), (fit.group(1) if fit else "cover")))
    s["html"] = re.sub(r"<image-slot\b[^>]*>(?:</image-slot>)?", fix_slot, s["html"])

# ── 2b. defang the markup ──
# It is static and in-repo, but it is rendered with dangerouslySetInnerHTML, so
# nothing that could execute survives extraction: no <script>, no on* handlers,
# no javascript: URLs. If the source deck ever changes, this still holds.
STRIP = 0
for s in slides:
    before = s["html"]
    s["html"] = re.sub(r"<script.*?</script>", "", s["html"], flags=re.S | re.I)
    s["html"] = re.sub(r"\son[a-z]+\s*=\s*\"[^\"]*\"", "", s["html"], flags=re.I)
    s["html"] = re.sub(r"\son[a-z]+\s*=\s*'[^']*'", "", s["html"], flags=re.I)
    s["html"] = re.sub(r"(href|src)\s*=\s*\"\s*javascript:[^\"]*\"", 'href="#"', s["html"], flags=re.I)
    if s["html"] != before:
        STRIP += 1
print("slides defanged:", STRIP)

# ── 2c. remap the type to the app's own fonts ──
# The export names Archivo and Source Serif and loads them from bundle-internal
# font files that do not exist outside it; the CSP also forbids fetching
# webfonts. Rewrite the family names in place rather than with a blanket CSS
# override, which flattened the deck's sans/serif pairing when tried.
for s in slides:
    h = s["html"]
    # SINGLE quotes on purpose: these land inside style="..." attributes, and
    # double quotes would terminate the attribute and silently drop the rule.
    for a, b in [("'Source Serif 4'", "'Playfair Display'"),
                 ('"Source Serif 4"', "'Playfair Display'"),
                 ("'Source Serif'", "'Playfair Display'"),
                 ("Source Serif 4", "'Playfair Display'"),
                 ("Archivo", "'Hanken Grotesk'")]:
        h = h.replace(a, b)
    s["html"] = h
print("fonts remapped")

print("images written:", len(written), "| unresolved:", len(missing))

# ── 3. the deck's CSS custom properties ──
mv = re.search(r"--px:\s*\d+px", raw)
block = ""
if mv:
    seg = unesc(raw[max(0, mv.start() - 600): mv.start() + 600])
    b = re.search(r"\{([^{}]*--px[^{}]*)\}", seg)
    if b:
        block = re.sub(r"\s+", " ", b.group(1)).strip()
print("css vars:", block[:300])

payload = {"width": 1920, "height": 1080, "vars": block, "slides": slides}
io.open(os.path.join(OUTDIR, "zillow-day1.json"), "w", encoding="utf-8").write(
    json.dumps(payload, ensure_ascii=False))
print("json bytes:", os.path.getsize(os.path.join(OUTDIR, "zillow-day1.json")))
for s in slides:
    print("  %2d %-24s %5d chars" % (s["n"], s["label"][:24], len(s["html"])))
