#!/usr/bin/env python3
"""Normalise Codex PR review evidence into clean/pending/blocked state."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

CODEX_LOGINS = {"chatgpt-codex-connector", "chatgpt-codex-connector[bot]"}
BLOCKER_MARKERS = (
    "![P0 Badge]", "![P1 Badge]", "![P2 Badge]",
    "P0 Badge", "P1 Badge", "P2 Badge",
)
CLEAN_PREFIX = "Codex Review: Didn't find any major issues."
DISMISSED_STATES = {"DISMISSED", "dismissed"}


def _login(value: dict | None) -> str:
    if not value:
        return ""
    return str(value.get("login") or "")


def _codex(login: str) -> bool:
    return login in CODEX_LOGINS


def _thread_nodes(payload: object) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    node = payload
    for key in ("data", "repository", "pullRequest", "reviewThreads"):
        if isinstance(node, dict) and key in node:
            node = node[key]
        else:
            break
    if isinstance(node, dict):
        node = node.get("nodes", [])
    return [item for item in node if isinstance(item, dict)] if isinstance(node, list) else []


def active_blockers(threads: object) -> list[str]:
    blockers: list[str] = []
    for thread in _thread_nodes(threads):
        if thread.get("isResolved") or thread.get("is_resolved"):
            continue
        if thread.get("isOutdated") or thread.get("is_outdated"):
            continue
        comments = thread.get("comments", [])
        if isinstance(comments, dict):
            comments = comments.get("nodes", [])
        if not isinstance(comments, list):
            continue
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            author = comment.get("author") or comment.get("user")
            if not _codex(_login(author)):
                continue
            body = str(comment.get("body") or "")
            if any(marker in body for marker in BLOCKER_MARKERS):
                blockers.append(body)
                break
    return blockers


def _affirmative_clean_body(body: str, sha: str) -> bool:
    if not body.startswith(CLEAN_PREFIX) or "**Reviewed commit:**" not in body:
        return False
    return f"`{sha}`" in body or f"`{sha[:10]}`" in body


def has_clean_review(reviews: object, sha: str) -> bool:
    """Accept a review only when Codex explicitly reports a clean exact commit."""
    if not isinstance(reviews, list):
        return False
    for review in reviews:
        if not isinstance(review, dict):
            continue
        author = review.get("user") or review.get("author")
        if not _codex(_login(author)):
            continue
        if str(review.get("state") or "") in DISMISSED_STATES:
            continue
        body = str(review.get("body") or "")
        commit_id = str(review.get("commit_id") or review.get("commitId") or "")
        if not _affirmative_clean_body(body, sha):
            continue
        if commit_id and commit_id != sha:
            continue
        return True
    return False


def has_clean_comment(comments: object, sha: str) -> bool:
    if not isinstance(comments, list):
        return False
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        author = comment.get("user") or comment.get("author")
        if not _codex(_login(author)):
            continue
        body = str(comment.get("body") or "")
        if _affirmative_clean_body(body, sha):
            return True
    return False


def evaluate(reviews: object, threads: object, comments: object, sha: str) -> dict:
    blockers = active_blockers(threads)
    evidence = has_clean_review(reviews, sha) or has_clean_comment(comments, sha)
    if blockers:
        state = "blocked"
    elif evidence:
        state = "clean"
    else:
        state = "pending"
    return {
        "state": state,
        "exact_evidence": evidence,
        "active_blocker_count": len(blockers),
    }


def load(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--reviews", type=Path, required=True)
    parser.add_argument("--threads", type=Path, required=True)
    parser.add_argument("--comments", type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(load(args.reviews), load(args.threads), load(args.comments), args.sha)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
