---
description: Describe when these instructions should be loaded by the agent based on task context
# applyTo: 'Describe when these instructions should be loaded by the agent based on task context' # when provided, instructions will automatically be added to the request context when the pattern matches an attached file
---

<!-- Tip: Use /create-instructions in chat to generate content with agent assistance -->

1：遵守git 工作流，禁止在main分支直接提交，必须通过feature分支和pull request流程进行开发和代码审查。
2：开发前请先在项目管理工具（如Jira、Trello）上创建对应的任务卡片，并在PR描述中关联任务卡片ID。
3：编写清晰的commit message，遵循约定的格式（如 Conventional Commits），以便于版本控制和发布日志生成。
4：在代码中添加必要的注释，特别是复杂的逻辑和算法部分，确保其他开发者能够理解代码意图。
5：编写单元测试覆盖新功能和关键逻辑，确保代码质量和稳定性。测试代码应与生产代码分开存放。
6: 开发过程中必须要维护TODO文件夹的开发文档，将出现的问题，检查结果，解决办法，产生影响等等开发和测试过程中遇到的情况追加新文档记录在对应的文档中，文档命名规则为：TODO/序号_简要描述.md，例如TODO/001_autonomous_task_planning.md。
7: 定期更新README文件，记录项目的最新状态、已完成的功能、已知问题和未来计划，确保文档与代码保持同步。
