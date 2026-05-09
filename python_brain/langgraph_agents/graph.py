"""LangGraph StateGraph for hierarchical task planning.

Graph: StagePlanner → [Safety, Combat, Survival, Engineering] → GeneralAgent → Judge
         ↑                                                                          |
         └──────────────────── PromptOptimizer ←────────────────────────────────────┘
"""

from __future__ import annotations

import json
import time
from typing import Any, Literal

from langgraph.graph import END, StateGraph

from .prompts import (
    COMBAT_WORKER_SYSTEM,
    ENGINEERING_WORKER_SYSTEM,
    GENERAL_AGENT_SYSTEM,
    JUDGE_SYSTEM,
    SAFETY_WORKER_SYSTEM,
    STAGE_PLANNER_SYSTEM,
    SURVIVAL_WORKER_SYSTEM,
)
from .state import JudgeReport, PlanningState, WorkerOutput

# Re-export for convenience
__all__ = ["build_planning_graph", "PlanningState"]


def _extract_json(content: str) -> dict[str, Any] | None:
    """Extract JSON from LLM response, handling markdown fences."""
    if not content:
        return None
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
    return None


def _compact_context(state: PlanningState) -> str:
    """Build compact JSON context for LLM calls."""
    ctx = {
        "bot": state.compact_state,
        "ruleDecision": state.rule_decision,
        "progress": state.progress,
        "taskFeedback": state.task_feedback,
    }
    text = json.dumps(ctx, ensure_ascii=False, separators=(",", ":"), default=str)
    max_chars = 8000
    return text if len(text) <= max_chars else f"{text[:max_chars]}..."


# ── Node functions ────────────────────────────────────────────────────────────


async def stage_planner_node(state: PlanningState) -> dict[str, Any]:
    """Assess situation and decide which workers to activate."""
    context = _compact_context(state)
    user = (
        f"Current context JSON:\n{context}\n\n"
        f"Minecraft survival knowledge:\n{state.minecraft_wiki[:3000]}\n\n"
        f"Recent improvement notes:\n{json.dumps(state.prompt_notes[-5:], ensure_ascii=False)}\n\n"
        "Decide: which workers should be active for this planning cycle?"
    )

    messages = [
        {"role": "system", "content": STAGE_PLANNER_SYSTEM},
        {"role": "user", "content": user},
    ]

    return {
        "messages": messages,
        "stage_assessment": "pending",
        "active_workers": ["safety", "survival"],  # safe defaults
    }


async def worker_node(state: PlanningState, worker_name: str, system_prompt: str) -> dict[str, Any]:
    """Generic worker node — calls LLM and parses structured output."""
    context = _compact_context(state)
    user = (
        f"Stage assessment: {state.stage_assessment}\n"
        f"High-level goal: {state.high_level_goal}\n"
        f"Compact context JSON:\n{context}\n\n"
        f"Minecraft survival knowledge:\n{state.minecraft_wiki[:2000]}\n\n"
        f"Recent improvement notes:\n{json.dumps(state.prompt_notes[-5:], ensure_ascii=False)}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user},
    ]

    return {"messages": messages}


async def safety_worker_node(state: PlanningState) -> dict[str, Any]:
    return await worker_node(state, "safety", SAFETY_WORKER_SYSTEM)


async def combat_worker_node(state: PlanningState) -> dict[str, Any]:
    return await worker_node(state, "combat", COMBAT_WORKER_SYSTEM)


async def survival_worker_node(state: PlanningState) -> dict[str, Any]:
    return await worker_node(state, "survival", SURVIVAL_WORKER_SYSTEM)


async def engineering_worker_node(state: PlanningState) -> dict[str, Any]:
    return await worker_node(state, "engineering", ENGINEERING_WORKER_SYSTEM)


async def general_agent_node(state: PlanningState) -> dict[str, Any]:
    """Merge all worker outputs into final behavior tree list."""
    worker_summary = {
        wid: {
            "active": wo.active,
            "reason": wo.reason,
            "trees": wo.trees,
            "error": wo.error,
        }
        for wid, wo in state.worker_outputs.items()
    }

    context = _compact_context(state)
    allowed_tasks = json.dumps([
        "escape_hazard", "escape_pit", "descend_from_platform", "eat_food",
        "recover_starvation", "evade_hostiles", "defend_shelter", "defend_self",
        "wait_out_night", "hold_position", "hunt_food", "collect_wood",
        "craft_basic_supplies", "craft_basic_tools", "collect_stone",
        "craft_stone_tools", "craft_furnace", "craft_weapon",
        "collect_building_materials", "build_shelter", "collect_wool",
        "craft_bed", "collect_crop_seeds", "plant_crops", "build_animal_pen",
        "lure_animals", "mine_advanced_materials", "explore",
    ])

    user = (
        f"Compact context JSON:\n{context}\n\n"
        f"Worker proposals:\n{json.dumps(worker_summary, ensure_ascii=False, default=str)}\n\n"
        f"Recent task feedback (avoid blocked tasks):\n{json.dumps(state.task_feedback.get('blockedTasks', [])[:5], ensure_ascii=False)}"
    )

    system = GENERAL_AGENT_SYSTEM.format(allowed_tasks=allowed_tasks, max_trees=6)

    return {
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }


async def judge_node(state: PlanningState) -> dict[str, Any]:
    """LLM-as-Judge: review the merged plan for quality issues."""
    merged_summary = json.dumps(state.merged_trees, ensure_ascii=False, default=str)
    task_feedback = json.dumps(state.task_feedback, ensure_ascii=False, default=str)

    user = (
        f"Merged behavior trees:\n{merged_summary}\n\n"
        f"Recent task feedback:\n{task_feedback}\n\n"
        f"Stage assessment: {state.stage_assessment}\n"
        f"Active workers: {state.active_workers}\n\n"
        "Review this plan. Score it and identify issues."
    )

    return {
        "messages": [{"role": "system", "content": JUDGE_SYSTEM}, {"role": "user", "content": user}],
    }


async def prompt_optimizer_node(state: PlanningState) -> dict[str, Any]:
    """Accumulate improvement notes from judge feedback."""
    if state.judge_report.improvement_notes:
        note = {
            "at": time.time(),
            "stage": state.stage_assessment,
            "notes": state.judge_report.improvement_notes,
            "score": state.judge_report.score,
        }
        updated_notes = state.prompt_notes + [note]
        # Keep last 20 notes to avoid unbounded growth
        return {"prompt_notes": updated_notes[-20:]}
    return {}


# ── Router functions ──────────────────────────────────────────────────────────


def route_after_stage_planner(state: PlanningState) -> list[str]:
    """Route to active workers based on StagePlanner decision."""
    worker_map = {
        "safety": "safety_worker",
        "combat": "combat_worker",
        "survival": "survival_worker",
        "engineering": "engineering_worker",
    }
    routes = [worker_map[w] for w in state.active_workers if w in worker_map]
    return routes or ["survival_worker"]


def should_judge(state: PlanningState) -> Literal["judge", "prompt_optimizer"]:
    """Decide whether judge review is needed."""
    if not state.merged_trees:
        return "prompt_optimizer"
    return "judge"


# ── Graph builder ─────────────────────────────────────────────────────────────


def build_planning_graph() -> StateGraph:
    """Build and compile the planning graph.

    Returns a compiled StateGraph ready for invocation.
    The caller is responsible for providing LLM calls via the messages interface.
    """
    graph = StateGraph(PlanningState)

    # Add nodes
    graph.add_node("stage_planner", stage_planner_node)
    graph.add_node("safety_worker", safety_worker_node)
    graph.add_node("combat_worker", combat_worker_node)
    graph.add_node("survival_worker", survival_worker_node)
    graph.add_node("engineering_worker", engineering_worker_node)
    graph.add_node("general_agent", general_agent_node)
    graph.add_node("judge", judge_node)
    graph.add_node("prompt_optimizer", prompt_optimizer_node)

    # Set entry
    graph.set_entry_point("stage_planner")

    # Stage planner → worker(s)
    graph.add_conditional_edges(
        "stage_planner",
        route_after_stage_planner,
        {
            "safety_worker": "safety_worker",
            "combat_worker": "combat_worker",
            "survival_worker": "survival_worker",
            "engineering_worker": "engineering_worker",
        },
    )

    # All workers → general_agent
    for worker in ["safety_worker", "combat_worker", "survival_worker", "engineering_worker"]:
        graph.add_edge(worker, "general_agent")

    # General agent → judge or skip to optimizer
    graph.add_conditional_edges(
        "general_agent",
        should_judge,
        {"judge": "judge", "prompt_optimizer": "prompt_optimizer"},
    )

    # Judge → prompt_optimizer
    graph.add_edge("judge", "prompt_optimizer")

    # Prompt optimizer → END
    graph.add_edge("prompt_optimizer", END)

    return graph.compile()
