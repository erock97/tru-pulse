"""
TRU — Free Accountability Audit
===============================
A single-team, single-file sales tool. Point it at ONE Follow Up Boss API key
(a prospect's) and it produces a branded, printable one-page audit showing:

  • how many paid leads (Zillow, Realtor.com, Homes.com, Facebook, Google, and
    pay-at-close referral networks) came in over the window,
  • how many got ZERO personal contact (no call, <2 outgoing texts, not a Zillow
    live-connect),
  • how many are STUCK in Lead status,
  • and a conservative, fully-disclosed estimate of the GCI at risk.

This is the top-of-funnel lead magnet for the TRU suite (see the GTM plan). The
flag math is IDENTICAL to the daily puller (~/fub_tool.pyw) so the numbers match
what Terrason already stands behind — plus a Zillow-Connected exemption so the
audit never OVER-counts (honest numbers are the whole pitch).

Zero third-party dependencies (stdlib only). Output is an .html file you open in
a browser and "Print → Save as PDF".

USAGE
  python accountability_audit.py --demo
      Build a sample audit from synthetic data (no network). Great for a look.

  python accountability_audit.py --key <FUB_API_KEY> --team "Prospect Team"
      Live audit against a real FUB account (read-only pulls).

  Optional knobs (all shown on the report so nothing is hidden):
    --window 30        lookback in days (default 30)
    --gci 10000        avg gross commission per closing (default $10,000)
    --close-rate 2     % of properly-worked leads that close (default 2.0)
    --cpl 45           your cost per paid lead (optional → adds wasted ad spend)
    --out audit.html   output path (default: TRU_Audit_<team>.html on Desktop)
"""

import os, sys, json, ssl, base64, re, html, argparse
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta

# ─────────────────────────────────────────────────────────── flag definitions
# IDENTICAL to ~/fub_tool.pyw and the dashboard's flags.ts. Do not drift.
BASE = "https://api.followupboss.com/v1"
# The big paid lead sources this audit tracks. FUB "source" strings vary a lot by
# team, so we match by FAMILY (keyword/substring), not exact equality — that's what
# makes the audit accurate on ANY prospect's account, not just tidy ones. Variants
# like "Zillow Premier Agent", "Zillow Flex", "FB Ads" all land. Realtor.com folds
# in its MVIP / Market VIP (Opcity) subset.
#
# PAY-AT-CLOSE COUNTS TOO (Eric): referral leads (Zillow Flex, Realtor.com referral,
# Redfin, HomeLight, ...) have no up-front cost, but an un-worked one is still lost
# GCI *and* a hit to program-performance requirements. They're tracked fully here; the
# headline "GCI at risk" counts every paid source equally. Bare "Opcity" is left out on
# purpose (sunsetting) — see the Opcity source rule.
SOURCE_FAMILIES = [
    ("Zillow",      ("zillow",)),                     # incl. Zillow Flex (pay-at-close)
    ("Realtor.com", ("realtor.com", "market vip")),   # incl. MVIP referral
    ("Homes.com",   ("homes.com",)),
    ("Facebook",    ("facebook", "instagram")),
    ("Google",      ("google", "adwords", "local services", "lsa", "ppc")),
    ("Referrals",   ("redfin", "homelight", "rocket homes", "rockethomes",
                     "upnest", "referralexchange", "fastexpert", "fast expert")),
]
OUTBOUND_TYPES = {"call", "email", "text message", "sms", "text"}
STUCK_STAGES = {"lead", "new lead", "uncontacted"}
ZILLOW_CONNECTED_TAG = "zillow connected"
MAX_PAGES = 40  # wider than the daily puller — an audit looks back further


def source_family(source):
    """Map a raw FUB source string to one of the tracked paid-source families, or
    None if it isn't one we track. Substring match so naming variants still land."""
    s = (source or "").strip().lower()
    if not s:
        return None
    for label, keys in SOURCE_FAMILIES:
        if any(k in s for k in keys):
            return label
    return None


# ─────────────────────────────────────────────────────────────────── networking
def ssl_ctx(verify=True):
    return ssl.create_default_context() if verify else ssl._create_unverified_context()

def api_get(path, key, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    token = base64.b64encode((key.strip() + ":").encode()).decode()
    req = urllib.request.Request(url, headers={"Authorization": "Basic " + token,
                                               "Accept": "application/json"})
    try:
        try:
            resp = urllib.request.urlopen(req, timeout=30, context=ssl_ctx(True))
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, ssl.SSLError):
            resp = urllib.request.urlopen(req, timeout=30, context=ssl_ctx(False))
        with resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            body = json.loads(body)
        except Exception:
            pass
        return e.code, body
    except Exception as e:
        return None, str(e)

def parse_dt(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        try:
            return datetime.fromisoformat(s[:19]).replace(tzinfo=timezone.utc)
        except Exception:
            return None

def detect_subdomain(key):
    code, data = api_get("/identity", key)
    if code != 200 or not isinstance(data, (dict, list)):
        return None
    found = []
    def walk(o):
        if isinstance(o, dict):
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
        elif isinstance(o, str):
            m = re.search(r"([a-z0-9][a-z0-9\-]*)\.followupboss\.com", o, re.I)
            if m:
                sub = m.group(1).lower()
                if sub not in ("api", "www", "app", "docs", "help"):
                    found.append(sub)
    walk(data)
    return found[0] if found else None

def count_outgoing_texts(key, pid):
    c, d = api_get("/textMessages", key, {"personId": pid, "limit": 100})
    if c != 200 or not isinstance(d, dict):
        return 0
    msgs = d.get("textmessages", d.get("textMessages", [])) or []
    return sum(1 for m in msgs if not m.get("isIncoming", False))

def count_calls(key, pid):
    c, d = api_get("/calls", key, {"personId": pid, "limit": 100})
    if c != 200 or not isinstance(d, dict):
        return 0
    calls = d.get("calls", []) or []
    if calls:
        return len(calls)
    meta = d.get("_metadata", {})
    return int(meta.get("total", 0)) if isinstance(meta, dict) else 0

def person_tags(p):
    tags = p.get("tags") or []
    return [str(t).strip().lower() for t in tags] if isinstance(tags, list) else []

def is_zillow_connected(tags):
    return any(ZILLOW_CONNECTED_TAG in t for t in tags)


# ─────────────────────────────────────────────────────────────── data pull
def pull_and_classify(key, window_days, log):
    """Return {ok, error, total, zero:[...], stuck:[...], worked, by_source:{}}."""
    res = {"ok": False, "error": "", "total": 0, "zero": [], "stuck": [],
           "worked": 0, "by_source": {}}

    code, _ = api_get("/people", key, {"limit": 1})
    if code == 401:
        res["error"] = "API key rejected (401). Re-copy it from FUB → Admin → API."
        return res
    if code != 200:
        res["error"] = "Could not connect to Follow Up Boss (response " + str(code) + ")."
        return res

    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
    leads, offset, pages, stop = [], 0, 0, False
    while pages < MAX_PAGES and not stop:
        c, d = api_get("/people", key, {"limit": 100, "offset": offset, "sort": "-created"})
        if c != 200 or not isinstance(d, dict):
            break
        people = d.get("people", [])
        if not people:
            break
        for p in people:
            cdt = parse_dt(p.get("created"))
            if cdt and cdt < cutoff:
                stop = True
                break
            leads.append(p)
        pages += 1
        offset += 100
        if len(people) < 100:
            break

    in_scope = [p for p in leads if source_family(p.get("source")) is not None]
    res["total"] = len(in_scope)
    log("  " + str(len(leads)) + " leads in window, " + str(len(in_scope)) + " from paid sources")

    for p in in_scope:
        pid = p.get("id")
        fam = source_family(p.get("source")) or "Other"
        res["by_source"][fam] = res["by_source"].get(fam, 0) + 1
        rec = {
            "id": pid,
            "name": p.get("name") or ((p.get("firstName", "") + " " + p.get("lastName", "")).strip()) or "Unknown",
            "source": fam,
            "agent": p.get("assignedTo") or "Unassigned",
            "created": str(p.get("created", ""))[:10],
        }
        stage = str(p.get("stage", "")).strip().lower()
        tags = person_tags(p)

        # Rule 1 — stuck in Lead status is always a flag (matches the puller).
        if stage in STUCK_STAGES:
            res["stuck"].append(rec)
            continue
        # Zillow live-connects speak to the buyer instantly but never log a call
        # in FUB — the tag is our proof of contact, so never count them as zero.
        if is_zillow_connected(tags):
            res["worked"] += 1
            continue
        # Rule 2 — real effort = 2+ outgoing texts OR 1+ call (either direction).
        out_texts = count_outgoing_texts(key, pid)
        calls = count_calls(key, pid)
        if out_texts >= 2 or calls >= 1:
            res["worked"] += 1
        else:
            res["zero"].append(rec)

    res["ok"] = True
    return res


# ─────────────────────────────────────────────────────────────── bleed math
def compute_bleed(res, avg_gci, close_rate_pct, cpl, window_days):
    """Conservative, fully-disclosed at-risk GCI. Nothing hidden."""
    untouched = len(res["zero"])   # headline = leads with no personal contact
    n_stuck = len(res["stuck"])
    close_rate = close_rate_pct / 100.0
    window_bleed = untouched * close_rate * avg_gci
    annual_factor = 365.0 / max(window_days, 1)
    annual_bleed = window_bleed * annual_factor
    wasted_spend = (untouched + n_stuck) * cpl if cpl else 0.0
    contact_rate = (res["worked"] / res["total"] * 100.0) if res["total"] else 0.0
    return {
        "untouched": untouched, "n_stuck": n_stuck,
        "window_bleed": window_bleed, "annual_bleed": annual_bleed,
        "wasted_spend": wasted_spend, "contact_rate": contact_rate,
        "annual_factor": annual_factor,
    }


def money(x):
    return "$" + format(int(round(x)), ",")


# ─────────────────────────────────────────────────────────────── render
# Static stylesheet — palette hex inlined (TRU brand: gold/espresso/cream). Kept
# as one literal block so there is no fragile string concatenation in the markup.
AUDIT_CSS = """
  * { box-sizing:border-box; }
  body { margin:0; background:#fbf7f0; color:#33281a;
         font-family:-apple-system,'Segoe UI',Arial,sans-serif;
         -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .page { max-width:820px; margin:0 auto; padding:40px 44px 56px; }
  .brandbar { display:flex; align-items:center; justify-content:space-between;
              border-bottom:2px solid #a9791f; padding-bottom:14px; }
  .brand { font-weight:800; letter-spacing:.5px; font-size:22px; color:#33281a; }
  .brand .t { color:#a9791f; }
  .brandtag { font-weight:500; font-size:15px; color:#8a7a63; }
  .brandsub { font-size:12px; color:#8a7a63; text-align:right; }
  h1 { font-size:26px; margin:26px 0 4px; }
  .lede { color:#8a7a63; font-size:14px; margin:0 0 22px; }
  .lede b { color:#33281a; }
  .stats { display:flex; gap:14px; margin:0 0 8px; }
  .stat { flex:1; background:#fff; border:1px solid #e6dac6; border-radius:12px; padding:16px 14px; text-align:center; }
  .statnum { font-size:34px; font-weight:800; line-height:1; }
  .statlbl { font-size:11px; color:#8a7a63; margin-top:6px; text-transform:uppercase; letter-spacing:.6px; }
  .bleed { background:#33281a; color:#fbf7f0; border-radius:14px; padding:22px 24px; margin:22px 0; }
  .bleed .big { font-size:40px; font-weight:800; color:#a9791f; line-height:1; }
  .bleed .cap { font-size:13px; color:#d9cdb6; margin-top:6px; }
  .bleed .sub { font-size:13px; color:#cabfa8; margin-top:12px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.7px; color:#a9791f; margin:26px 0 10px; }
  table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; border:1px solid #e6dac6; border-radius:10px; overflow:hidden; }
  th { text-align:left; background:#f4eee3; color:#8a7a63; font-size:11px; text-transform:uppercase; letter-spacing:.5px; padding:9px 12px; }
  td { padding:9px 12px; border-top:1px solid #e6dac6; }
  .mut { color:#8a7a63; }
  .smallnote { font-size:12px; margin-top:8px; }
  .chip { display:inline-block; background:#fff; border:1px solid #e6dac6; border-radius:20px; padding:4px 12px; font-size:12px; margin:0 6px 6px 0; color:#33281a; }
  .cta { margin-top:28px; background:#f4eee3; border:1px solid #e6dac6; border-left:4px solid #a9791f; border-radius:10px; padding:18px 20px; }
  .cta h3 { margin:0 0 6px; font-size:16px; }
  .cta p { margin:0; font-size:13px; color:#8a7a63; }
  .foot { margin-top:26px; font-size:11px; color:#8a7a63; line-height:1.6; border-top:1px solid #e6dac6; padding-top:12px; }
  @media print { .page { padding:24px 28px; } body { background:#fff; } }
"""


def _stat(num, label, color):
    return ('<div class="stat"><div class="statnum" style="color:' + color + '">' + num +
            '</div><div class="statlbl">' + label + '</div></div>')


def render_audit_html(team, res, bleed, window_days, avg_gci, close_rate_pct, cpl):
    now = datetime.now().strftime("%B %d, %Y")
    n_zero, n_stuck, total = len(res["zero"]), len(res["stuck"]), res["total"]
    team_esc = html.escape(team)

    stats = (_stat(str(total), "Paid leads", "#33281a") +
             _stat(str(n_zero), "Zero personal contact", "#c0492f") +
             _stat(str(n_stuck), "Stuck in Lead status", "#a9791f") +
             _stat(str(int(round(bleed["contact_rate"]))) + "%", "Actually worked", "#2e8b57"))

    src_chips = ""
    for s, n in sorted(res["by_source"].items(), key=lambda kv: -kv[1]):
        src_chips += '<span class="chip">' + html.escape(s) + ' &middot; <b>' + str(n) + '</b></span>'
    src_html = src_chips or '<span class="mut">—</span>'

    sample_rows = ""
    for r in res["zero"][:8]:
        nm = html.escape(str(r["name"])).split(" ")
        redacted = nm[0] + (" " + nm[-1][0] + "." if len(nm) > 1 and nm[-1] else "")
        sample_rows += ('<tr><td>' + redacted + '</td><td>' + html.escape(str(r["source"])) +
                        '</td><td>' + html.escape(str(r["agent"])) + '</td><td class="mut">' +
                        html.escape(r["created"]) + '</td></tr>')
    if not sample_rows:
        sample_rows = '<tr><td colspan="4" class="mut">No zero-contact leads found in this window.</td></tr>'

    wasted_block = ""
    if cpl:
        wasted_block = ('<div class="sub">You paid roughly <b>' + money(bleed["wasted_spend"]) +
                        '</b> for the ' + str(n_zero + n_stuck) + ' leads that got no real work — at $' +
                        str(int(cpl)) + '/lead.</div>')

    head = ('<!doctype html><html><head><meta charset="utf-8">'
            '<title>TRU Accountability Audit — ' + team_esc + '</title>'
            '<style>' + AUDIT_CSS + '</style></head><body><div class="page">')

    annual_s, window_s, gci_s = money(bleed["annual_bleed"]), money(bleed["window_bleed"]), money(avg_gci)

    body = f"""
  <div class="brandbar">
    <div class="brand">T<span class="t">RU</span> &nbsp;<span class="brandtag">Accountability Audit</span></div>
    <div class="brandsub">Prepared by TRU<br>{now}</div>
  </div>

  <h1>{team_esc}</h1>
  <p class="lede">A read-only look at your last <b>{window_days} days</b> of paid leads
     (Zillow, Realtor.com, Homes.com, Facebook, Google &amp; referral networks) — and what the un-worked ones are quietly costing you.</p>

  <div class="stats">{stats}</div>

  <div class="bleed">
    <div class="big">{annual_s} / yr</div>
    <div class="cap">estimated GCI at risk from leads nobody personally worked
        ({window_s} in the last {window_days} days, annualized)</div>
    {wasted_block}
  </div>

  <h2>Where the leads came from</h2>
  <div>{src_html}</div>

  <h2>A sample of the un-worked leads</h2>
  <table>
    <tr><th>Lead</th><th>Source</th><th>Assigned agent</th><th>Created</th></tr>
    {sample_rows}
  </table>
  <p class="mut smallnote">Showing up to 8 of {n_zero}. Names are shortened here — the full worklist
     (with one-click "See in FUB") is inside TRU.</p>

  <div class="cta">
    <h3>This is one screenshot of what TRU watches every day.</h3>
    <p>TRU tells you <b>who</b> needs contact, hands your leader the <b>coaching move</b> for that specific agent,
       and makes it stick — in four minutes a week, not four hours. Want this live on your team?
       Reply to this email or book a 15-minute walkthrough.</p>
  </div>

  <div class="foot">
    <b>How these numbers work (nothing hidden):</b> A lead counts as <b>zero-contact</b> if it has no logged
    outbound call and fewer than two outgoing texts, and is not a Zillow live-connect. <b>Stuck</b> = still sitting
    in Lead / New Lead / Uncontacted status. Automated first-texts don't count as contact. <b>GCI at risk</b> =
    zero-contact leads × a {close_rate_pct}% close rate on properly-worked leads × {gci_s} average commission —
    a deliberately conservative estimate you can adjust. Pulled read-only from Follow Up Boss; no data is stored.
    Prepared by TRU.
  </div>
"""
    return head + body + "</div></body></html>"


# ─────────────────────────────────────────────────────────────── demo data
def demo_result():
    def L(name, src, agent, day):
        return {"id": 0, "name": name, "source": src, "agent": agent, "created": "2026-06-" + day}
    zero = [
        L("Marcus Delgado", "Zillow", "Trevor Holland", "18"),
        L("Priya Nair", "Realtor.com", "Trevor Holland", "19"),
        L("Sam Whitfield", "Homes.com", "Dana Cole", "20"),
        L("Angela Ruiz", "Facebook", "Dana Cole", "21"),
        L("Chris Okafor", "Zillow", "Trevor Holland", "22"),
        L("Nina Petrov", "Google", "Jordan Blake", "23"),
        L("Derek Yates", "Zillow", "Dana Cole", "24"),
        L("Lauren Kim", "Realtor.com", "Jordan Blake", "25"),
        L("Omar Haddad", "Homes.com", "Trevor Holland", "26"),
    ]
    stuck = [L("Ellie Vance", "Facebook", "Jordan Blake", "20"),
             L("Paul Nguyen", "Zillow", "Dana Cole", "21"),
             L("Rosa Iglesias", "Google", "Trevor Holland", "22")]
    return {"ok": True, "error": "", "total": 62, "zero": zero, "stuck": stuck, "worked": 50,
            "by_source": {"Zillow": 24, "Realtor.com": 16, "Homes.com": 8, "Facebook": 10, "Google": 4}}


# ─────────────────────────────────────────────────────────────── main
def main():
    ap = argparse.ArgumentParser(description="TRU Free Accountability Audit")
    ap.add_argument("--key", help="Follow Up Boss API key (one team)")
    ap.add_argument("--team", default="Your Team", help="Team / brokerage display name")
    ap.add_argument("--window", type=int, default=30, help="Lookback window in days")
    ap.add_argument("--gci", type=float, default=10000, help="Avg gross commission per closing")
    ap.add_argument("--close-rate", type=float, default=2.0, help="pct of worked leads that close")
    ap.add_argument("--cpl", type=float, default=0, help="Cost per paid lead (optional)")
    ap.add_argument("--out", help="Output .html path")
    ap.add_argument("--demo", action="store_true", help="Build from synthetic data (no network)")
    args = ap.parse_args()

    try:  # Windows consoles default to cp1252 and choke on → / — etc.
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    def log(m):
        try:
            print(m, flush=True)
        except UnicodeEncodeError:
            print(m.encode("ascii", "replace").decode("ascii"), flush=True)

    if args.demo:
        log("Building DEMO audit (synthetic data, no network)...")
        res = demo_result()
        team = args.team if args.team != "Your Team" else "Sample Team (Demo)"
    else:
        if not args.key:
            log("ERROR: provide --key <FUB_API_KEY>, or use --demo for a sample.")
            sys.exit(1)
        log("Pulling last " + str(args.window) + " days from Follow Up Boss (read-only)...")
        res = pull_and_classify(args.key, args.window, log)
        team = args.team
        if not res["ok"]:
            log("ERROR: " + res["error"])
            sys.exit(1)

    bleed = compute_bleed(res, args.gci, args.close_rate, args.cpl, args.window)
    doc = render_audit_html(team, res, bleed, args.window, args.gci, args.close_rate, args.cpl)

    out = args.out
    if not out:
        safe = re.sub(r"[^A-Za-z0-9]+", "_", team).strip("_") or "Team"
        for folder in [os.path.join(os.path.expanduser("~"), "OneDrive", "Desktop"),
                       os.path.join(os.path.expanduser("~"), "Desktop"),
                       os.getcwd()]:
            if os.path.isdir(folder):
                out = os.path.join(folder, "TRU_Audit_" + safe + ".html")
                break
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)

    log("")
    log("  Paid leads:            " + str(res["total"]))
    log("  Zero personal contact: " + str(len(res["zero"])))
    log("  Stuck in Lead status:  " + str(len(res["stuck"])))
    log("  Actually worked:       " + str(int(round(bleed["contact_rate"]))) + "%")
    log("  GCI at risk (annual):  " + money(bleed["annual_bleed"]))
    log("")
    log("Audit written to: " + out)
    log("Open it in a browser, then Print → Save as PDF to send.")


if __name__ == "__main__":
    main()
