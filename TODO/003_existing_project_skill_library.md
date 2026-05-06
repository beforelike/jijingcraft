# 003 Existing Project Skill Library Integration

## 目标

用户要求结合仓库里的现成项目继续优化当前 BOT，让功能更完整。当前服务器运行环境是 Node/Mineflayer，不能直接把 Forge/Fabric 模组作为运行时依赖，因此本轮选择把现成项目中的可移植模式落到当前项目：

- 借鉴 TouhouLittleMaid 的 `SkillLoader`、`ToolRegister` 和 `skill.md` 思路，新增受控生存技能库。
- 借鉴 Patchouli 的 book/category/entry JSON 结构，导出可检索知识书。
- 借鉴 Ponderer 的 scene/steps JSON 结构，导出可复盘的技能步骤演示。
- 借鉴 Voyager 的技能循环思想，把高层技能与底层安全动作解耦，为后续 LLM 规划留下接口。

## 已实现

- 新增 `src/knowledge/survivalSkills.js`，包含前期石器、启动食物、可复用庇护所、夜间安全和地表采石 5 个高层技能。
- 每个技能声明任务顺序、前置条件、成功条件、安全规则和来源模式。
- 新增任务白名单校验，后续 LLM/tool 调用只能组合当前控制器支持的安全任务。
- `SurvivalController` 决策日志新增 `skill=...`，运行时能看到当前低层动作属于哪个高层技能。
- 新增 `src/knowledge/exportKnowledge.js` 和 `npm run export:knowledge`，可生成 `data/knowledge` 下的技能摘要、Patchouli 风格 JSON 和 Ponderer 风格 JSON。
- 新增 `test/knowledgeExport.test.js`，覆盖技能摘要、任务白名单、Patchouli 条目、Ponderer 场景和实际文件导出。
- 清理 `.env.example` 的 API Key 示例，改为占位符。

## 继续优化记录

- 新增 `src/knowledge/skillPlanner.js`，把技能转成可校验的任务计划，并支持按当前低层任务推荐高层技能。
- 新增 `src/knowledge/toolRegistry.js`，提供 `list_survival_skills`、`get_survival_skill`、`plan_survival_skill`、`validate_task_sequence` 和 `recommend_survival_skill` 五个受控工具。
- `ToolRegistry` 支持工具唯一 ID 校验、上下文 trigger guard 和统一错误返回，避免外部调用直接抛异常打断主循环。
- `SurvivalController` 的 `lastAction` 现在记录 `skillPlan`，用于后续失败复盘和 LLM 上下文，但执行仍保持单轮单任务，避免外部计划绕过安全状态机。
- `data/knowledge/survival-skills.json` 现在会包含工具清单，方便第二阶段 prompt 直接暴露可调用能力。
- 新增 `test/toolRegistry.test.js`，覆盖技能计划、技能推荐、工具注册、trigger guard、未知工具、未知技能和非法任务序列。

## 下一步

- 把 `ToolRegistry` 接入第二阶段 LLM prompt，让模型只能调用受控工具或选择白名单任务，不直接生成任意 Mineflayer 代码。
- 将失败学习数据转成 Ponderer 风格复盘文件，方便观察“为什么某个采集/撤离动作失败”。
- 给庇护所生成更接近 Patchouli multiblock 的蓝图描述，后续可用于稳定复用门洞、墙体和屋顶计划。