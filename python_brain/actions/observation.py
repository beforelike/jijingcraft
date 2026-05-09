"""Observation primitives: scan_blocks, scan_entities, check_inventory."""

from __future__ import annotations

from dataclasses import dataclass, field

from .base import (
    DiagnoseCheck,
    DiagnoseDomain,
    DiagnoseSpec,
    MonitorMetric,
    MonitorSpec,
    PrimitiveAction,
)


@dataclass
class ScanBlocksAction(PrimitiveAction):
    """Scan for specific block types within a radius.

    Example: scan_blocks(radius=16, block_types=["oak_log", "cobblestone"])
    """
    action_type: str = "scan_blocks"
    radius: float = 16.0
    block_types: list[str] = field(default_factory=list)

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.TIME_ELAPSED,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=1),
        ])


@dataclass
class ScanEntitiesAction(PrimitiveAction):
    """Scan for entities within a radius.

    Example: scan_entities(radius=32, types=["hostile"], names=["zombie", "skeleton"])
    """
    action_type: str = "scan_entities"
    radius: float = 32.0
    types: list[str] = field(default_factory=list)   # "hostile", "passive", "item"
    names: list[str] = field(default_factory=list)    # specific entity names

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.TIME_ELAPSED,
            check_interval_ms=200,
            stall_threshold_ms=1000,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.POSITION_CHECK, priority=1),
        ])


@dataclass
class CheckInventoryAction(PrimitiveAction):
    """Check inventory for specific items or get full snapshot.

    Example: check_inventory(items=["oak_log", "cobblestone"])
    """
    action_type: str = "check_inventory"
    items: list[str] = field(default_factory=list)

    def _build_monitor(self) -> MonitorSpec:
        return MonitorSpec(
            metric=MonitorMetric.TIME_ELAPSED,
            check_interval_ms=200,
            stall_threshold_ms=500,
            min_progress_per_check=0.0,
        )

    def _build_diagnose(self) -> DiagnoseSpec:
        return DiagnoseSpec(checks=[
            DiagnoseCheck(domain=DiagnoseDomain.INVENTORY_CHECK, priority=1),
        ])
