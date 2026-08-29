# Patch Watch

A lightweight visualisation of vendor/platform vulnerability disclosure volume plus a separate global NVD view.

Patch Watch currently includes a vendor/platform dashboard with:

- **All** — a derived sum of every tracked vendor/platform headline series over their common monthly coverage;
- **Microsoft Patch Tuesday** — new Microsoft CVEs counted at release time;
- **Fortinet** — Fortinet-assigned CNA CVEs published by calendar month, including regular and out-of-cycle disclosures;
- **iOS** — unique CVEs documented across Apple iOS security advisories released in each calendar month;
- **macOS** — unique CVEs documented across Apple macOS security advisories released in each calendar month; and
- **Chrome** — unique public Chrome CNA CVEs attributed to their first referenced Google Chrome Desktop Stable release month.

Patch Watch also includes a separate **NVD global** page showing non-rejected CVEs published into the National Vulnerability Database per calendar month.

NVD is intentionally **excluded from All** because it is an ecosystem-wide index containing CVEs already represented in the vendor/platform feeds. Adding it to All would double-count extensively.

For iOS and macOS, CVEs repeated across multiple supported release branches in the same platform/month are counted once within that platform. iOS and macOS remain separate series, so a CVE affecting both platforms can contribute to both headline totals and therefore to the All view.

Chrome release chronology is derived from the original Google Chrome Releases references retained in CVE List v5 rather than historical CVE publication timestamps, which do not reliably preserve older release timing.

The site keeps unlike metrics explicit rather than treating different patch, disclosure and global-index processes as directly equivalent. The All total is an operational vendor/platform comparison measure, not a globally deduplicated vulnerability count.
