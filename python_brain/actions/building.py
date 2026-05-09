"""Building primitives: place_row, place_wall, fill_area."""

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
class PlaceRowAction(PrimitiveAction):
    """Place a row of blocks in a direction.

    Example: place_row(block_type="oak_planks", start={"x":0,"y":64,"z":0}, direction=Direction.EAST, count=5)
    """
    action_type: str = "place_row"
    block_type: str = ""
    start: dict[str, float] = field(default_factory=dict)
    direction: Direction | str = Direction.EAST
    count: int = 1

    def __post_init__(self) -> None:
        self.direction = _ensure_direction(self.direction) or Direction.EAST

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BLOCK_PLACED,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=1.0,
            target_value=float(self.count),
            extra_params={"count": self.count},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.block_type, check_count=self.count),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_AHEAD, priority=2,
                          offset=self.direction.vec, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=3),
        ])


@dataclass
class PlaceWallAction(PrimitiveAction):
    """Place a vertical wall (width × height blocks).

    Example: place_wall(block_type="cobblestone", start={"x":0,"y":64,"z":0},
                        direction=Direction.EAST, width=5, height=4)
    """
    action_type: str = "place_wall"
    block_type: str = ""
    start: dict[str, float] = field(default_factory=dict)
    direction: Direction | str = Direction.EAST
    width: int = 3
    height: int = 3

    def __post_init__(self) -> None:
        self.direction = _ensure_direction(self.direction) or Direction.EAST

    def _build_monitor(self) -> MonitorSpec:
        total = self.width * self.height
        return MonitorSpec(
            metric=MonitorMetric.BLOCK_PLACED,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=1.0,
            target_value=float(total),
            extra_params={"total": total},
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        total = self.width * self.height
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.block_type, check_count=total),
            DiagnoseCheck(domain=DiagnoseDomain.BLOCK_BELOW, priority=2,
                          offset={"x": 0, "y": -1, "z": 0}, check_solid=True),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=3),
        ])


@dataclass
class FillAreaAction(PrimitiveAction):
    """Fill a 2D area defined by two corners (floor fill).

    Example: fill_area(block_type="stone", corner1={"x":0,"y":63,"z":0}, corner2={"x":5,"y":63,"z":5})
    """
    action_type: str = "fill_area"
    block_type: str = ""
    corner1: dict[str, float] = field(default_factory=dict)
    corner2: dict[str, float] = field(default_factory=dict)

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.BLOCK_PLACED,
            check_interval_ms=200,
            stall_threshold_ms=2000,
            min_progress_per_check=1.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1,
                          check_name=self.block_type),
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=2),
        ])
