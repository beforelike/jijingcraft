"""Movement primitives: walk, jump, swim, sneak_to."""

from __future__ import annotations

from dataclasses import dataclass, field

from .base import (
    DiagnoseCheck,
    DiagnoseDomain,
    DiagnoseSpec,
    Direction,
    MonitorMetric,
    MonitorSpec,
    PrimitiveAction,
)


def _ensure_direction(value: Direction | str | None) -> Direction | None:
    if value is None:
        return None
    if isinstance(value, Direction):
        return value
    try:
        return Direction(str(value).lower())
    except ValueError:
        return None


@dataclass
class WalkAction(PrimitiveAction):
    """Walk in a cardinal direction for N steps.

    Example: walk(Direction.EAST, steps=10, speed=1.0)
    """
    action_type: str = "walk"
    direction: Direction | str = Direction.EAST
    steps: int = 1
    speed: float = 1.0

    def __post_init__(self) -> None:
        self.direction = _ensure_direction(self.direction) or Direction.EAST

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.POSITION_DELTA,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=0.05,
            extra_params={"direction": self.direction.vec},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=1,
                          offset=self.direction.vec, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_BELOW, priority=2,
                          offset={"x": 0, "y": -1, "z": 0}, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.ENTITY_NEARBY, priority=3,
                          extra_params={"radius": 2}),
        ])


@dataclass
class JumpAction(PrimitiveAction):
    """Perform a single jump (optionally while moving in a direction).

    Example: jump() or jump(direction=Direction.EAST)
    """
    action_type: str = "jump"
    direction: Direction | str | None = None

    def __post_init__(self) -> None:
        self.direction = _ensure_direction(self.direction)

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.POSITION_DELTA,
            check_interval_ms=100,
            stall_threshold_ms=500,
            min_progress_per_check=0.05,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        checks = [
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=1,
                          offset={"x": 0, "y": 1, "z": 0}, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_BELOW, priority=2,
                          offset={"x": 0, "y": -1, "z": 0}, check_solid=True),
        ]
        if self.direction:
            checks.insert(0, DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=0,
                                            offset=self.direction.vec, check_solid=True))
        return DiagnoseSpec(checks=checks)


@dataclass
class SwimAction(PrimitiveAction):
    """Swim in a direction for a distance (blocks).

    Example: swim(direction=Direction.UP, distance=3)
    """
    action_type: str = "swim"
    direction: Direction | str = Direction.UP
    distance: float = 1.0

    def __post_init__(self) -> None:
        self.direction = _ensure_direction(self.direction) or Direction.UP

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.POSITION_DELTA,
            check_interval_ms=200,
            stall_threshold_ms=2000,  # water movement is slower
            min_progress_per_check=0.02,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=1,
                          offset=self.direction.vec, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=2,
                          offset={"x": 0, "y": 1, "z": 0}, check_solid=True,
                          extra_params={"check_water_surface": True}),
        ])


@dataclass
class SneakToAction(PrimitiveAction):
    """Sneak (walk carefully) to a specific position. Used at edges/cliffs.

    Example: sneak_to(position={"x": 10, "y": 64, "z": -5})
    """
    action_type: str = "sneak_to"
    position: dict[str, float] = field(default_factory=dict)  # noqa: F821

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.POSITION_DELTA,
            check_interval_ms=200,
            stall_threshold_ms=1500,
            min_progress_per_check=0.03,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=1,
                          offset={"x": 0, "y": -1, "z": 0}, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=2),
        ])
