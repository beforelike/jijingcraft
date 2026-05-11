"""LangChain multi-agent planner for Python Smart Brain."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Iterable

from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate

from ..config import BrainConfig
from ..llm_client import LLMClient
from ..models import AgentProposal, BehaviorTreeRequest, BrainRequest, PlanResponse
from ..task_catalog import AGENT_SPECS, agent_for_task, allowed_tasks, normalize_task_type, task_priority
from .feedback import DecisionFeedbackTracker
from .prompts import GENERAL_SYSTEM, JUDGE_SYSTEM, STAGE_SYSTEM, WORKER_SYSTEM
from .schemas import GeneralPlan, JudgePlan, StagePlan, TaskDraft, WorkerPlan


class LangChainSmartBrain:
    """Small LangChain pipeline: stage planner -> domain workers -> coordinator -> judge."""

    def __init__(self, cfg: BrainConfig, client: LLMClient) -> None:
        self.cfg = cfg
        self.client = client
        self.feedback = DecisionFeedbackTracker()
        self.allowed_tasks = allowed_tasks()
        self.stage_parser = PydanticOutputParser(pydantic_object=StagePlan)
        self.worker_parser = PydanticOutputParser(pydantic_object=WorkerPlan)
        self.general_parser = PydanticOutputParser(pydantic_object=GeneralPlan)
        self.judge_parser = PydanticOutputParser(pydantic_object=JudgePlan)

    async def plan(self, request: BrainRequest) -> PlanResponse:
        started = time.perf_counter()
        if not self.cfg.llm_enabled:
            return self._fallback(request, started, "llm_disabled")

        try:
            stage = await self._run_stage(request)
            active_agents = self._active_agents(request, stage)
            workers = await self._run_workers(request, stage, active_agents)
            general = await self._run_general(request, stage, workers)
            normalized = self._normalize_tasks(request, general.selectedTasks, workers)
            judge = await self._run_judge(request, normalized["accepted"], normalized["rejected"])
            accepted = self._apply_judge(normalized["accepted"], judge)
            if not accepted:
                return self._fallback(request, started, "judge_rejected_all")
            metrics = self.feedback.metrics(
                request,
                normalized["candidateTaskTypes"],
                [tree.taskType for tree in accepted],
                normalized["rejected"],
                judge.score,
            )
            proposals = self._agent_proposals(workers, accepted)
            return PlanResponse(
                brainAgent="langchain_general_agent",
                stageAssessment=general.stageAssessment or stage.objective or self._stage_summary(request),
                agentProposals=proposals,
                taskRequests=accepted,
                behaviorTrees=accepted,
                constraints=[
                    "langchain_structured_output",
                    "catalog_task_whitelist",
                    "blocked_task_penalty",
                    "quantitative_feedback_scoring",
                ],
                confidence=max(0.1, min(1.0, (general.confidence * 0.65) + (judge.score * 0.35))),
                durationMs=(time.perf_counter() - started) * 1000,
                decisionMetrics=metrics,
                feedbackPolicy={"historySize": len(self.feedback.history), "maxTrees": self.cfg.max_trees_per_response},
            )
        except Exception as exc:
            return self._fallback(request, started, f"planner_error:{type(exc).__name__}")

    async def _run_stage(self, request: BrainRequest) -> StagePlan:
        return await self._invoke(
            STAGE_SYSTEM,
            self.stage_parser,
            request,
            schema_vars={"allowed_tasks": ", ".join(self.allowed_tasks)},
            payload={"role": "stage_planner"},
        )

    async def _run_workers(self, request: BrainRequest, stage: StagePlan, active_agents: list[str]) -> list[WorkerPlan]:
        if self.cfg.parallel_agents:
            tasks = [self._run_worker(request, stage, agent_id) for agent_id in active_agents]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            return [item for item in results if isinstance(item, WorkerPlan)]
        workers: list[WorkerPlan] = []
        for agent_id in active_agents:
            try:
                workers.append(await self._run_worker(request, stage, agent_id))
            except Exception:
                continue
        return workers

    async def _run_worker(self, request: BrainRequest, stage: StagePlan, agent_id: str) -> WorkerPlan:
        spec = AGENT_SPECS.get(agent_id)
        agent_tasks = ", ".join(spec.tasks if spec else [])
        return await self._invoke(
            WORKER_SYSTEM,
            self.worker_parser,
            request,
            schema_vars={"agent_id": agent_id, "agent_tasks": agent_tasks},
            payload={"role": "worker", "agentId": agent_id, "stage": stage.model_dump()},
            timeout_s=self.cfg.agent_timeout_s,
        )

    async def _run_general(self, request: BrainRequest, stage: StagePlan, workers: list[WorkerPlan]) -> GeneralPlan:
        return await self._invoke(
            GENERAL_SYSTEM,
            self.general_parser,
            request,
            schema_vars={"allowed_tasks": ", ".join(self.allowed_tasks), "max_trees": self.cfg.max_trees_per_response},
            payload={"role": "general_agent", "stage": stage.model_dump(), "workers": [worker.model_dump() for worker in workers]},
        )

    async def _run_judge(self, request: BrainRequest, accepted: list[BehaviorTreeRequest], rejected: list[dict[str, Any]]) -> JudgePlan:
        return await self._invoke(
            JUDGE_SYSTEM,
            self.judge_parser,
            request,
            schema_vars={},
            payload={"role": "judge", "selectedTasks": [tree.model_dump() for tree in accepted], "rejected": rejected},
            timeout_s=min(self.cfg.agent_timeout_s, 10.0),
        )

    async def _invoke(
        self,
        system_template: str,
        parser: PydanticOutputParser,
        request: BrainRequest,
        *,
        schema_vars: dict[str, Any],
        payload: dict[str, Any],
        timeout_s: float | None = None,
    ) -> Any:
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_template),
            ("human", "Live request JSON:\n{request_json}\n\nAgent payload JSON:\n{payload_json}"),
        ])
        messages = prompt.format_messages(
            format_instructions=parser.get_format_instructions(),
            request_json=self._compact_request(request),
            payload_json=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            **schema_vars,
        )
        chat_messages = [self._message_to_dict(message) for message in messages]
        response = await asyncio.wait_for(
            self.client.chat(chat_messages, temperature=self.cfg.response_temperature, json_mode=True),
            timeout=timeout_s or self.cfg.agent_timeout_s,
        )
        raw = self._extract_content(response)
        return self._parse(parser, raw)

    def _extract_content(self, response: Any) -> str:
        if isinstance(response, str):
            return response
        if isinstance(response, dict):
            if response.get("ok") is False:
                raise RuntimeError(str(response.get("error") or "llm_request_failed"))
            content = response.get("content")
            if isinstance(content, str) and content.strip():
                return content
        raise RuntimeError("llm_empty_response")

    def _parse(self, parser: PydanticOutputParser, raw: str) -> Any:
        try:
            return parser.parse(raw)
        except Exception:
            start = raw.find("{")
            end = raw.rfind("}")
            if start >= 0 and end > start:
                return parser.pydantic_object.model_validate(json.loads(raw[start:end + 1]))
            raise

    def _message_to_dict(self, message: Any) -> dict[str, str]:
        role = "user"
        if getattr(message, "type", None) == "system":
            role = "system"
        elif getattr(message, "type", None) == "ai":
            role = "assistant"
        return {"role": role, "content": str(message.content)}

    def _compact_request(self, request: BrainRequest) -> str:
        payload = request.model_dump(mode="json", exclude_none=True)
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return text[: self.cfg.max_context_chars]

    def _active_agents(self, request: BrainRequest, stage: StagePlan | None = None) -> list[str]:
        active = list(stage.activeAgents if stage else [])
        rule_task = request.ruleDecision.type if request.ruleDecision else None
        if request.snapshot.environmentHazard or request.snapshot.navigationTrap or request.snapshot.isInLava or request.snapshot.oxygen_low or rule_task in {"escape_hazard", "escape_pit", "descend_from_platform", "eat_food", "recover_starvation", "hold_position"}:
            active.append("safety_agent")
        if request.snapshot.hostile_nearby or rule_task in {"evade_hostiles", "defend_shelter", "defend_self"}:
            active.append("combat_agent")
        if request.snapshot.food_low or rule_task in {"hunt_food", "collect_wood", "explore", "collect_wool", "collect_crop_seeds", "plant_crops"}:
            active.append("survival_agent")
        if rule_task in {"craft_basic_supplies", "craft_basic_tools", "collect_stone", "craft_stone_tools", "craft_furnace", "craft_weapon", "collect_building_materials", "build_shelter", "build_animal_pen", "lure_animals", "mine_advanced_materials"}:
            active.append("engineering_agent")
        if not active:
            active.append("survival_agent")
        deduped: list[str] = []
        for agent_id in active:
            if agent_id in AGENT_SPECS and agent_id not in deduped:
                deduped.append(agent_id)
        return deduped[:4]

    def _normalize_tasks(self, request: BrainRequest, selected: Iterable[TaskDraft], workers: list[WorkerPlan]) -> dict[str, Any]:
        drafts = list(selected)
        if not drafts:
            for worker in workers:
                drafts.extend(worker.tasks)
        if request.ruleDecision:
            drafts.insert(0, TaskDraft(taskType=request.ruleDecision.type, reason=request.ruleDecision.reason or "live rule task"))

        accepted: list[BehaviorTreeRequest] = []
        rejected: list[dict[str, Any]] = []
        seen: set[str] = set()
        candidate_task_types: list[str] = []
        for draft in drafts[:12]:
            normalized = normalize_task_type(draft.taskType)
            if not normalized:
                rejected.append({"taskType": draft.taskType, "reason": "invalid_task"})
                continue
            candidate_task_types.append(normalized)
            if normalized in seen:
                rejected.append({"taskType": normalized, "reason": "duplicate_task"})
                continue
            score = self.feedback.score_task(normalized, request)
            if score.blocked and score.score < 0.35:
                rejected.append({"taskType": normalized, "reason": "blocked_task", "score": score.score})
                continue
            tree = BehaviorTreeRequest.from_task(
                normalized,
                source_agent=agent_for_task(normalized),
                requested_by="langchain_general_agent",
                reason=(draft.reason or score.reason)[:180],
                constructor_args=self._sanitize_constructor_args(draft.constructorArgs),
                task_request_id=f"lc-{len(accepted) + 1}-{normalized}",
            )
            if not tree:
                rejected.append({"taskType": normalized, "reason": "invalid_task"})
                continue
            accepted.append(tree)
            seen.add(normalized)
            if len(accepted) >= self.cfg.max_trees_per_response:
                break
        accepted.sort(key=lambda item: task_priority(item.taskType), reverse=True)
        return {"accepted": accepted, "rejected": rejected, "candidateTaskTypes": candidate_task_types}

    def _sanitize_constructor_args(self, args: dict[str, Any] | None) -> dict[str, Any]:
        if not isinstance(args, dict):
            return {}
        clean: dict[str, Any] = {}
        for key, value in args.items():
            if key not in {"count", "radius", "searchRadius", "target", "targetPosition", "mode", "area", "tool", "preferredTerrain", "allowNight", "allowAquaticHunt"}:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                clean[key] = value
            elif isinstance(value, dict):
                clean[key] = {item_key: item_value for item_key, item_value in value.items() if item_key in {"x", "y", "z"} and isinstance(item_value, (int, float))}
        return clean

    def _apply_judge(self, accepted: list[BehaviorTreeRequest], judge: JudgePlan) -> list[BehaviorTreeRequest]:
        if not judge.acceptedTasks:
            return accepted if judge.score >= 0.45 else []
        accepted_set = {normalize_task_type(task) for task in judge.acceptedTasks}
        return [tree for tree in accepted if tree.taskType in accepted_set]

    def _agent_proposals(self, workers: list[WorkerPlan], accepted: list[BehaviorTreeRequest]) -> list[AgentProposal]:
        accepted_by_agent: dict[str, list[BehaviorTreeRequest]] = {}
        for tree in accepted:
            accepted_by_agent.setdefault(tree.sourceAgent, []).append(tree)
        proposals: list[AgentProposal] = []
        worker_ids = {worker.agentId for worker in workers}
        for worker in workers:
            proposals.append(AgentProposal(
                agentId=worker.agentId,
                active=worker.active,
                reason=worker.reason,
                trees=accepted_by_agent.get(worker.agentId, []),
            ))
        for agent_id, trees in accepted_by_agent.items():
            if agent_id not in worker_ids:
                proposals.append(AgentProposal(agentId=agent_id, active=True, reason="rule_task_injected", trees=trees))
        return proposals

    def _fallback(self, request: BrainRequest, started: float, reason: str) -> PlanResponse:
        rule_task = request.ruleDecision.type if request.ruleDecision else "explore"
        blocked_score = self.feedback.score_task(rule_task, request)
        if blocked_score.blocked and blocked_score.score < 0.35:
            rule_task = "explore"
        tree = BehaviorTreeRequest.from_task(rule_task, reason=reason, requested_by="langchain_fallback")
        trees = [tree] if tree else []
        metrics = self.feedback.metrics(request, [rule_task], [item.taskType for item in trees], [], None)
        return PlanResponse(
            brainAgent="langchain_fallback",
            stageAssessment=self._stage_summary(request),
            agentProposals=[AgentProposal(agentId=agent_for_task(rule_task), active=True, reason=reason, trees=trees)] if trees else [],
            taskRequests=trees,
            behaviorTrees=trees,
            constraints=["fallback_rule_task", "catalog_task_whitelist", "quantitative_feedback_scoring"],
            confidence=0.45,
            durationMs=(time.perf_counter() - started) * 1000,
            decisionMetrics=metrics,
            feedbackPolicy={"historySize": len(self.feedback.history), "maxTrees": self.cfg.max_trees_per_response},
        )

    def _stage_summary(self, request: BrainRequest) -> str:
        rule_task = request.ruleDecision.type if request.ruleDecision else "explore"
        return f"rule={rule_task}; hp={request.snapshot.health}; food={request.snapshot.food}; night={request.snapshot.isNight}"