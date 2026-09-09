#!/usr/bin/env python3
"""Fail closed if PatchWatch's exact pinned GitHub Actions have High/Critical advisories."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

USES_KEY_RE = re.compile(r"^(?:-\s*)?(?:uses|['\"]uses['\"])\s*:\s*")
USES_RE = re.compile(r"^\s*(?:-\s*)?(?:uses|['\"]uses['\"])\s*:\s*([^\s@#]+)@([0-9A-Fa-f]{40})(?:\s*(?:#.*)?)$")
LOCAL_USES_RE = re.compile(r"^(?:-\s*)?(?:uses|['\"]uses['\"])\s*:\s*\./")
DOCKER_USES_RE = re.compile(r"^(?:-\s*)?(?:uses|['\"]uses['\"])\s*:\s*docker://")
SEMVER_TAG_RE = re.compile(r"^v?(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)$")

RUBY_YAML_USES = r'''
require "json"
require "psych"

found = []
walk = lambda do |node|
  case node
  when Psych::Nodes::Mapping
    children = node.children
    (0...children.length).step(2) do |index|
      key = children[index]
      value = children[index + 1]
      if key.is_a?(Psych::Nodes::Scalar) && key.value == "uses"
        unless value.is_a?(Psych::Nodes::Scalar)
          raise "uses value must be a scalar"
        end
        found << {"line" => key.start_line + 1, "value" => value.value}
      end
      walk.call(key)
      walk.call(value)
    end
  when Psych::Nodes::Sequence, Psych::Nodes::Document, Psych::Nodes::Stream
    node.children.each { |child| walk.call(child) }
  end
end

stream = Psych.parse_stream(File.read(ARGV.fetch(0)))
walk.call(stream)
puts JSON.generate(found)
'''


def structural_uses(path: Path) -> list[dict[str, object]]:
    """Return decoded YAML `uses` mapping keys using Ruby's standard Psych parser."""
    try:
        result = subprocess.run(
            ["ruby", "-e", RUBY_YAML_USES, str(path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Ruby/Psych YAML parser is unavailable") from exc
    except subprocess.SubprocessError as exc:
        raise RuntimeError(f"YAML structural parse failed for {path}: {exc}") from exc
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"YAML structural parser returned invalid JSON for {path}") from exc
    if not isinstance(payload, list):
        raise RuntimeError(f"YAML structural parser returned an unexpected result for {path}")
    return payload


def api_json(path: str, params: dict[str, str] | None = None) -> object:
    command = ["gh", "api", "--method", "GET", path]
    for key, value in sorted((params or {}).items()):
        command.extend(["-f", f"{key}={value}"])
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=45)
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"GitHub API request failed for fixed API path {path}: {exc}") from exc


def require_current_public_main() -> None:
    """Reject a queued installed-controller run whose executing SHA is no longer public main.

    Installed public workflow preflights opt into this guard with dedicated identity
    variables supplied by the built-in github.token context. Candidate/offline scans
    and unrelated workflow bookkeeping variables are deliberately unaffected.
    """
    repository = os.environ.get("PATCHWATCH_INSTALLED_REPO", "")
    executing_sha = os.environ.get("PATCHWATCH_INSTALLED_EXECUTING_SHA", "")
    if not repository and not executing_sha:
        return
    if not repository or not executing_sha:
        raise RuntimeError("Incomplete installed-controller execution identity")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError("Invalid installed-controller repository identity")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", executing_sha):
        raise RuntimeError("Invalid installed-controller executing SHA")
    payload = api_json(f"/repos/{repository}/commits/main")
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected public main response during installed-controller preflight")
    installed_main_sha = str(payload.get("sha", ""))
    if installed_main_sha.lower() != executing_sha.lower():
        raise RuntimeError(
            f"Stale queued PatchWatch controller run: executing {executing_sha} but current public main is {installed_main_sha or 'unknown'}"
        )


def all_tags(repository: str) -> list[dict]:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise RuntimeError(f"Invalid GitHub Action repository coordinate: {repository}")
    tags: list[dict] = []
    page = 1
    while True:
        payload = api_json(f"/repos/{repository}/tags", {"per_page": "100", "page": str(page)})
        if not isinstance(payload, list):
            raise RuntimeError(f"Unexpected tags response for {repository}")
        tags.extend(payload)
        if len(payload) < 100:
            return tags
        page += 1
        if page > 100:
            raise RuntimeError(f"Refusing excessive tag pagination for {repository}")


def exact_release_versions(repository: str, sha: str) -> list[str]:
    """Return every unique exact X.Y.Z tag attached to the pinned commit."""
    candidates: set[tuple[int, int, int, str]] = set()
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
        candidates.add((major, minor, patch, f"{major}.{minor}.{patch}"))
    if not candidates:
        raise RuntimeError(
            f"Pinned action {repository}@{sha} does not map to an exact X.Y.Z release tag; refusing an unverifiable dependency version"
        )
    return [item[3] for item in sorted(candidates, reverse=True)]


def advisories(repository: str, version: str, severity: str) -> list[dict]:
    payload = api_json(
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


def workflow_directory(source_root: Path) -> Path:
    normal = source_root / ".github" / "workflows"
    canonical = source_root / "workflows"
    if normal.is_dir():
        return normal
    if canonical.is_dir():
        return canonical
    raise RuntimeError(f"Missing workflow directory below: {source_root}")


def discover_actions(source_root: Path) -> dict[str, str]:
    workflows = workflow_directory(source_root)
    actions: dict[str, str] = {}
    for path in sorted([*workflows.glob("*.yml"), *workflows.glob("*.yaml")]):
        lines = path.read_text(encoding="utf-8").splitlines()
        for item in structural_uses(path):
            lineno = item.get("line")
            value = item.get("value")
            if not isinstance(lineno, int) or lineno < 1 or lineno > len(lines) or not isinstance(value, str):
                raise RuntimeError(f"Invalid structural uses result for {path}")
            line = lines[lineno - 1]
            stripped = line.strip()
            if not USES_KEY_RE.match(stripped):
                raise RuntimeError(
                    f"Unsupported YAML uses mapping syntax; only simple block-style uses entries are allowed: "
                    f"{path}:{lineno}: {stripped}"
                )
            if LOCAL_USES_RE.match(stripped):
                raise RuntimeError(
                    f"Local composite action reference requires explicit recursive scanner support: {path}:{lineno}: {stripped}"
                )
            if DOCKER_USES_RE.match(stripped):
                raise RuntimeError(f"Docker action reference requires explicit scanner support: {path}:{lineno}")
            match = USES_RE.fullmatch(line)
            if not match:
                raise RuntimeError(f"External GitHub Action is not pinned to a 40-character SHA: {path}:{lineno}: {stripped}")
            coordinate, sha = match.groups()
            if value != f"{coordinate}@{sha}":
                raise RuntimeError(f"Structural/source Action reference mismatch at {path}:{lineno}")
            parts = coordinate.split("/")
            if len(parts) < 2:
                raise RuntimeError(f"Invalid action coordinate at {path}:{lineno}: {coordinate}")
            repository = "/".join(parts[:2])
            prior = actions.get(repository)
            if prior and prior.lower() != sha.lower():
                raise RuntimeError(f"Action repository {repository} is pinned to multiple SHAs in the candidate")
            actions[repository] = sha.lower()
    if not actions:
        raise RuntimeError(f"No external GitHub Actions found under {workflows}")
    return actions


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-patchwatch-action-advisories.py SOURCE_ROOT", file=sys.stderr)
        return 2

    try:
        require_current_public_main()
        actions = discover_actions(Path(sys.argv[1]))
        blockers: set[tuple[str, str, str, str]] = set()
        checked_versions = 0
        for repository, sha in sorted(actions.items()):
            versions = exact_release_versions(repository, sha)
            checked_versions += len(versions)
            print(f"Verified pinned action release aliases: {repository}@{sha} -> {', '.join(versions)}")
            for version in versions:
                for severity in ("critical", "high"):
                    for advisory in advisories(repository, version, severity):
                        blockers.add((repository, version, severity, str(advisory.get("ghsa_id", "unknown-advisory"))))
        if blockers:
            print("High/Critical GitHub Action advisories block PatchWatch publication:", file=sys.stderr)
            for repository, version, severity, ghsa in sorted(blockers):
                print(f"- {repository}@{version}: {severity} {ghsa}", file=sys.stderr)
            return 1
        print(
            f"No High/Critical GitHub-reviewed advisories affect {len(actions)} exact pinned action repository/repositories "
            f"across {checked_versions} exact release alias(es)."
        )
        return 0
    except Exception as exc:
        print(f"Exact GitHub Action advisory check failed closed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
