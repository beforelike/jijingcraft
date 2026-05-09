"""Base classes for the primitive action system.

Each PrimitiveAction:
  1. Declares typed parameters (direction, steps, block_type, count, ...)
  2. Defines monitor_spec — declarative progress detection (Node.js executes the loop)
  3. Defines diagnose_spec — declarative failure diagnosis (Node.js executes the checks)
  4. Compiled to JSON via ActionCompiler → sent to Node.js for Mineflayer execution
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4


# ── Enums ────────────────────────────────────────────────────────────────────

class Direction(str, Enum):
    NORTH = "north"
    SOUTH = "south"
    EAST = "east"
    WEST = "west"
    UP = "up"
    DOWN = "down"

    @property
    def vec(self) -> dict[str, float]:
        return {
            "north": {"x": 0, "y": 0, "z": -1},
            "south": {"x": 0, "y": 0, "z": 1},
            "east":  {"x": 1, "y": 0, "z": 0},
            "west":  {"x": -1, "y": 0, "z": 0},
            "up":    {"x": 0, "y": 1, "z": 0},
            "down":  {"x": 0, "y": -1, "z": 0},
        }[self.value]


class MonitorMetric(str, Enum):
    """What to measure for progress detection."""
    POSITION_DELTA = "position_delta"        # distance moved from start
    BLOCK_BREAKING = "block_breaking"        # breaking progress 0→1
    BLOCK_PLACED = "block_placed"            # target block appeared
    INVENTORY_COUNT = "inventory_count"      # item count change
    ENTITY_HEALTH = "entity_health"          # target entity hp change
    BOT_HEALTH = "bot_health"                # own health change
    BOT_FOOD = "bot_food"                    # saturation change
    ITEM_EQUIPPED = "item_equipped"          # held item changed
    TIME_ELAPSED = "time_elapsed"            # simple timer
    ENTITY_PROXIMITY = "entity_proximity"    # distance to target entity


class DiagnoseDomain(str, Enum):
    BLOCK_AHEAD = "block_ahead"
    BLOCK_BELOW = "block_below"
    BLOCK_TARGET = "block_target"
    ENTITY_NEARBY = "entity_nearby"
    INVENTORY_CHECK = "inventory_check"
    TOOL_CHECK = "tool_check"
    POSITION_CHECK = "position_check"
    ENTITY_TARGET = "entity_target"


# ── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class MonitorSpec:
    """Declarative monitor — Node.js polls this spec at check_interval_ms.

    When the monitored metric doesn't change for stall_threshold_ms,
    the action is flagged as stalled and diagnose_spec runs.
    """
    metric: MonitorMetric
    check_interval_ms: int = 200
    stall_threshold_ms: int = 1000
    min_progress_per_check: float = 0.05
    target_value: float | None = None  # for metrics like INVENTORY_COUNT (target count)
    extra_params: dict[str, Any] = field(default_factory=dict)


@dataclass
class DiagnoseCheck:
    """One diagnosis check — Node.js runs these in priority order when stalled."""
    domain: DiagnoseDomain
    priority: int = 0
    offset: dict[str, float] | None = None  # relative position offset
    check_solid: bool = False
    check_name: str | None = None
    check_count: int | None = None
    extra_params: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"domain": self.domain.value, "priority": self.priority}
        if self.offset is not None:
            d["offset"] = self.offset
        if self.check_solid:
            d["check_solid"] = True
        if self.check_name is not None:
            d["check_name"] = self.check_name
        if self.check_count is not None:
            d["check_count"] = self.check_count
        if self.extra_params:
            d.update(self.extra_params)
        return d


@dataclass
class DiagnoseSpec:
    """Ordered list of diagnosis checks — Node.js runs them in priority order.

    Each check produces a potential failure reason. First match wins.
    """
    checks: list[DiagnoseCheck] = field(default_factory=list)

    def to_list(self) -> list[dict[str, Any]]:
        return [c.to_dict() for c in sorted(self.checks, key=lambda c: c.priority)]


@dataclass
class MonitorResult:
    """Result of a single monitor poll tick."""
    progress: float          # 0.0 → 1.0
    stalled: bool            # True if no progress for stall_threshold_ms
    metrics: dict[str, Any] = field(default_factory=dict)
    stall_reason: str | None = None


@dataclass
class FailureReport:
    """Structured failure reason returned to Python for Planner consumption."""
    reason: str                         # machine-readable: "blocked_by_solid_block"
    detail: str = ""                    # human-readable: "stone at (12,64,-3)"
    suggestion: str = ""                # action hint: "reroute_or_jump"
    context: dict[str, Any] = field(default_factory=dict)  # raw diagnostic data

    def to_dict(self) -> dict[str, Any]:
        return {
            "reason": self.reason,
            "detail": self.detail,
            "suggestion": self.suggestion,
            "context": self.context,
        }


@dataclass
class ActionContext:
    """Snapshot passed to Node.js for monitor/diagnose evaluation."""
    start_position: dict[str, float] | None = None
    current_position: dict[str, float] | None = None
    start_time_ms: float = 0.0
    elapsed_ms: float = 0.0
    inventory_snapshot: dict[str, int] = field(default_factory=dict)
    held_item: str | None = None
    nearby_blocks: list[dict[str, Any]] = field(default_factory=list)
    nearby_entities: list[dict[str, Any]] = field(default_factory=list)
    target_entity: dict[str, Any] | None = None
    bot_health: float = 20.0
    bot_food: float = 20.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "startPosition": self.start_position,
            "currentPosition": self.current_position,
            "startTimeMs": self.start_time_ms,
            "elapsedMs": self.elapsed_ms,
            "inventorySnapshot": self.inventory_snapshot,
            "heldItem": self.held_item,
            "nearbyBlocks": self.nearby_blocks,
            "nearbyEntities": self.nearby_entities,
            "targetEntity": self.target_entity,
            "botHealth": self.bot_health,
            "botFood": self.bot_food,
        }


@dataclass
class CompiledAction:
    """Output of ActionCompiler — JSON-serializable dict sent to Node.js."""
    action_id: str
    type: str
    params: dict[str, Any]
    monitor: dict[str, Any]
    diagnose: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "actionId": self.action_id,
            "type": self.type,
            "params": self.params,
            "monitor": self.monitor,
            "diagnose": self.diagnose,
        }


# ── Abstract base ────────────────────────────────────────────────────────────

class PrimitiveAction(ABC):
    """Abstract base for all primitive Minecraft actions.

    Subclasses define:
      - action_type: str identifier matching Node.js handler
      - params as dataclass fields
      - _build_monitor() → MonitorSpec
      - _build_diagnose() → DiagnoseSpec
    """

    action_type: str = ""

    def __post_init__(self) -> None:
        if not self.action_type:
            raise TypeError(f"{type(self).__name__} must define action_type")

    @abstractmethod
    def _build_monitor(self) -> MonitorSpec:
        ...

    @abstractmethod
    def _build_diagnose(self) -> DiagnoseSpec:
        ...

    def to_params(self) -> dict[str, Any]:
        """Convert action fields to JSON-safe params dict for Node.js."""
        from dataclasses import fields

        result: dict[str, Any] = {}
        for f in fields(self):
            if f.name.startswith("_"):
                continue
            value = getattr(self, f.name)
            if isinstance(value, Enum):
                result[f.name] = value.value
            elif isinstance(value, (int, float, str, bool, type(None))):
                result[f.name] = value
            elif isinstance(value, dict):
                result[f.name] = value
            elif isinstance(value, (list, tuple)):
                result[f.name] = list(value)
            else:
                result[f.name] = str(value)
        return result

    def compile(self) -> CompiledAction:
        return CompiledAction(
            action_id=str(uuid4()),
            type=self.action_type,
            params=self.to_params(),
            monitor=self._build_monitor_spec_dict(),
            diagnose=self._build_diagnose().to_list(),
        )

    def _build_monitor_spec_dict(self) -> dict[str, Any]:
        spec = self._build_monitor()
        d: dict[str, Any] = {
            "metric": spec.metric.value,
            "checkIntervalMs": spec.check_interval_ms,
            "stallThresholdMs": spec.stall_threshold_ms,
            "minProgressPerCheck": spec.min_progress_per_check,
        }
        if spec.target_value is not None:
            d["targetValue"] = spec.target_value
        if spec.extra_params:
            d.update(spec.extra_params)
        return d

    def to_dict(self) -> dict[str, Any]:
        return self.compile().to_dict()
