# ABO — CLAUDE.md

本文件是 Claude Code 在 ABO 仓库内的入口参考。

**开发约束的唯一事实来源是 `AGENTS.md`。** 进入仓库后请先完整阅读 `AGENTS.md`，再阅读本文件中 Claude Code 专属的运行须知，最后再动代码。

如果本文件与 `AGENTS.md` 冲突，以 `AGENTS.md` 为准；发现冲突应同步更新本文件，而不是另起一套规则。

---

## 0. 先读 AGENTS.md

`AGENTS.md` 描述了 ABO 的产品三条主链、定时任务必须复用主动工具链的最高优先级规则、单一事实来源层级、新需求落地顺序、前后端约束以及常见坑。这些都是项目级约束，对 Claude Code、Codex 以及任何后续代理同样生效。

下文不重复这些内容，只补充 Claude Code 在这个仓库里的工作方式。

---

## 1. 最小阅读顺序（Claude Code 版）

1. `AGENTS.md` — 开发约束
2. `README.md` — 外部介绍与核心能力
3. `docs/abo-user-guide.md` — 用户视角的产品现状
4. `docs/LLM-wiki.md` — Wiki 维护心智
5. 相关模块的实现代码
6. 本文件 `CLAUDE.md`

如果只看旧文档不看代码，很容易沿着已经废弃的路径继续开发。

---

## 2. 工作目录

- 主工作目录始终是 `/Users/huanc/Desktop/ABO/`。
- 默认在主工作树的 `main` 分支上推进开发，不要新开 `git worktree` 作为日常开发路径。
- 仓库中可能残留的旧 worktree 视为历史产物，不在其中继续落新改动。

---

## 3. Git 工作方式

遵循 `AGENTS.md §4.5`：

1. 默认直接在主工作树 + `main` 分支上推进。
2. 提交前确认当前目录是主仓库目录，再执行 `git add` 和 `git commit`。
3. 较大改动（端到端切片完成、UI/数据链路接通、多文件重构、修完一组相关 bug）后主动提交一次，不要长期堆积。
4. 提交信息直接描述阶段完成了什么，便于回退与追踪。
5. 仅在用户明确要求时才 `git push`。

---

## 4. 技术栈速查

- Shell：Tauri 2.x
- 后端：Python + FastAPI + APScheduler，入口 `python -m abo.main`，端口 `:8765`
- 前端：React + TypeScript + Tailwind + Zustand，入口 `npm run dev`，端口 `:1420`
- 数据：Markdown + SQLite FTS5 + JSON（`~/.abo/`）
- LLM：`claude --print` 子进程，不使用 API key

详细架构与 API 路由以代码为准；如发现本节落后，以代码现状为准并同步更新本文件。

---

## 5. 常用命令

```bash
python -m abo.main          # 后端 :8765
npm run dev                 # 前端 :1420
npx tsc --noEmit            # 类型检查
npx vite build              # 构建
git status && git diff      # 提交前确认
```

---

## 6. Claude Code 专属注意点

1. **优先使用 Read / Edit / Write，避免用 Bash 做文件读写。**
2. **多步任务用 TodoWrite 跟踪进度**，完成一项立刻标记。
3. **独立的工具调用尽量并行。**
4. **不要重建 `AGENT.md`**（注意：不带 S）。当前仓库以 `AGENTS.md` 为准，旧的 `AGENT.md` 已被删除，除非用户明确要求否则不要恢复。
5. **本文件 (`CLAUDE.md`) 只承担入口与 Claude 专属运行须知**；产品级与工程级规则全部回到 `AGENTS.md`。

---

## 7. 完成一项改动前最少要验证什么

直接遵循 `AGENTS.md §10` 的三类清单（采集/监控类、库/Wiki/助手类、角色/仪表板/生活类）。不要在这里复制一份会随时漂移的副本。

---

## 8. 对 Claude Code 最重要的一句话

引用 `AGENTS.md §11`：

> 让已有输入更顺地流进系统，让已有内容更稳地沉下来，让已有知识更容易被再次调用。

如果一个改动同时让 `入口更清楚`、`链路更一致`、`沉淀更稳定`，那通常就是好改动。
