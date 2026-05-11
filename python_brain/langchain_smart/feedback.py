"""Quantitative feedback scoring for smart brain decisions."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from ..models import BrainRequest


SAFETY_TASKS = {"escape_hazard", "escape_pit", "descend_from_platform", "eat_food", "recover_starvation", "evade_hostiles", "defend_shelter", "defend_self", "hold_position"}
RECOVERY_FALLBACKS = {"explore", "hunt_food"}


def _blocked_tasks(request: BrainRequest) -> dict[str, dict[str, Any]]:
    blocked: dict[str, dict[str, Any]] = {}
    for item in request.taskFeedback.blockedTasks or []:
        if not isinstance(item, dict):
            continue
        task_type = item.get("taskType") or item.get("type")
        if task_type:
            blocked[str(task_type)] = item
    return blocked


def _recent_failure_counts(request: BrainRequest) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in request.taskFeedback.recentFailures or []:
        if not isinstance(item, dict):
            continue
        task_type = item.get("taskType") or item.get("type") or item.get("target")
        if task_type:
            counts[str(task_type)] = counts.get(str(task_type), 0) + 1
    return counts


@dataclass
class DecisionScore:
    task_type: str
    score: float
    blocked: bool = False
    repeatedFailures: int = 0
    reason: str = ""


@dataclass
class DecisionFeedbackTracker:
    history_limit: int = 24
    history: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=24))

    def score_task(self, task_type: str, request: BrainRequest) -> DecisionScore:
        blocked = _blocked_tasks(request)
        failures = _recent_failure_counts(request)
        rule_task = request.ruleDecision.type if request.ruleDecision else None
        score = 1.0
        reasons: list[str] = []

        if task_type in blocked:
            score -= 0.75
            reasons.append("blocked")
        if rule_task and task_type == rule_task:
            score += 0.18
            reasons.append("rule_match")
        if rule_task in blocked and task_type in set(blocked[rule_task].get("recoveryTasks") or []) | RECOVERY_FALLBACKS:
            score += 0.35
            reasons.append("blocked_rule_recovery")
        if request.snapshot.environmentHazard or request.snapshot.navigationTrap or request.snapshot.isInLava or request.snapshot.oxygen_low:
            score += 0.3 if task_type in SAFETY_TASKS else -0.45
            reasons.append("safety_window")
        if request.snapshot.food_low and task_type in {"eat_food", "recover_starvation", "hunt_food", "explore"}:
            score += 0.22
            reasons.append("food_pressure")

        repeated = failures.get(task_type, 0)
        if repeated:
            score -= min(0.45, repeated * 0.15)
            reasons.append(f"recent_failures:{repeated}")

        return DecisionScore(
            task_type=task_type,
            score=max(0.0, min(1.0, score)),
            blocked=task_type in blocked,
            repeatedFailures=repeated,
            reason=",".join(reasons) or "neutral",
        )

    def metrics(self, request: BrainRequest, candidates: list[str], accepted: list[str], rejected: list[dict[str, Any]], judge_score: float | None = None) -> dict[str, Any]:
        scored = [self.score_task(task_type, request) for task_type in candidates]
        accepted_scores = [self.score_task(task_type, request).score for task_type in dict.fromkeys(accepted)]
        final_score = sum(accepted_scores) / max(1, len(accepted_scores))
        if judge_score is not None:
            final_score = (final_score * 0.65) + (judge_score * 0.35)
        payload = {
            "candidateCount": len(candidates),
            "acceptedCount": len(accepted),
            "rejectedCount": len(rejected),
            "blockedRejectedCount": sum(1 for item in rejected if item.get("reason") == "blocked_task"),
            "duplicateRejectedCount": sum(1 for item in rejected if item.get("reason") == "duplicate_task"),
            "invalidRejectedCount": sum(1 for item in rejected if item.get("reason") == "invalid_task"),
            "judgeScore": judge_score,
            "finalScore": round(final_score, 3),
            "taskScores": [item.__dict__ for item in scored[:8]],
        }
        self.history.append(payload)
        return payload