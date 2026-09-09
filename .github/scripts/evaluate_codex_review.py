#!/usr/bin/env python3
"""Normalise Codex PR review evidence for advisory PatchWatch review."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

CODEX_LOGINS = {"chatgpt-codex-connector", "chatgpt-codex-connector[bot]"}
BLOCKER_MARKERS = (
    "![P0 Badge]", "![P1 Badge]", "![P2 Badge]",
    "P0 Badge", "P1 Badge", "P2 Badge",
)
CLEAN_PREFIX = "Codex Review: Didn't find any major issues."
DISMISSED_STATES = {"DISMISSED", "dismissed"}
AUTO_REVIEW_MARKER = "PatchWatch-Auto-Review:"


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
    """Return active P0/P1/P2 Codex findings as advisory metadata."""
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


def _exact_review_body(body: str, sha: str) -> bool:
    return "**Reviewed commit:**" in body and (f"`{sha}`" in body or f"`{sha[:10]}`" in body)


def _event_time(item: dict, *keys: str) -> datetime | None:
    for key in keys:
        raw = item.get(key)
        if not raw:
            continue
        try:
            return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def latest_exact_codex_verdict_is_clean(reviews: object, comments: object, sha: str) -> bool:
    """Report whether the latest exact-SHA Codex verdict is affirmative clean evidence.

    This is informational only. PatchWatch security/tests and deterministic trust controls
    are the hard gates; Codex findings are carried forward as advisory remediation work.
    """
    events: list[tuple[datetime | None, bool]] = []

    if isinstance(reviews, list):
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
            exact = commit_id == sha or _exact_review_body(body, sha)
            if not exact:
                continue
            clean = _affirmative_clean_body(body, sha) and (not commit_id or commit_id == sha)
            events.append((_event_time(review, "submitted_at", "submittedAt", "created_at", "createdAt"), clean))

    if isinstance(comments, list):
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            author = comment.get("user") or comment.get("author")
            if not _codex(_login(author)):
                continue
            body = str(comment.get("body") or "")
            if not _affirmative_clean_body(body, sha):
                continue
            events.append((_event_time(comment, "created_at", "createdAt", "updated_at", "updatedAt"), True))

    if not events:
        return False
    if len(events) == 1:
        return events[0][1]
    if any(timestamp is None for timestamp, _ in events):
        return False
    latest_time = max(timestamp for timestamp, _ in events)
    latest_verdicts = {clean for timestamp, clean in events if timestamp == latest_time}
    if len(latest_verdicts) != 1:
        return False
    return latest_verdicts.pop()


def review_requested(comments: object, sha: str) -> bool:
    marker = f"{AUTO_REVIEW_MARKER}{sha}"
    if not isinstance(comments, list):
        return False
    return any(isinstance(comment, dict) and marker in str(comment.get("body") or "") for comment in comments)


def exact_codex_review_seen(reviews: object, comments: object, sha: str) -> bool:
    if isinstance(reviews, list):
        for review in reviews:
            if not isinstance(review, dict):
                continue
            author = review.get("user") or review.get("author")
            if not _codex(_login(author)) or str(review.get("state") or "") in DISMISSED_STATES:
                continue
            body = str(review.get("body") or "")
            commit_id = str(review.get("commit_id") or review.get("commitId") or "")
            if commit_id == sha or _exact_review_body(body, sha):
                return True
    if isinstance(comments, list):
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            author = comment.get("user") or comment.get("author")
            if _codex(_login(author)) and _exact_review_body(str(comment.get("body") or ""), sha):
                return True
    return False


def evaluate(reviews: object, threads: object, comments: object, sha: str) -> dict:
    blockers = active_blockers(threads)
    evidence = latest_exact_codex_verdict_is_clean(reviews, comments, sha)
    requested = review_requested(comments, sha)
    received = exact_codex_review_seen(reviews, comments, sha)
    # First encounter remains pending only long enough for the reconciler to request Codex.
    # Once review has been requested or received, Codex is advisory and cannot block merge/release.
    state = "clean" if requested or received else "pending"
    return {
        "state": state,
        "policy": "advisory",
        "review_requested": requested,
        "review_received": received,
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
