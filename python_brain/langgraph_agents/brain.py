"""LangGraphBrain — replaces SmartBrain with LangGraph orchestration."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from ..config import BrainConfig
from ..llm_client import LLMClient
from ..models import (
    AgentProposal,
    BehaviorTreeRequest,
    BrainRequest,
    PlanResponse,
)
from ..task_catalog import allowed_tasks, normalize_task_type, task_priority

from .graph import _extract_json, build_planning_graph
from .state import JudgeReport, PlanningState, WorkerOutput


class LangGraphBrain:
    """LangGraph-based hierarchical task planner.

    Replaces the old SmartBrain's manual asyncio.gather with:
      - StagePlanner → Workers → GeneralAgent → Judge → PromptOptimizer
      - Structured output via strict JSON prompts
      - LLM-as-Judge feedback accumulation

    The compiled LangGraph graph handles state routing.
    This class handles LLM invocation and response parsing.
    """

    def __init__(self, cfg: BrainConfig, client: LLMClient) -> None:
        self.cfg = cfg
        self.client = client
        self.graph = build_planning_graph()
        # Persistent improvement notes across plan calls
        self._prompt_notes: list[dict[str, Any]] = []

    async def plan(self, request: BrainRequest) -> PlanResponse:
        started_at = time.monotonic()

        if not self.cfg.llm_enabled:
            return self._rule_fallback(request, started_at)

        try:
            # Build initial state
            state = PlanningState(
                compact_state=request.snapshot.model_dump() if request.snapshot else {},
                rule_decision=request.ruleDecision.model_dump() if request.ruleDecision else {},
                task_feedback=request.taskFeedback.model_dump() if request.taskFeedback else {},
                memory=request.memory or {},
                progress=request.progress or {},
                minecraft_wiki=(request.plannerContext or {}).get("minecraftWiki", ""),
                prompt_notes=list(self._prompt_notes),
            )

            # Execute graph step by step, handling LLM calls
            final_state = await self._run_graph(state)

            # Persist improvement notes
            self._prompt_notes = final_state.prompt_notes

            # Build response
            return self._build_response(final_state, started_at)

        except Exception as exc:
            duration_ms = (time.monotonic() - started_at) * 1000
            return PlanResponse(
                brainAgent="langgraph",
                stageAssessment=f"error: {exc}",
                taskRequests=[],
                behaviorTrees=[],
                constraints=["langgraph_error"],
                confidence=0.0,
                durationMs=duration_ms,
            )

    async def _run_graph(self, state: PlanningState) -> PlanningState:
        """Execute the graph, calling LLM at each messaging node."""
        current_state = state
        config = {"configurable": {"thread_id": f"plan-{int(time.time() * 1000)}"}}

        # Run in async context — manual stepping
        graph_state = current_state.model_dump()

        # Stage 1: Stage Planner
        planner_msgs = await self._invoke_llm(
            [{"role": "system", "content": self._stage_planner_prompt()}],
        )
        planner_result = _extract_json(planner_msgs) or {}
        current_state.stage_assessment = planner_result.get("stageAssessment", "")
        current_state.high_level_goal = planner_result.get("highLevelGoal", "")
        current_state.active_workers = planner_result.get("activeWorkers", ["safety", "survival"])

        # Stage 2: Workers (concurrent if parallel enabled)
        worker_names = [w for w in current_state.active_workers
                       if w in ("safety", "combat", "survival", "engineering")]

        if self.cfg.parallel_agents:
            worker_tasks = [
                self._run_worker(name, current_state)
                for name in worker_names
            ]
            results = await asyncio.gather(*worker_tasks, return_exceptions=True)
        else:
            results = []
            for name in worker_names:
                results.append(await self._run_worker(name, current_state))

        for name, result in zip(worker_names, results):
            if isinstance(result, WorkerOutput):
                current_state.worker_outputs[name] = result
            else:
                current_state.worker_outputs[name] = WorkerOutput(
                    agent_id=name, active=True, reason="error",
                    error=str(result) if result else "unknown",
                )

        # Stage 3: General Agent merge
        merged = await self._run_general_agent(current_state)
        current_state.merged_trees = merged.get("behaviorTrees", [])
        current_state.merged_stage = merged.get("stageAssessment", "")

        # Stage 4: Judge (if there are trees to review)
        if current_state.merged_trees:
            judge_result = await self._run_judge(current_state)
            current_state.judge_report = judge_result

        # Stage 5: Prompt Optimizer
        if current_state.judge_report.improvement_notes:
            note = {
                "at": time.time(),
                "stage": current_state.stage_assessment,
                "notes": current_state.judge_report.improvement_notes,
                "score": current_state.judge_report.score,
            }
            current_state.prompt_notes = (current_state.prompt_notes + [note])[-20:]

        return current_state

    async def _run_worker(self, name: str, state: PlanningState) -> WorkerOutput:
        """Run a single worker agent and parse its output."""
        started = time.monotonic()
        prompts = {
            "safety": self._safety_prompt,
            "combat": self._combat_prompt,
            "survival": self._survival_prompt,
            "engineering": self._engineering_prompt,
        }
        prompt_fn = prompts.get(name)
        if not prompt_fn:
            return WorkerOutput(agent_id=name, active=False, reason="unknown_worker")

        try:
            system = prompt_fn()
            context = self._worker_context(state)
            user = (
                f"Stage: {state.stage_assessment}\n"
                f"Goal: {state.high_level_goal}\n"
                f"Context:\n{context}\n\n"
                f"Recent notes:\n{json.dumps(state.prompt_notes[-3:], ensure_ascii=False)}"
            )
            response = await asyncio.wait_for(
                self.client.chat([
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]),
                timeout=self.cfg.agent_timeout_s,
            )
            duration_ms = (time.monotonic() - started) * 1000

            if not response.get("ok"):
                return WorkerOutput(
                    agent_id=name, active=True, reason="error",
                    error=response.get("error", "llm_error"), duration_ms=duration_ms,
                )

            payload = _extract_json(response.get("content", "")) or {}
            trees_raw = payload.get("behaviorTrees", payload.get("taskRequests", []))
            trees = self._normalize_trees(trees_raw, source_agent=f"{name}_agent")

            return WorkerOutput(
                agent_id=name, active=bool(trees), reason="active",
                trees=trees, duration_ms=duration_ms,
            )

        except TimeoutError:
            return WorkerOutput(agent_id=name, active=True, reason="timeout", error="agent_timeout")
        except Exception as exc:
            return WorkerOutput(agent_id=name, active=True, reason="error", error=str(exc))

    async def _run_general_agent(self, state: PlanningState) -> dict[str, Any]:
        """Run the general agent merger."""
        started = time.monotonic()
        worker_summary = {
            wid: {"active": wo.active, "reason": wo.reason, "trees": wo.trees, "error": wo.error}
            for wid, wo in state.worker_outputs.items() if wo.active
        }

        system = self._general_agent_prompt()
        context = self._worker_context(state)
        user = (
            f"Context:\n{context}\n\n"
            f"Worker proposals:\n{json.dumps(worker_summary, ensure_ascii=False, default=str)}\n\n"
            f"Blocked tasks:\n{json.dumps(state.task_feedback.get('blockedTasks', [])[:5], ensure_ascii=False)}"
        )

        try:
            response = await asyncio.wait_for(
                self.client.chat([
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ]),
                timeout=self.cfg.agent_timeout_s,
            )
            if response.get("ok"):
                return _extract_json(response.get("content", "")) or {}
        except (TimeoutError, Exception):
            pass

        # Fallback: aggregate all worker trees
        all_trees = []
        for wo in state.worker_outputs.values():
            all_trees.extend(wo.trees)
        return {"behaviorTrees": self._dedupe_and_sort(all_trees)[:self.cfg.max_trees_per_response]}

    async def _run_judge(self, state: PlanningState) -> JudgeReport:
        """Run LLM-as-Judge to review the merged plan."""
        merged_json = json.dumps(state.merged_trees, ensure_ascii=False)
        feedback_json = json.dumps(state.task_feedback, ensure_ascii=False, default=str)

        try:
            response = await asyncio.wait_for(
                self.client.chat([
                    {"role": "system", "content": self._judge_prompt()},
                    {"role": "user", "content": (
                        f"Merged trees:\n{merged_json}\n\n"
                        f"Task feedback:\n{feedback_json}\n\n"
                        f"Stage: {state.stage_assessment}\n"
                        f"Workers: {state.active_workers}"
                    )},
                ]),
                timeout=self.cfg.agent_timeout_s,
            )
            if response.get("ok"):
                result = _extract_json(response.get("content", "")) or {}
                return JudgeReport(
                    score=float(result.get("score", 0.7)),
                    issues=result.get("issues", []),
                    suggestions=result.get("suggestions", []),
                    blocked_tasks_detected=result.get("blockedTasksDetected", False),
                    missing_safety_concern=result.get("missingSafetyConcern", False),
                    improvement_notes=result.get("improvementNotes", ""),
                )
        except (TimeoutError, Exception):
            pass

        return JudgeReport(score=0.5, issues=["judge_timeout"], improvement_notes="")

    def _normalize_trees(self, raw: list[Any], source_agent: str) -> list[dict[str, Any]]:
        """Normalize raw LLM output to behavior tree dicts."""
        trees = []
        for i, item in enumerate(raw):
            if isinstance(item, str):
                task_type = normalize_task_type(item)
                if task_type:
                    trees.append({"taskType": task_type, "constructorArgs": {},
                                  "sourceAgent": source_agent, "taskRequestId": f"{source_agent}:{i}"})
            elif isinstance(item, dict):
                task_type = normalize_task_type(
                    item.get("taskType") or item.get("type") or item.get("action") or ""
                )
                if task_type:
                    trees.append({
                        "taskType": task_type,
                        "constructorArgs": item.get("constructorArgs") or item.get("args") or {},
                        "reason": item.get("reason", ""),
                        "sourceAgent": source_agent,
                        "taskRequestId": item.get("taskRequestId", f"{source_agent}:{i}"),
                    })
        return trees

    def _dedupe_and_sort(self, trees: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Deduplicate by taskType+args and sort by priority."""
        seen: set[str] = set()
        result = []
        for tree in trees:
            task_type = tree.get("taskType", "")
            if task_type not in allowed_tasks():
                continue
            key = f"{task_type}:{json.dumps(tree.get('constructorArgs', {}), sort_keys=True)}"
            if key in seen:
                continue
            seen.add(key)
            result.append(tree)
        result.sort(key=lambda t: task_priority(t.get("taskType", "")), reverse=True)
        return result

    def _worker_context(self, state: PlanningState) -> str:
        ctx = {
            "bot": state.compact_state,
            "ruleDecision": state.rule_decision,
            "taskFeedback": state.task_feedback,
            "progress": state.progress,
        }
        text = json.dumps(ctx, ensure_ascii=False, separators=(",", ":"), default=str)
        return text if len(text) <= 8000 else f"{text[:8000]}..."

    # ── Prompt accessors (overridable for testing) ──

    def _stage_planner_prompt(self) -> str:
        from .prompts import STAGE_PLANNER_SYSTEM
        return STAGE_PLANNER_SYSTEM

    def _safety_prompt(self) -> str:
        from .prompts import SAFETY_WORKER_SYSTEM
        return SAFETY_WORKER_SYSTEM

    def _combat_prompt(self) -> str:
        from .prompts import COMBAT_WORKER_SYSTEM
        return COMBAT_WORKER_SYSTEM

    def _survival_prompt(self) -> str:
        from .prompts import SURVIVAL_WORKER_SYSTEM
        return SURVIVAL_WORKER_SYSTEM

    def _engineering_prompt(self) -> str:
        from .prompts import ENGINEERING_WORKER_SYSTEM
        return ENGINEERING_WORKER_SYSTEM

    def _general_agent_prompt(self) -> str:
        from .prompts import GENERAL_AGENT_SYSTEM
        return GENERAL_AGENT_SYSTEM.format(
            allowed_tasks=json.dumps(allowed_tasks()),
            max_trees=self.cfg.max_trees_per_response,
        )

    def _judge_prompt(self) -> str:
        from .prompts import JUDGE_SYSTEM
        return JUDGE_SYSTEM

    def _build_response(self, state: PlanningState, started_at: float) -> PlanResponse:
        """Build PlanResponse from final state."""
        trees = state.merged_trees
        proposals = []
        for wid, wo in state.worker_outputs.items():
            proposals.append(AgentProposal(
                agentId=wo.agent_id or wid,
                active=wo.active,
                reason=wo.reason,
                trees=[BehaviorTreeRequest.from_task(
                    t.get("taskType", ""),
                    source_agent=wo.agent_id,
                    constructor_args=t.get("constructorArgs", {}),
                    reason=t.get("reason"),
                    task_request_id=t.get("taskRequestId"),
                ) for t in wo.trees if t.get("taskType")],
                durationMs=wo.duration_ms,
                error=wo.error,
            ))

        behavior_trees = [
            bt for t in trees if (
                bt := BehaviorTreeRequest.from_task(
                    t.get("taskType", ""),
                    source_agent=t.get("sourceAgent", "general_agent"),
                    constructor_args=t.get("constructorArgs", {}),
                    reason=t.get("reason"),
                    task_request_id=t.get("taskRequestId"),
                )
            )
        ]

        duration_ms = (time.monotonic() - started_at) * 1000
        return PlanResponse(
            brainAgent="langgraph",
            stageAssessment=state.merged_stage or state.stage_assessment,
            agentProposals=proposals,
            taskRequests=behavior_trees,
            behaviorTrees=behavior_trees,
            constraints=["langgraph_hierarchical", "llm_judge_feedback"],
            confidence=state.judge_report.score if state.judge_report.score > 0 else 0.8,
            durationMs=duration_ms,
        )

    def _rule_fallback(self, request: BrainRequest, started_at: float) -> PlanResponse:
        """Fallback when LLM is disabled — same logic as old SmartBrain."""
        from ..task_catalog import allowed_tasks as _allowed

        snapshot = request.snapshot
        rule_type = request.ruleDecision.type if request.ruleDecision else None
        candidates = [rule_type] if rule_type in _allowed() else []

        if not candidates:
            if snapshot.environmentHazard or snapshot.isInLava:
                candidates.append("escape_hazard")
            elif snapshot.navigationTrap:
                candidates.append("escape_pit")
            elif snapshot.health_critical and snapshot.food_low:
                candidates.append("recover_starvation")
            elif snapshot.hostile_nearby:
                candidates.append("evade_hostiles")
            elif snapshot.food_low:
                candidates.append("hunt_food")
            elif not snapshot.has_wood:
                candidates.append("collect_wood")
            else:
                candidates.append("explore")

        trees = [
            bt for c in candidates if (
                bt := BehaviorTreeRequest.from_task(c, source_agent="rule_fallback", reason="llm_disabled")
            )
        ]
        duration_ms = (time.monotonic() - started_at) * 1000
        return PlanResponse(
            brainAgent="rule_fallback",
            stageAssessment=f"stage=fallback; rule={rule_type or 'none'}",
            agentProposals=[],
            taskRequests=trees,
            behaviorTrees=trees,
            constraints=["llm_disabled"],
            confidence=0.55,
            durationMs=duration_ms,
        )
