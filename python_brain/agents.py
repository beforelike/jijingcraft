"""Concurrent agent coroutines for Python Smart Brain."""

from __future__ import annotations

import json
import time
from typing import Any

from .config import BrainConfig
from .llm_client import LLMClient
from .models import AgentProposal, BehaviorTreeRequest, BrainRequest
from .task_catalog import AGENT_SPECS, AgentSpec, allowed_tasks, normalize_task_type


def _truncate_json(value: Any, max_chars: int) -> str:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)
    return text if len(text) <= max_chars else f"{text[:max_chars]}..."


def _compact_context(request: BrainRequest, cfg: BrainConfig) -> str:
    context = request.plannerContext or {}
    if not context:
        context = {
            "bot": request.snapshot.model_dump(),
            "ruleDecision": request.ruleDecision.model_dump() if request.ruleDecision else None,
            "progress": request.progress,
            "taskFeedback": request.taskFeedback.model_dump(),
        }
    return _truncate_json(context, cfg.max_context_chars)


def _activation_reason(spec: AgentSpec, request: BrainRequest) -> str | None:
    rule_type = request.ruleDecision.type if request.ruleDecision else None
    snapshot = request.snapshot
    if rule_type in spec.tasks:
        return f"rule_decision:{rule_type}"
    if spec.agent_id == "safety_agent":
        terrain = (request.plannerContext or {}).get("world", {}).get("terrain", {})
        if isinstance(terrain, dict) and isinstance(terrain.get("descent"), dict) and terrain["descent"].get("needsDescent"):
            return "platform_descent"
        if snapshot.environmentHazard or snapshot.navigationTrap or snapshot.isInLava:
            return "environment_safety"
        if snapshot.health_critical or snapshot.food_low or snapshot.oxygen_low:
            return "vitals_safety"
    if spec.agent_id == "combat_agent" and snapshot.hostile_nearby:
        return "hostile_nearby"
    if spec.agent_id == "survival_agent":
        hard_rule = rule_type in ("escape_hazard", "escape_pit", "descend_from_platform", "eat_food", "recover_starvation", "evade_hostiles", "defend_shelter", "defend_self")
        return None if hard_rule else "baseline_survival"
    if spec.agent_id == "engineering_agent":
        inventory = request.snapshot.inventory
        has_materials = any(count > 0 for name, count in inventory.items() if any(token in name for token in ("log", "planks", "cobblestone", "stone", "wool")))
        if has_materials:
            return "materials_available"
    return None


def _extract_json(raw: Any) -> Any:
    if not isinstance(raw, str):
        return raw
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:].strip()
    elif text.startswith("```"):
        text = text[3:].strip()
    if text.endswith("```"):
        text = text[:-3].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
    return None


def parse_behavior_trees(raw: Any, *, source_agent: str, allowed: set[str] | None = None) -> tuple[list[BehaviorTreeRequest], str]:
    payload = _extract_json(raw)
    if payload is None:
        return [], ""

    stage = payload.get("stageAssessment", "") if isinstance(payload, dict) else ""
    entries: list[Any] = []
    if isinstance(payload, dict):
        for key in ("behaviorTrees", "taskRequests", "tasks"):
            value = payload.get(key)
            if isinstance(value, list):
                entries.extend(value)
            elif isinstance(value, dict):
                entries.append(value)
    elif isinstance(payload, list):
        entries = payload

    trees: list[BehaviorTreeRequest] = []
    for index, item in enumerate(entries):
        if isinstance(item, str):
            task_type = item
            constructor_args: dict[str, Any] = {}
            reason = None
        elif isinstance(item, dict):
            task_type = item.get("taskType") or item.get("type") or item.get("action") or item.get("name")
            constructor_args = item.get("constructorArgs") or item.get("parameters") or item.get("args") or {}
            reason = item.get("reason") or item.get("objective")
        else:
            continue

        normalized = normalize_task_type(task_type)
        if not normalized or (allowed is not None and normalized not in allowed):
            continue
        tree = BehaviorTreeRequest.from_task(
            normalized,
            source_agent=source_agent,
            requested_by="general_agent" if source_agent != "general_agent" else "general_agent",
            reason=reason,
            constructor_args=constructor_args if isinstance(constructor_args, dict) else {},
            task_request_id=f"{source_agent}:{index}",
            preconditions=item.get("preconditions", []) if isinstance(item, dict) else [],
            postconditions=(item.get("postconditions") or item.get("successCriteria") or []) if isinstance(item, dict) else [],
        )
        if tree:
            trees.append(tree)
    return trees, stage


async def run_domain_agent(spec: AgentSpec, request: BrainRequest, client: LLMClient, cfg: BrainConfig) -> AgentProposal:
    started_at = time.monotonic()
    reason = _activation_reason(spec, request)
    if reason is None:
        return AgentProposal(agentId=spec.agent_id, active=False, reason="inactive")

    system = (
        f"You are {spec.title} for a Minecraft survival bot. "
        f"You may only request tasks from this whitelist: {list(spec.tasks)}. "
        "Output strict JSON only: {\"behaviorTrees\":[{\"taskType\":\"...\",\"reason\":\"...\",\"constructorArgs\":{}}]}. "
        "Do not write chain-of-thought, prose, JavaScript, or Mineflayer calls. "
        "Use the minecraftWiki field in context for MC survival rules; ordinary water with oxygen remaining is not a hazard and water columns are not escape pits. "
        f"Domain rule: {spec.prompt_hint}"
    )
    user = f"Activation reason: {reason}\nCurrent compact context JSON:\n{_compact_context(request, cfg)}"
    response = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    duration_ms = (time.monotonic() - started_at) * 1000
    if not response.get("ok"):
        return AgentProposal(agentId=spec.agent_id, active=True, reason=reason, durationMs=duration_ms, error=response.get("error", "llm_error"))

    trees, _stage = parse_behavior_trees(response.get("content", ""), source_agent=spec.agent_id, allowed=set(spec.tasks))
    return AgentProposal(agentId=spec.agent_id, active=True, reason=reason, trees=trees, durationMs=duration_ms)


async def run_general_agent(request: BrainRequest, client: LLMClient, cfg: BrainConfig, proposals: list[AgentProposal]) -> tuple[AgentProposal, str]:
    started_at = time.monotonic()
    sub_summary = [
        {
            "agentId": proposal.agentId,
            "active": proposal.active,
            "reason": proposal.reason,
            "trees": [tree.model_dump(exclude_none=True) for tree in proposal.trees],
            "error": proposal.error,
        }
        for proposal in proposals
        if proposal.active
    ]
    system = (
        "You are the General Agent coordinating concurrent Minecraft survival sub-agents. "
        "Merge their proposals into the final executable behavior tree instances. "
        f"Keep only tasks from this whitelist: {allowed_tasks()}. "
        "Safety and starvation recovery outrank progress. Do not repeat blocked tasks from taskFeedback. "
        "Use minecraftWiki in context; do not treat ordinary water with oxygen remaining as escape_hazard or escape_pit. "
        "Return strict JSON only with stageAssessment and behaviorTrees. No prose or hidden reasoning."
    )
    user = (
        "Compact context JSON:\n"
        f"{_compact_context(request, cfg)}\n\n"
        "Sub-agent proposals JSON:\n"
        f"{_truncate_json(sub_summary, cfg.max_context_chars)}"
    )
    response = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    duration_ms = (time.monotonic() - started_at) * 1000
    if not response.get("ok"):
        return AgentProposal(agentId="general_agent", active=True, reason="coordination", durationMs=duration_ms, error=response.get("error", "llm_error")), ""
    trees, stage = parse_behavior_trees(response.get("content", ""), source_agent="general_agent", allowed=set(allowed_tasks()))
    return AgentProposal(agentId="general_agent", active=True, reason="coordination", trees=trees, durationMs=duration_ms), stage


def all_agent_specs() -> list[AgentSpec]:
    return list(AGENT_SPECS.values())
