# 5 步分支表单（IndexedDB + DOM + Web Worker）

一个零依赖的多步表单 Demo：分支可见性、分支合并、草稿自动保存、状态回放、草稿分享。

## 运行

```bash
python3 -m http.server 8000   # 或任意静态服务器（Web Worker 不能用 file:// 打开）
# 打开 http://localhost:8000
```

## 测试

```bash
node test/state.test.js   # 16 项验收测试，覆盖全部验收标准
```

## 架构

| 文件 | 职责 |
| --- | --- |
| `js/schema.js` | 5 步表单定义：步骤级 `visibleIf`（分支）+ 字段级 `visibleIf` |
| `js/state.js` | 纯函数状态引擎：可见性计算、导航校验、事件应用、回放、序列化 |
| `js/worker.js` | Web Worker：所有状态计算在此执行，主线程通过 reqId 配对调用 |
| `js/db.js` | IndexedDB 草稿持久层（`multistep-form/drafts`） |
| `js/app.js` | 主线程：DOM 渲染、Worker RPC、300ms 防抖自动保存、分享/回放 UI |

## 表单结构

1. **account** 账户类型（personal / company）→ 决定分支
2. **personal** 个人信息（仅 personal 可见）
3. **company** 企业信息（仅 company 可见）
4. **plan** 套餐选择（两分支在此合并；pro 时出现优惠码字段）
5. **confirm** 确认提交

## 关键设计

- **状态模型**：`{ answers, currentStep, visited, history, submitted }`，全部可 JSON 序列化。
  `answers` 保留所有分支的数据，切换分支只改可见性、不删数据。
- **事件溯源**：每次填写/导航/提交都追加到 `history`，回放 = 从初始状态逐事件重放。
- **跳步规则**：目标必须存在、当前分支可见、且不超过"已到达的最远可见步骤 + 1"，否则拒绝。
- **草稿恢复**：刷新后从 IndexedDB 恢复；`#draft=<base64url>` 分享链接优先级更高。
- **提交**：仅导出当前可见步骤的数据，隐藏分支的残留数据不会被提交。

## 验收标准对照

| 标准 | 实现 | 测试 |
| --- | --- | --- |
| 任意步骤刷新后恢复 | 每次变更防抖写入 IndexedDB，启动时恢复 | 序列化/恢复往返测试 |
| 分支切换不丢数据 | `answers` 按步骤 id 存储，不随可见性清除 | 「切换分支后旧分支数据保留」 |
| 回退后前进数据保留 | 导航事件不触碰 `answers` | 「上一步/下一步往返后数据不丢」 |
| 非法跳步被拒绝 | `validateNav` 三条规则 | 3 项非法跳步测试 |
| 状态可序列化为 JSON | `serialize` / `deserialize`（含版本与结构校验） | 往返 + 非法草稿测试 |
| 草稿可分享 | base64url 编码进 URL hash，支持导入 | — |
| 状态回放正确 | `replay` 逐事件重放并生成快照 | 2 项回放测试 |
