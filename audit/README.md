# TRU — Free Accountability Audit

The top-of-funnel lead magnet for the TRU suite. Point it at **one** Follow Up Boss
API key and it produces a branded, printable one-page audit: how many paid leads
came in, how many got **zero personal contact**, how many are **stuck in Lead
status**, and a conservative, fully-disclosed estimate of the **GCI at risk**.

The flag math is identical to the daily puller (`~/fub_tool.pyw`) and the dashboard
(`worker/src/flags.ts`), plus a Zillow-Connected exemption so it never over-counts.
Single file, standard-library only, no install.

## Run it

Windows uses the `py` launcher (plain `python` may be the Store stub):

```powershell
# See a sample with no network / no key:
py accountability_audit.py --demo

# Live audit against a real team (read-only pulls, nothing is stored):
py accountability_audit.py --key <FUB_API_KEY> --team "Prospect Team Name"
```

Output: an `.html` file on your Desktop. Open it in a browser, then **Print → Save
as PDF** to send to the prospect.

## Knobs (all disclosed on the report)

| Flag | Default | Meaning |
|---|---|---|
| `--window` | 30 | Lookback in days |
| `--gci` | 10000 | Avg gross commission per closing |
| `--close-rate` | 2.0 | % of properly-worked leads that close |
| `--cpl` | (off) | Cost per paid lead → adds a "wasted ad spend" line |
| `--team` | "Your Team" | Display name on the report |
| `--out` | Desktop | Output path |

## How the numbers are defined

- **Zero-contact** = no logged outbound call AND fewer than two outgoing texts AND
  not a Zillow live-connect (the automated first-text does not count).
- **Stuck** = still in Lead / New Lead / Uncontacted status.
- **GCI at risk** = zero-contact leads × close-rate × avg commission, then annualized
  from the window. Deliberately conservative; every assumption is printed on the page.

Paid sources tracked: Zillow, Realtor.com (incl. MVIP), Homes.com, Facebook, Google, and
pay-at-close referral networks (Redfin, HomeLight, Rocket Homes, UpNest, ReferralExchange,
FastExpert) — matched by family so naming variants (e.g. "Zillow Premier Agent", "FB Ads")
still land. Pay-at-close leads count fully: an un-worked one is still lost GCI and a risk to
your referral-program standing.
