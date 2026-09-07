#!/usr/bin/env python3
"""Evaluate exact-SHA Codex review evidence for PatchWatch controller PRs."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

CODEX_LOGINS = {"chatgpt-codex-connector[bot]", "chatgpt-codex-connector"}
BLOCKER_RE = re.compile(r"\bP([012])\b", re.IGNORECASE)
CLEAN_RE = re.compile(r"Codex Review: Didn't find any major issues", re.IGNORECASE)
REVIEWED_RE = re.compile(r"Reviewed commit:\*\*\s*`?([0-9a-f]{10,40})`?", re.IGNORECASE)


def load(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def author_login(node: dict) -> str:
    user = node.get("user") or node.get("author") or {}
    return str(user.get("login") or "")


def exact_marker(body: str, sha: str) -> bool:
    for match in REVIEWED_RE.finditer(body or ""):
        marker = match.group(1).lower()
        if sha.lower().startswith(marker):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--reviews", required=True)
    parser.add_argument("--threads", required=True)
    parser.add_argument("--comments", required=True)
    args = parser.parse_args()

    sha = args.sha.lower()
    reviews = load(args.reviews)
    threads = load(args.threads)
    comments = load(args.comments)

    exact_evidence = False
    blockers: list[str] = []

    for review in reviews:
        if author_login(review) not in CODEX_LOGINS:
            continue
        if str(review.get("state", "")).upper() == "DISMISSED":
            continue
        commit_id = str(review.get("commit_id") or "").lower()
        body = str(review.get("body") or "")
        if commit_id == sha or exact_marker(body, sha):
            exact_evidence = True

    for comment in comments:
        if author_login(comment) not in CODEX_LOGINS:
            continue
        body = str(comment.get("body") or "")
        if exact_marker(body, sha):
            exact_evidence = True
            if CLEAN_RE.search(body):
                exact_evidence = True

    thread_nodes = (
        threads.get("data", {})
        .get("repository", {})
        .get("pullRequest", {})
        .get("reviewThreads", {})
        .get("nodes", [])
    )
    for thread in thread_nodes:
        if thread.get("isResolved") or thread.get("isOutdated"):
            continue
        for comment in (thread.get("comments") or {}).get("nodes", []):
            if author_login(comment) not in CODEX_LOGINS:
                continue
            body = str(comment.get("body") or "")
            if BLOCKER_RE.search(body):
                blockers.append(body.splitlines()[0][:200])

    state = "blocked" if blockers else ("clean" if exact_evidence else "pending")
    print(json.dumps({"state": state, "blockers": blockers}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
