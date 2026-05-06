"""
Core orchestration layer.
Runs safety / combat / survival / engineering agents concurrently,
then passes their proposals to the general agent for synthesis.
"""

from __future__ import annotations

import asyncio
import time

from .agents import (
    run_combat_agent,
    run_engineering_agent,
    run_general_agent,
    run_safety_agent,
    run_survival_agent,
)
from .config import BrainConfig
from .llm_client import LLMClient
from .models import AgentProposal, BotSnapshot, PlanResponse


class SmartBrain:
    """
    One shared instance per server process.
    Thread-safe because all I/O is async.
    """

    def __init__(self, cfg: BrainConfig, client: LLMClient):
        self.cfg = cfg
        self.client = client

    async def plan(self, snapshot: BotSnapshot) -> PlanResponse:
        t0 = time.monotonic()

        if not self.cfg.llm_enabled:
            # Graceful degradation: rule-based fallback when LLM is not configured
            return self._rule_fallback(snapshot, t0)

        # ----------------------------------------------------------------
        # Step 1: Run sub-agents concurrently
        # ----------------------------------------------------------------
        if self.cfg.parallel_agents:
            results = await asyncio.gather(
                run_safety_agent(snapshot, self.client),
                run_combat_agent(snapshot, self.client),
                run_survival_agent(snapshot, self.client),
                run_engineering_agent(snapshot, self.client),
                return_exceptions=True,
            )
        else:
            # Sequential mode for debugging
            results = [
                await run_safety_agent(snapshot, self.client),
                await run_combat_agent(snapshot, self.client),
                await run_survival_agent(snapshot, self.client),
                await run_engineering_agent(snapshot, self.client),
            ]

        sub_proposals: list[AgentProposal] = []
        for r in results:
            if isinstance(r, Exception):
                # An individual agent crash must not abort the whole plan
                continue
            sub_proposals.append(r)

        # ----------------------------------------------------------------
        # Step 2: General agent synthesises
        # ----------------------------------------------------------------
        general_result = await run_general_agent(snapshot, self.client, sub_proposals)
        if isinstance(general_result, tuple):
            general_proposal, stage = general_result
        else:
            general_proposal = general_result
            stage = ""

        # ----------------------------------------------------------------
        # Step 3: Merge all proposals, deduplicate, cap, sort by priority
        # ----------------------------------------------------------------
        all_proposals = [*sub_proposals, general_proposal]
        all_trees = list(general_proposal.trees)  # general agent is authoritative

        # If general agent returned nothing, fall back to sub-agent proposals
        if not all_trees:
            seen: set[str] = set()
            for p in sub_proposals:
                for tree in p.trees:
                    if tree.taskType not in seen:
                        seen.add(tree.taskType)
                        all_trees.append(tree)

        # Sort by priority (ascending = highest priority first)
        all_trees.sort(key=lambda t: t.priority)

        # Cap total trees
        final_trees = all_trees[: self.cfg.max_trees_per_response]

        dur = (time.monotonic() - t0) * 1000
        return PlanResponse(
            brainAgent="general_agent",
            stageAssessment=stage,
            agentProposals=all_proposals,
            behaviorTrees=final_trees,
            confidence=0.85 if final_trees else 0.4,
            durationMs=dur,
        )

    # ------------------------------------------------------------------
    # Rule-based fallback (no LLM configured)
    # ------------------------------------------------------------------
    def _rule_fallback(self, snapshot: BotSnapshot, t0: float) -> PlanResponse:
        from .models import BehaviorTreeRequest

        trees: list[BehaviorTreeRequest] = []
        if snapshot.health_critical:
            trees.append(BehaviorTreeRequest.from_task("eat_food", reason="health_critical"))
        elif snapshot.hostile_nearby:
            trees.append(BehaviorTreeRequest.from_task("evade_hostiles", reason="hostile_nearby"))
        elif snapshot.food_low:
            trees.append(BehaviorTreeRequest.from_task("hunt_food", reason="food_low"))
        elif not snapshot.has_wood:
            trees.append(BehaviorTreeRequest.from_task("collect_wood", reason="need_wood"))
        else:
            trees.append(BehaviorTreeRequest.from_task("explore", reason="rule_fallback"))

        dur = (time.monotonic() - t0) * 1000
        return PlanResponse(
            brainAgent="rule_fallback",
            stageAssessment="no_llm",
            behaviorTrees=trees,
            confidence=0.6,
            durationMs=dur,
        )
