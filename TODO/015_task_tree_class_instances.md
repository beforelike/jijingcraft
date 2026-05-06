# 015 Task Tree Class Instances

## 用户问题

用户进一步明确架构：基础任务应像编程中的函数，任务树应像类，LLM 思考后只负责传入参数实例化对应任务树来完成任务。

## 检查结果

- 现有 `taskRequests` 已能进入 `BehaviorExecutionQueue`，并带 `parameters`。
- `buildExecutableBehaviorTree()` 还主要暴露 `taskType/nodes/parameters`，缺少清晰的类实例元数据。
- `execute_task` 已能把 `parameters` 传给 `executePrimitive()`，但 primitive 参数消费不统一，主要集中在 `collect_wood`。
- Dashboard 显示等级和任务类型，但没有直接显示“类实例 + 构造参数”。

## 解决办法

- 行为树实例新增 `treeClass`、`taskFunction`、`constructorArgs`、`parameterSchema`。
- 新增构造参数规范化逻辑，统一处理 `parameters/constructorArgs/args/quantity/targetPosition` 等别名。
- 显式传入的顶层构造参数会覆盖默认值，例如 `count: 3` 不再被 `CollectWoodTree` 默认 `count: 4` 覆盖。
- LLM planner prompt 改成明确要求输出 class-instance envelope，不输出节点内部或执行代码。
- LLM context 新增 `taskTreeClasses`，让模型知道可实例化的任务树类、函数名、等级和构造参数 schema。
- `BehaviorExecutionQueue` 状态摘要保留类名、函数名、构造参数和参数 schema。
- `SurvivalController` 新增统一取参 helper，并让 `collect_wood`、`collect_stone`、`collect_building_materials`、`explore` 消费构造参数。
- Dashboard LLM 面板显示 `TreeClass(key=value)` 形式，便于观察 LLM 是否真的在实例化任务树。
- `HuntFoodTree` 能识别 controller 返回的目标选择结果包；没有直接动物目标时会委托 `huntFood()` 基础函数执行植物采集/探索换区，而不是误报 `hunt_target_invalid`。
- `hold_position/wait_out_night` 这类被动安全任务不再因“没有位移/物品变化”被判定为失败。

## 影响

- LLM 的输出职责更接近“选择类并传构造参数”。
- 本地代码仍然拥有任务优先级、等级、schema 和 primitive 执行权威。
- 旧的 `parameters` 字段继续兼容，内部统一映射为 `constructorArgs`。
- 后续可以继续把更多 primitive 扩展为强参数化函数，例如 `hunt_food(count,target,searchRadius)`、`build_shelter(origin,size,materials)`。

## 验证计划

- 行为树构造测试：确认类名、函数名、构造参数、schema 正确生成。
- 队列测试：确认 smart brain task request 入队后保留 constructor args。
- controller 测试：确认参数能真正到达 primitive 函数。
- LLM/Dashboard 测试：确认上下文和状态面板能暴露类实例信息。

## 验证结果

- `node --test test/behaviorExecution.test.js` 通过，覆盖构造参数覆盖、目标选择结果包、无目标狩猎委托和被动安全任务验证。
- `npm test` 通过，263/263。
- VS Code Problems 检查无错误。
- 已重启 `npm start`，Dashboard 位于 `http://127.0.0.1:3000`，网页显示任务等级与 `HuntFoodTree()`、`CollectStoneTree(count=10, searchRadius=8, targetPosition=...)` 类实例；运行日志中无目标狩猎已变为 `action=hunt_food; no nearby food mobs, exploring for animals`，不再是 `hunt_target_invalid`。
