"""ActionCompiler — converts Python PrimitiveAction instances to JSON for Node.js."""

from __future__ import annotations

from typing import Any

from .base import CompiledAction, PrimitiveAction
from .catalog import ACTION_CATALOG, ActionSpec


class ActionCompiler:
    """Compiles Python PrimitiveAction to Node.js-executable JSON.

    The compiled output contains:
      - actionId: unique identifier
      - type: action handler name (e.g. "walk", "mine")
      - params: typed parameters
      - monitor: declarative monitor spec (metric, thresholds)
      - diagnose: ordered diagnosis checklist
    """

    @staticmethod
    def compile(action: PrimitiveAction) -> CompiledAction:
        return action.compile()

    @staticmethod
    def compile_task(task: Any) -> dict[str, Any]:
        """Compile a Task (list of actions + conditions) to JSON.

        Task format:
          {
            "taskType": "collect_wood",
            "actions": [WalkAction(...), MineAction(...), CollectAction(...)],
            "conditions": {"until": "count >= 4", "maxRetries": 3}
          }
        """
        if hasattr(task, "actions"):
            return {
                "taskType": getattr(task, "task_type", "unknown"),
                "actions": [ActionCompiler.compile(a).to_dict() for a in task.actions],
                "conditions": getattr(task, "conditions", {}),
            }
        return {}

    @staticmethod
    def compile_tree(tree: Any) -> dict[str, Any]:
        """Compile a TaskTree (list of tasks with dependencies) to JSON.

        Tree format:
          {
            "treeType": "build_shelter",
            "tasks": [
              {"task": explore_task, "dependsOn": []},
              {"task": collect_task, "dependsOn": ["explore"]},
              ...
            ]
          }
        """
        if hasattr(tree, "tasks"):
            return {
                "treeType": getattr(tree, "tree_type", "unknown"),
                "tasks": [
                    {
                        "task": ActionCompiler.compile_task(t["task"]),
                        "dependsOn": t.get("dependsOn", []),
                    }
                    for t in tree.tasks
                ],
            }
        return {}

    @staticmethod
    def build_action_from_request(
        action_type: str,
        params: dict[str, Any] | None = None,
    ) -> PrimitiveAction | None:
        """Factory: create a PrimitiveAction from type string + params dict.

        Used when the LangGraph agent requests an action by type name.
        """
        spec = ACTION_CATALOG.get(action_type)
        if spec is None:
            return None
        try:
            return spec.action_class(**(params or {}))
        except TypeError:
            return None


def compile_action(action: PrimitiveAction) -> CompiledAction:
    """Convenience function to compile a single action."""
    return action.compile()
