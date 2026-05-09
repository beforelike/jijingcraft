"""Primitive action system for Minecraft survival bot.

Layered architecture:
  Layer 1 — PrimitiveAction: walk, jump, mine, place, eat, attack, collect...
            Each action = params + monitor() + diagnose()
  Layer 2 — Task: compose(Action₁, Action₂, ... | condition)
  Layer 3 — TaskTree: compose(Task₁, Task₂, ...)

All actions are Python @dataclass objects compiled to JSON for Node.js execution.
"""

from .base import (
    PrimitiveAction,
    ActionContext,
    MonitorResult,
    FailureReport,
    MonitorSpec,
    DiagnoseCheck,
    DiagnoseSpec,
    CompiledAction,
)

from .movement import WalkAction, JumpAction, SwimAction, SneakToAction
from .interaction import MineAction, PlaceAction, EatAction, UseItemAction, CollectAction, PickupAction
from .combat import AttackAction, DefendAction, FleeAction
from .crafting import CraftAction, SmeltAction
from .building import PlaceRowAction, PlaceWallAction, FillAreaAction
from .observation import ScanBlocksAction, ScanEntitiesAction, CheckInventoryAction
from .utility import WaitAction, EquipAction, UnequipAction, DropAction
from .compiler import ActionCompiler, compile_action
from .catalog import ACTION_CATALOG, get_action_class

__all__ = [
    # base
    "PrimitiveAction",
    "ActionContext",
    "MonitorResult",
    "FailureReport",
    "MonitorSpec",
    "DiagnoseCheck",
    "DiagnoseSpec",
    "CompiledAction",
    # movement
    "WalkAction",
    "JumpAction",
    "SwimAction",
    "SneakToAction",
    # interaction
    "MineAction",
    "PlaceAction",
    "EatAction",
    "UseItemAction",
    "CollectAction",
    "PickupAction",
    # combat
    "AttackAction",
    "DefendAction",
    "FleeAction",
    # crafting
    "CraftAction",
    "SmeltAction",
    # building
    "PlaceRowAction",
    "PlaceWallAction",
    "FillAreaAction",
    # observation
    "ScanBlocksAction",
    "ScanEntitiesAction",
    "CheckInventoryAction",
    # utility
    "WaitAction",
    "EquipAction",
    "UnequipAction",
    "DropAction",
    # compiler
    "ActionCompiler",
    "compile_action",
    # catalog
    "ACTION_CATALOG",
    "get_action_class",
]
