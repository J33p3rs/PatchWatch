# Patch Watch

A lightweight visualisation of vendor and platform vulnerability disclosure volume over time.

Patch Watch currently includes:

- **All** — a derived sum of every tracked headline series over their common monthly coverage;
- **Microsoft Patch Tuesday** — new Microsoft CVEs counted at release time;
- **Fortinet** — Fortinet-assigned CNA CVEs published by calendar month, including regular and out-of-cycle disclosures;
- **iOS** — unique CVEs documented across Apple iOS security advisories released in each calendar month; and
- **macOS** — unique CVEs documented across Apple macOS security advisories released in each calendar month.

For iOS and macOS, CVEs repeated across multiple supported release branches in the same platform/month are counted once within that platform. iOS and macOS remain separate series, so a CVE affecting both platforms can contribute to both headline totals and therefore to the All view.

The site keeps each vendor/platform metric explicit rather than treating unlike release processes as directly equivalent. The All total is an operational comparison measure, not a globally deduplicated vulnerability count.
