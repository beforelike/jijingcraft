# 006 - LLM 调用超时排查

## 问题

Dashboard 偶发显示 LLM `request_timeout_30000ms`。实际 BOT 和 Dashboard 仍在运行，LLM 也有成功调用记录，但某些 planner 请求会被本地 30 秒超时截断。

## 检查结果

- `/api/status.llm.recentCalls` 显示最近多次 planner 调用大多成功，耗时约 16 到 29.7 秒。
- 超时记录耗时约 30.0 秒，错误为 `request_timeout_30000ms`。
- 超时记录没有工具调用和工具结果，说明不是工具循环卡住，而是模型接口单次响应接近或超过本地超时阈值。
- LLM 配置本身有效：Dashboard 显示 `enabled=true`，模型和 base host 正常，后续 planner 调用可恢复为 `ok`。

## 处理

- 将代码默认 `LLM_TIMEOUT_MS` 从 30000 调整为 60000。
- 将 `.env.example` 和当前本地 `.env` 的 `LLM_TIMEOUT_MS` 调整为 60000。
- README 增加 `LLM_TIMEOUT_MS=60000` 说明，避免慢响应模型被误判为不可用。

## 影响

- LLM dry-run planner 最多会等待 60 秒，但仍是后台旁路规划，不会阻塞安全规则执行。
- 若模型服务真正不可用，Dashboard 仍会记录错误；只是避免 30 秒临界点导致的误报超时。

## 最新观察

- 低血无食物 live 验证中仍出现过一次 `request_timeout_60000ms`，同时前后存在 `ok`/`accepted` 调用记录。
- 这说明 60 秒超时仍可能由模型服务慢响应触发，但不会导致 BOT 停止、退出或跳过硬安全；当前场景下 `recover_starvation` 继续由规则层执行，LLM 结果只作为安全队列建议。
- Dashboard 中也可能出现 `non_queueable_tasks` 拒绝记录，这是安全队列按白名单和硬安全规则过滤 LLM 输出的正常行为。