# 5 步分支表单向导

原生技术栈实现的多步表单：IndexedDB 草稿持久化 + DOM 渲染 + Web Worker 状态计算，无构建步骤、无外部依赖。

## 运行

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080 （Web Worker 要求 http(s) 环境，不能直接 file:// 打开）
```

## 测试

```bash
node test/core.test.js    # 状态机逻辑：17 个用例覆盖全部验收标准
node test/worker.test.js  # Worker 消息协议冒烟测试
```

## 表单结构（分支与合并）

| 步骤 | 内容 | 可见条件 |
| ---- | ---- | -------- |
| s1 | 基本信息（姓名、用户类型） | 始终 |
| s2 | 个人资料 | s1 选「个人用户」 |
| s3 | 企业信息 | s1 选「企业用户」 |
| s4 | 配送方式（快递时地址必填） | 始终（**合并点**） |
| s5 | 确认提交（信息汇总 + 确认勾选） | 始终（**合并点**） |

## 架构

```
index.html          页面骨架
css/style.css       样式
js/wizard-core.js   状态计算核心（纯函数）：步骤 schema、可见性、校验、
                    事件归约、跳步合法性、序列化 / 回放。Worker 与测试共用
js/worker.js        Web Worker：持有唯一状态，响应 dispatch/restore/replay/serialize
js/db.js            IndexedDB 封装（库 form-wizard / 表 drafts）
js/app.js           DOM 渲染与交互：步骤条、表单、草稿自动保存、导入导出、回放面板
test/               Node 测试（核心 + Worker 协议）
```

### 关键设计：事件日志是唯一事实来源

- 状态 `state = { answers, current, log, seq }`，其中 `answers`/`current` 都可由 `log` 回放重建。
- 每次「填写 / 导航」追加一条事件；**序列化只存日志**，恢复时 `replay(log)` 重建，
  因此「刷新恢复」「草稿分享」「状态回放」共用同一条代码路径，天然一致。
- 答案永不删除：分支切换、回退只改变可见性与当前位置，数据始终保留。

### 跳步合法性（Worker 内判定）

1. 目标步骤必须存在；
2. 目标步骤在当前分支下**可见**；
3. 目标步骤**可达**：其之前所有可见步骤均已通过校验。

违反任意一条即拒绝并返回原因（UI 以 toast 提示）。

## 验收标准对照

| 标准 | 实现 | 测试 |
| ---- | ---- | ---- |
| 任意步骤刷新后恢复 | 每次变更防抖 300ms 自动存入 IndexedDB，启动时恢复 | `core.test.js` 序列化用例 |
| 分支切换不丢数据 | 答案与可见性解耦，隐藏步骤数据保留 | 「切换用户类型后…」 |
| 回退后前进数据保留 | prev 只导航不清数据 | 「回退不丢数据…」 |
| 非法跳步被拒绝 | Worker 三重校验 + 错误原因 | 「非法跳步」3 例 |
| 状态可序列化为 JSON | `serialize()` 输出合法 JSON | 「状态可序列化…」 |
| 草稿可分享 | 导出 JSON / 复制 Base64 分享链接（`#draft=`）/ 导入 | `worker.test.js` restore |
| 状态回放正确 | 回放面板可逐步 / 自动播放；`replay(log, n)` 还原任意时刻 | 「状态回放」2 例 |
