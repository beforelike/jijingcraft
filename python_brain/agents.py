"""
Individual agent implementations.

Each agent is a single async coroutine that:
  1. Decides whether it should be active based on the snapshot.
  2. If active, builds a system+user prompt and calls the LLM.
  3. Parses the JSON response into BehaviorTreeRequest objects.
  4. Returns an AgentProposal.

Agents never call Mineflayer directly – they only output task requests.
The Node.js BehaviorExecutionQueue handles execution.
"""

from __future__ import annotations

import json
import time
from typing import Any

from .llm_client import LLMClient
from .models import AgentProposal, BehaviorTreeRequest, BotSnapshot


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ALLOWED_TASKS = {
    "safety_agent": ["escape_hazard", "escape_pit", "eat_food", "recover_starvation"],
    "combat_agent": ["evade_hostiles", "defend_shelter", "defend_self"],
    "survival_agent": ["hunt_food", "collect_wood", "explore", "wait_out_night", "hold_position"],
    "engineering_agent": [
        "craft_basic_supplies", "craft_basic_tools", "collect_stone",
        "craft_stone_tools", "craft_furnace", "craft_weapon",
        "collect_building_materials", "build_shelter",
        "collect_wool", "craft_bed",
    ],
}


def _parse_trees(raw: Any, agent_id: str) -> list[BehaviorTreeRequest]:
    """
    Parse LLM output into BehaviorTreeRequest list.
    Accepts:
      - JSON object with taskRequests / behaviorTrees key
      - JSON array of task objects
      - Plain text with a JSON code block
    """
    if isinstance(raw, str):
        text = raw.strip()
        # strip markdown code fences
        for prefix in ("```json", "```"):
            if text.startswith(prefix):
                text = text[len(prefix):]
        text = text.rstrip("`").strip()
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            # Try to extract first JSON object
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                try:
                    raw = json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    return []
            else:
                return []

    trees: list[dict] = []
    if isinstance(raw, dict):
        trees = raw.get("behaviorTrees") or raw.get("taskRequests") or []
        if isinstance(trees, dict):
            trees = [trees]
    elif isinstance(raw, list):
        trees = raw

    results = []
    allowed = _ALLOWED_TASKS.get(agent_id, [])
    for item in trees:
        if not isinstance(item, dict):
            continue
        task_type = item.get("taskType") or item.get("task_type") or ""
        if not task_type:
            continue
        if allowed and task_type not in allowed:
            continue  # reject tasks outside the agent's domain
        results.append(
            BehaviorTreeRequest.from_task(
                task_type,
                source_agent=agent_id,
                reason=item.get("reason"),
                constructor_args=item.get("constructorArgs") or item.get("parameters") or {},
            )
        )
    return results


def _snapshot_summary(s: BotSnapshot) -> str:
    inv_top = sorted(s.inventory.items(), key=lambda x: -x[1])[:12]
    hostile_names = [e.name for e in s.entities if e.hostile][:6]
    return (
        f"health={s.health}/20 food={s.food}/20 isDay={s.isDay} "
        f"pos=({s.position.x:.0f},{s.position.y:.0f},{s.position.z:.0f})\n"
        f"hostiles={hostile_names}\n"
        f"inventory={dict(inv_top)}\n"
        f"ruleDecision={s.ruleDecision.model_dump() if s.ruleDecision else None}"
    ) if s.position else "(no position)"


# ---------------------------------------------------------------------------
# Agent coroutines
# ---------------------------------------------------------------------------

async def run_safety_agent(snapshot: BotSnapshot, client: LLMClient) -> AgentProposal:
    agent_id = "safety_agent"
    t0 = time.monotonic()

    active = snapshot.health_critical or snapshot.food_low or snapshot.hostile_nearby
    if not active:
        rule = snapshot.ruleDecision
        if rule and rule.type in ("escape_hazard", "escape_pit", "eat_food", "recover_starvation"):
            active = True

    if not active:
        return AgentProposal(agentId=agent_id, active=False, reason="no_immediate_threat")

    system = (
        "You are the Safety Agent for a Minecraft survival BOT. "
        "Your ONLY job is to select 1-2 urgent tasks from this whitelist: "
        + str(_ALLOWED_TASKS[agent_id])
        + ". Output valid JSON: {\"behaviorTrees\": [{\"taskType\": \"...\", \"reason\": \"...\"}]}. "
        "No prose, no markdown explanations outside the JSON."
    )
    user = (
        "Current BOT state:\n" + _snapshot_summary(snapshot)
        + "\n\nSelect the most urgent safety task(s). If none apply, return {\"behaviorTrees\": []}."
    )

    resp = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    dur = (time.monotonic() - t0) * 1000
    trees = _parse_trees(resp.get("content", ""), agent_id) if resp["ok"] else []
    return AgentProposal(
        agentId=agent_id,
        active=True,
        reason="threat_detected",
        trees=trees,
        durationMs=dur,
    )


async def run_combat_agent(snapshot: BotSnapshot, client: LLMClient) -> AgentProposal:
    agent_id = "combat_agent"
    t0 = time.monotonic()

    active = snapshot.hostile_nearby or (
        snapshot.ruleDecision and snapshot.ruleDecision.type in _ALLOWED_TASKS[agent_id]
    )
    if not active:
        return AgentProposal(agentId=agent_id, active=False, reason="no_combat_needed")

    system = (
        "You are the Combat Agent. Choose 1 task from: " + str(_ALLOWED_TASKS[agent_id])
        + ". Output: {\"behaviorTrees\": [{\"taskType\": \"...\", \"reason\": \"...\"}]}. JSON only."
    )
    user = "State:\n" + _snapshot_summary(snapshot)

    resp = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    dur = (time.monotonic() - t0) * 1000
    trees = _parse_trees(resp.get("content", ""), agent_id) if resp["ok"] else []
    return AgentProposal(agentId=agent_id, active=True, reason="combat", trees=trees, durationMs=dur)


async def run_survival_agent(snapshot: BotSnapshot, client: LLMClient) -> AgentProposal:
    agent_id = "survival_agent"
    t0 = time.monotonic()

    # Active unless an urgent safety/combat task dominates
    rule = snapshot.ruleDecision
    skip = rule and rule.type in (
        *_ALLOWED_TASKS["safety_agent"],
        *_ALLOWED_TASKS["combat_agent"],
    )
    if skip:
        return AgentProposal(agentId=agent_id, active=False, reason="safety_or_combat_priority")

    system = (
        "You are the Survival Agent. Plan 1-2 tasks from: " + str(_ALLOWED_TASKS[agent_id])
        + ".\nInventory context matters: if wood is low pick collect_wood, if food is low pick hunt_food.\n"
        "Output: {\"behaviorTrees\": [{\"taskType\": \"...\", \"reason\": \"...\", "
        "\"constructorArgs\": {\"count\": 4}}]}. JSON only."
    )
    user = "State:\n" + _snapshot_summary(snapshot)

    resp = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    dur = (time.monotonic() - t0) * 1000
    trees = _parse_trees(resp.get("content", ""), agent_id) if resp["ok"] else []
    return AgentProposal(agentId=agent_id, active=True, reason="survival_planning", trees=trees, durationMs=dur)


async def run_engineering_agent(snapshot: BotSnapshot, client: LLMClient) -> AgentProposal:
    agent_id = "engineering_agent"
    t0 = time.monotonic()

    inv = snapshot.inventory
    has_wood = snapshot.has_wood
    has_sticks = inv.get("stick", 0) >= 2
    has_planks = any(v > 0 for k, v in inv.items() if "planks" in k)
    has_basic_tools = any(
        inv.get(t, 0) > 0
        for t in ("wooden_pickaxe", "stone_pickaxe", "iron_pickaxe")
    )

    # Engineering agent only activates if resources allow crafting
    if not (has_wood or has_planks or has_sticks or has_basic_tools):
        return AgentProposal(agentId=agent_id, active=False, reason="insufficient_resources")

    system = (
        "You are the Engineering Agent. Select 1 crafting/building task from: "
        + str(_ALLOWED_TASKS[agent_id])
        + ".\nConsider inventory carefully. Do not request tasks that need materials the bot lacks.\n"
        "Output: {\"behaviorTrees\": [{\"taskType\": \"...\", \"reason\": \"...\"}]}. JSON only."
    )
    user = "State:\n" + _snapshot_summary(snapshot)

    resp = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    dur = (time.monotonic() - t0) * 1000
    trees = _parse_trees(resp.get("content", ""), agent_id) if resp["ok"] else []
    return AgentProposal(agentId=agent_id, active=True, reason="engineering", trees=trees, durationMs=dur)


async def run_general_agent(
    snapshot: BotSnapshot,
    client: LLMClient,
    sub_proposals: list[AgentProposal],
) -> AgentProposal:
    """
    General agent: synthesises sub-agent proposals and the world state into a
    final prioritised list of BehaviorTreeRequests.
    Always runs, regardless of the world state.
    """
    agent_id = "general_agent"
    t0 = time.monotonic()

    sub_summary = []
    for p in sub_proposals:
        if p.active and p.trees:
            sub_summary.append({
                "agent": p.agentId,
                "tasks": [{"taskType": t.taskType, "reason": t.reason} for t in p.trees],
            })

    all_tasks = [t for t in _ALLOWED_TASKS.values() for t in t]

    system = (
        "You are the General Agent coordinating a Minecraft survival BOT. "
        "Sub-agents have proposed tasks. Your job: merge, prioritise, and output the final task list.\n"
        "Rules:\n"
        "- Safety tasks always come first.\n"
        "- Keep only tasks from this whitelist: " + str(all_tasks) + "\n"
        "- Return at most 3 tasks.\n"
        "- Output: {\"stageAssessment\": \"...\", "
        "\"behaviorTrees\": [{\"taskType\": \"...\", \"reason\": \"...\", \"constructorArgs\": {}}]}. "
        "JSON only."
    )
    user = (
        "State:\n" + _snapshot_summary(snapshot)
        + "\n\nSub-agent proposals:\n" + json.dumps(sub_summary, ensure_ascii=False)
    )

    resp = await client.chat([
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ])
    dur = (time.monotonic() - t0) * 1000

    content = resp.get("content", "") if resp["ok"] else ""
    raw = content
    try:
        parsed = json.loads(content) if isinstance(content, str) else content
    except json.JSONDecodeError:
        parsed = content

    stage = ""
    if isinstance(parsed, dict):
        stage = parsed.get("stageAssessment", "")

    trees = _parse_trees(raw, "general_agent")
    return AgentProposal(
        agentId=agent_id,
        active=True,
        reason="coordination",
        trees=trees,
        durationMs=dur,
    ), stage
