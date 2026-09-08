#!/usr/bin/env python3
"""Fail closed if PatchWatch's exact pinned GitHub Actions have High/Critical advisories."""

from __future__ import annotations

import json
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
    """Return decoded YAML `uses` mapping keys using Ruby's standard Psych parser.

    Structural parsing is the trust boundary. Source-line regexes below are used
    only to enforce the deliberately narrow, rewriteable simple block syntax.
    """
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
            f"Pinned action {repository}@{sha} does not map to an exact X.Y.Z release tag; refusing an unverifiable dependency version"
        )
    candidates.sort(reverse=True)
    return candidates[0][3]


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
        actions = discover_actions(Path(sys.argv[1]))
        blockers: list[tuple[str, str, str, str]] = []
        for repository, sha in sorted(actions.items()):
            version = exact_release_version(repository, sha)
            print(f"Verified pinned action release: {repository}@{sha} -> {version}")
            for severity in ("critical", "high"):
                for advisory in advisories(repository, version, severity):
                    blockers.append((repository, version, severity, str(advisory.get("ghsa_id", "unknown-advisory"))))
        if blockers:
            print("High/Critical GitHub Action advisories block PatchWatch publication:", file=sys.stderr)
            for repository, version, severity, ghsa in blockers:
                print(f"- {repository}@{version}: {severity} {ghsa}", file=sys.stderr)
            return 1
        print(f"No High/Critical GitHub-reviewed advisories affect {len(actions)} exact pinned action release(s).")
        return 0
    except Exception as exc:
        print(f"Exact GitHub Action advisory check failed closed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
