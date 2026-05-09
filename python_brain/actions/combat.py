"""Combat primitives: attack, defend, flee."""

from __future__ import annotations

from dataclasses import dataclass

from .base import (
    DiagnoseCheck,
    DiagnoseDomain,
    DiagnoseSpec,
    MonitorMetric,
    MonitorSpec,
    PrimitiveAction,
)


@dataclass
class AttackAction(PrimitiveAction):
    """Attack a target entity until it dies or action times out.

    Example: attack(entity={"name": "zombie", "id": 42})
    """
    action_type: str = "attack"
    entity: dict[str, object] | None = None  # {name, id, position}
    weapon: str | None = None                  # preferred weapon type

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.ENTITY_HEALTH,
            check_interval_ms=150,
            stall_threshold_ms=1500,
            min_progress_per_check=0.05,
            extra_params={"entityId": self.entity.get("id") if self.entity else None},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_TARGET, priority=1,
                          extra_params={"entity": self.entity}),
            DiagnoseCheck(domain=DiagnoseDomain.TOOL_CHECK, priority=2,
                          check_name=self.weapon,
                          extra_params={"check_weapon": True}),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=3),
        ])


@dataclass
class DefendAction(PrimitiveAction):
    """Hold position and attack any hostile that comes within range.

    Example: defend(timeout_ms=5000)
    """
    action_type: str = "defend"
    timeout_ms: int = 5000

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BOT_HEALTH,
            check_interval_ms=200,
            stall_threshold_ms=3000,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_NEARBY, priority=1,
                          extra_params={"radius": 10, "check_hostile": True}),
            DiagnoseCheck(domain=DiagnoseDomain.TOOL_CHECK, priority=2,
                          extra_params={"check_weapon": True}),
        ])


@dataclass
class FleeAction(PrimitiveAction):
    """Run away from an entity for a minimum distance.

    Example: flee(from_entity={"name": "creeper", "id": 7}, distance=20)
    """
    action_type: str = "flee"
    from_entity: dict[str, object] | None = None
    distance: float = 20.0

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.ENTITY_PROXIMITY,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=0.1,
            extra_params={
                "entityId": self.from_entity.get("id") if self.from_entity else None,
                "targetDistance": self.distance,
            },
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_TARGET, priority=1,
                          extra_params={"entity": self.from_entity}),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=2,
                          offset={"x": 0, "y": 0, "z": 0}, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_NEARBY, priority=3,
                          extra_params={"radius": 3}),
        ])
