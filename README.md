# Patch Watch

A lightweight visualisation of vendor/platform vulnerability disclosure volume plus separate global NVD and CISA KEV views.

Patch Watch currently includes a vendor/platform dashboard with:

- **All** — a derived sum of every tracked vendor/platform headline series over their common monthly coverage;
- **Microsoft Patch Tuesday** — new Microsoft CVEs counted at release time;
- **Fortinet** — Fortinet-assigned CNA CVEs published by calendar month, including regular and out-of-cycle disclosures;
- **iOS** — unique CVEs documented across Apple iOS security advisories released in each calendar month;
- **macOS** — unique CVEs documented across Apple macOS security advisories released in each calendar month;
- **Chrome** — unique public Chrome CNA CVEs attributed to their first referenced Google Chrome Desktop Stable release month; and
- **Firefox** — unique CVEs documented across Mozilla Firefox desktop and Firefox ESR security advisories announced in each calendar month.

Horizontally scrollable charts open at their **most recent/right-most data** on first render while retaining normal scrolling back through older history.

Patch Watch also includes two separate global views:

- **NVD global** — non-rejected CVEs published into the National Vulnerability Database per calendar month; and
- **CISA KEV** — CVEs added to CISA's Known Exploited Vulnerabilities catalogue per calendar month, grouped by `dateAdded`.

Both global pages include a vendor comparison line graph using 12-month rolling averages indexed to 100. This compares relative direction and growth rather than plotting misleading raw-count dual axes between different metrics and scales.

The KEV comparison begins with the rolling window ending November 2022 so CISA's one-off November 2021 initial catalogue seed does not distort the comparison baseline.

NVD and KEV are intentionally **excluded from All** because they are ecosystem-wide/global datasets containing CVEs already represented in the vendor/platform feeds. Adding either to All would double-count extensively and mix different measurement semantics.

For iOS and macOS, CVEs repeated across multiple supported release branches in the same platform/month are counted once within that platform. iOS and macOS remain separate series, so a CVE affecting both platforms can contribute to both headline totals and therefore to the All view.

Chrome release chronology is derived from the original Google Chrome Releases references retained in CVE List v5 rather than historical CVE publication timestamps, which do not reliably preserve older release timing.

Firefox uses Mozilla's own MFSA announcement chronology. CVEs repeated across normal Firefox and supported Firefox ESR advisories in the same month are counted once within the Firefox series; Firefox-for-iOS-only and Firefox-for-Android-only advisories are excluded.

The site keeps unlike metrics explicit rather than treating different patch, disclosure and global-index processes as directly equivalent. The All total is an operational vendor/platform comparison measure, not a globally deduplicated vulnerability count.
