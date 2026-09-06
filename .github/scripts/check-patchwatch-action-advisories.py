#!/usr/bin/env python3
"""Fail closed if PatchWatch's exact pinned GitHub Actions have High/Critical advisories."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.github.com"
TOKEN = os.environ.get("GH_TOKEN", "")
USES_RE = re.compile(
    r"^\s*(?:-\s*)?uses:\s*([^\s@#]+)@([0-9A-Fa-f]{40})(?:\s*(?:#.*)?)$"
)
SEMVER_TAG_RE = re.compile(
    r"^v?(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$"
)


def api_json(path: str, params: dict[str, str] | None = None) -> tuple[object, dict[str, str]]:
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
            "User-Agent": "PatchWatch-dependency-gate",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            headers = {key.lower(): value for key, value in response.headers.items()}
            return json.load(response), headers
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"GitHub API request failed for {url}: {exc}") from exc


def all_tags(repository: str) -> list[dict]:
    tags: list[dict] = []
    page = 1
    while True:
        payload, _ = api_json(f"/repos/{repository}/tags", {"per_page": "100", "page": str(page)})
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected tags response for {repository}")
        tags.extend(payload)
        if len(payload) < 100:
            return tags
        page += 1
        if page > 100:
            raise RuntimeError(f"Refusing excessive tag pagination for {repository}")


def exact_release_version(repository: str, sha: str) -> str:
    candidates: list[tuple[int, int, int, str]] = []
    for tag in all_tags(repository):
        commit = tag.get("commit") or {}
        if str(commit.get("sha", "")).lower() != sha.lower():
            continue
        name = str(tag.get("name", ""))
        match = SEMVER_TAG_RE.fullmatch(name)
        if not match:
            continue
        major = int(match.group("major"))
        minor = int(match.group("minor"))
        patch = int(match.group("patch"))
        candidates.append((major, minor, patch, f"{major}.{minor}.{patch}"))
    if not candidates:
        raise RuntimeError(
            f"Pinned action {repository}@{sha} does not map to an exact X.Y.Z release tag; "
            "refusing an unverifiable dependency version"
        )
    candidates.sort(reverse=True)
    return candidates[0][3]


def advisories(repository: str, version: str, severity: str) -> list[dict]:
    payload, _ = api_json(
        "/advisories",
        {
            "ecosystem": "actions",
            "type": "reviewed",
            "severity": severity,
            "affects": f"{repository}@{version}",
            "per_page": "100",
        },
    )
    if not isinstance(payload, list):
        raise RuntimeError(f"Unexpected advisory response for {repository}@{version}")
    return [item for item in payload if item.get("withdrawn_at") is None]


def discover_actions(source_root: Path) -> dict[str, str]:
    workflows = source_root / ".github" / "workflows"
    if not workflows.is_dir():
        raise RuntimeError(f"Missing workflow directory: {workflows}")

    actions: dict[str, str] = {}
    for path in sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")]):
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if "uses:" not in stripped:
                continue
            if re.match(r"^(?:-\s*)?uses:\s*\./", stripped):
                continue
            if re.match(r"^(?:-\s*)?uses:\s*docker://", stripped):
                raise RuntimeError(f"Docker action reference requires explicit scanner support: {path}:{lineno}")
            match = USES_RE.fullmatch(line)
            if not match:
                raise RuntimeError(
                    f"External GitHub Action is not pinned to a 40-character SHA: {path}:{lineno}: {stripped}"
                )
            coordinate, sha = match.groups()
            parts = coordinate.split("/")
            if len(parts) < 2:
                raise RuntimeError(f"Invalid action coordinate at {path}:{lineno}: {coordinate}")
            repository = "/".join(parts[:2])
            prior = actions.get(repository)
            if prior and prior.lower() != sha.lower():
                raise RuntimeError(
                    f"Action repository {repository} is pinned to multiple SHAs in the candidate; "
                    "refusing ambiguous version assessment"
                )
            actions[repository] = sha.lower()
    if not actions:
        raise RuntimeError("No external GitHub Actions found in PatchWatch source workflows")
    return actions


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-patchwatch-action-advisories.py SOURCE_ROOT", file=sys.stderr)
        return 2

    try:
        actions = discover_actions(Path(sys.argv[1]))
        blockers: list[tuple[str, str, str, str]] = []
        for repository, sha in sorted(actions.items()):
            version = exact_release_version(repository, sha)
            print(f"Verified pinned action release: {repository}@{sha} -> {version}")
            for severity in ("critical", "high"):
                for advisory in advisories(repository, version, severity):
                    blockers.append(
                        (
                            repository,
                            version,
                            severity,
                            str(advisory.get("ghsa_id", "unknown-advisory")),
                        )
                    )
        if blockers:
            print("High/Critical GitHub Action advisories block PatchWatch publication:", file=sys.stderr)
            for repository, version, severity, ghsa in blockers:
                print(f"- {repository}@{version}: {severity} {ghsa}", file=sys.stderr)
            return 1
        print(f"No High/Critical GitHub-reviewed advisories affect {len(actions)} exact pinned action release(s).")
        return 0
    except Exception as exc:  # fail closed on parsing/API/version-resolution uncertainty
        print(f"Exact GitHub Action advisory check failed closed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
