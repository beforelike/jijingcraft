"""Core orchestration for the Python Smart Brain service."""

from __future__ import annotations

import asyncio
import time

from .agents import all_agent_specs, run_domain_agent, run_general_agent
from .config import BrainConfig
from .llm_client import LLMClient
from .models import AgentProposal, BehaviorTreeRequest, BrainRequest, PlanResponse
from .task_catalog import allowed_tasks, task_priority


class SmartBrain:
    def __init__(self, cfg: BrainConfig, client: LLMClient) -> None:
        self.cfg = cfg
        self.client = client

    async def plan(self, request: BrainRequest) -> PlanResponse:
        started_at = time.monotonic()
        if not self.cfg.llm_enabled:
            return self._rule_fallback(request, started_at)

        specs = all_agent_specs()
        if self.cfg.parallel_agents:
            proposal_results = await asyncio.gather(
                *(self._run_domain_agent_with_timeout(spec, request) for spec in specs),
                return_exceptions=True,
            )
        else:
            proposal_results = []
            for spec in specs:
                proposal_results.append(await self._run_domain_agent_with_timeout(spec, request))

        proposals = self._clean_agent_results(proposal_results)
        stage_assessment = ""
        if self.cfg.general_agent_enabled:
            general_result = await self._run_general_with_timeout(request, proposals)
            general_proposal, stage_assessment = general_result
            proposals.append(general_proposal)
            candidate_trees = list(general_proposal.trees)
        else:
            candidate_trees = []

        if not candidate_trees:
            candidate_trees = [tree for proposal in proposals for tree in proposal.trees]

        final_trees = self._dedupe_and_sort(candidate_trees)[: self.cfg.max_trees_per_response]
        duration_ms = (time.monotonic() - started_at) * 1000
        return PlanResponse(
            brainAgent="general_agent",
            stageAssessment=stage_assessment or self._stage_from_request(request),
            agentProposals=proposals,
            taskRequests=final_trees,
            behaviorTrees=final_trees,
            constraints=["local_js_behavior_tree_whitelist", "node_controller_enforces_priority"],
            confidence=0.86 if final_trees else 0.35,
            durationMs=duration_ms,
        )

    async def _run_domain_agent_with_timeout(self, spec, request: BrainRequest) -> AgentProposal:
        try:
            return await asyncio.wait_for(run_domain_agent(spec, request, self.client, self.cfg), timeout=self.cfg.agent_timeout_s)
        except TimeoutError:
            return AgentProposal(agentId=spec.agent_id, active=True, reason="timeout", error="agent_timeout")
        except Exception as exc:
            return AgentProposal(agentId=spec.agent_id, active=True, reason="error", error=str(exc))

    async def _run_general_with_timeout(self, request: BrainRequest, proposals: list[AgentProposal]) -> tuple[AgentProposal, str]:
        try:
            return await asyncio.wait_for(run_general_agent(request, self.client, self.cfg, proposals), timeout=self.cfg.agent_timeout_s)
        except TimeoutError:
            return AgentProposal(agentId="general_agent", active=True, reason="timeout", error="agent_timeout"), ""
        except Exception as exc:
            return AgentProposal(agentId="general_agent", active=True, reason="error", error=str(exc)), ""

    @staticmethod
    def _clean_agent_results(results) -> list[AgentProposal]:
        proposals: list[AgentProposal] = []
        for result in results:
            if isinstance(result, AgentProposal):
                proposals.append(result)
            elif isinstance(result, Exception):
                proposals.append(AgentProposal(agentId="unknown_agent", active=True, reason="error", error=str(result)))
        return proposals

    @staticmethod
    def _dedupe_and_sort(trees: list[BehaviorTreeRequest]) -> list[BehaviorTreeRequest]:
        seen: set[str] = set()
        result: list[BehaviorTreeRequest] = []
        for tree in trees:
            if tree.taskType not in allowed_tasks():
                continue
            key = f"{tree.taskType}:{tree.constructorArgs}"
            if key in seen:
                continue
            seen.add(key)
            result.append(tree)
        result.sort(key=lambda tree: task_priority(tree.taskType), reverse=True)
        return result

    @staticmethod
    def _stage_from_request(request: BrainRequest) -> str:
        rule_type = request.ruleDecision.type if request.ruleDecision else "none"
        stage = request.progress.get("stage") if isinstance(request.progress, dict) else None
        return f"stage={stage or 'unknown'}; rule={rule_type}"

    def _rule_fallback(self, request: BrainRequest, started_at: float) -> PlanResponse:
        snapshot = request.snapshot
        rule_type = request.ruleDecision.type if request.ruleDecision else None
        candidates = [rule_type] if rule_type in allowed_tasks() else []
        if not candidates:
            terrain = (request.plannerContext or {}).get("world", {}).get("terrain", {})
            descent = terrain.get("descent") if isinstance(terrain, dict) else None
            if isinstance(descent, dict) and descent.get("needsDescent"):
                candidates.append("descend_from_platform")
            elif snapshot.environmentHazard or snapshot.isInLava:
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

        trees = [tree for task in candidates if (tree := BehaviorTreeRequest.from_task(task, source_agent="rule_fallback", reason="llm_disabled"))]
        duration_ms = (time.monotonic() - started_at) * 1000
        return PlanResponse(
            brainAgent="rule_fallback",
            stageAssessment=self._stage_from_request(request),
            agentProposals=[AgentProposal(agentId="rule_fallback", active=True, reason="llm_disabled", trees=trees, durationMs=duration_ms)],
            taskRequests=trees,
            behaviorTrees=trees,
            constraints=["llm_disabled"],
            confidence=0.55,
            durationMs=duration_ms,
        )
