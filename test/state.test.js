/*
 * 验收标准自动化测试（Node 直接运行状态引擎，逻辑与 Worker 内完全一致）：
 *   node test/state.test.js
 */
'use strict';

const assert = require('node:assert');
const schema = require('../js/schema.js');
const engine = require('../js/state.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error('    ' + err.message);
    process.exitCode = 1;
  }
}

function answer(state, step, field, value) {
  return engine.answer(schema, state, step, field, value).state;
}
function nav(state, kind, to) {
  return engine.navigate(schema, state, { kind, to });
}

console.log('5 步分支表单 — 状态引擎验收测试\n');

// ---------- 1. 分支可见性与合并 ----------
test('初始仅第 1 步可见（分支步骤等待答案）', () => {
  const s = engine.createInitialState(schema);
  assert.deepStrictEqual(
    engine.computeVisibleSteps(schema, s.answers),
    ['account', 'plan', 'confirm']
  );
});

test('选择 personal 后出现 personal 分支，company 被剪枝', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  assert.deepStrictEqual(
    engine.computeVisibleSteps(schema, s.answers),
    ['account', 'personal', 'plan', 'confirm']
  );
});

test('分支合并：personal/company 两条分支都合并到 plan', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'company');
  const visible = engine.computeVisibleSteps(schema, s.answers);
  assert.deepStrictEqual(visible, ['account', 'company', 'plan', 'confirm']);
  assert.ok(visible.indexOf('plan') !== -1, '合并步骤 plan 必须在路径上');
});

// ---------- 2. 分支切换不丢数据 ----------
test('切换分支后旧分支数据保留', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  s = answer(s, 'personal', 'fullName', '张三');
  s = answer(s, 'personal', 'age', 30);
  // 切换分支
  s = answer(s, 'account', 'accountType', 'company');
  assert.deepStrictEqual(engine.computeVisibleSteps(schema, s.answers),
    ['account', 'company', 'plan', 'confirm']);
  assert.strictEqual(s.answers.personal.fullName, '张三', 'personal 数据必须保留');
  assert.strictEqual(s.answers.personal.age, 30);
  // 切回来数据还在
  s = answer(s, 'account', 'accountType', 'personal');
  assert.strictEqual(s.answers.personal.fullName, '张三');
});

// ---------- 3. 回退后前进数据保留 ----------
test('上一步/下一步往返后数据不丢', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  let r = nav(s, 'next'); assert.ok(r.ok); s = r.state; // -> personal
  s = answer(s, 'personal', 'fullName', '李四');
  s = answer(s, 'personal', 'age', 25);
  r = nav(s, 'next'); assert.ok(r.ok); s = r.state;      // -> plan
  r = nav(s, 'prev'); assert.ok(r.ok); s = r.state;      // 回退 -> personal
  r = nav(s, 'prev'); assert.ok(r.ok); s = r.state;      // 回退 -> account
  r = nav(s, 'next'); assert.ok(r.ok); s = r.state;      // 前进 -> personal
  assert.strictEqual(s.answers.personal.fullName, '李四', '回退再前进后数据必须保留');
  assert.strictEqual(s.answers.personal.age, 25);
});

// ---------- 4. 非法跳步被拒绝 ----------
test('跳到不可见分支步骤被拒绝', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  const r = nav(s, 'jump', 'company');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /不可见/);
});

test('越过未到达步骤的跳步被拒绝', () => {
  const s = engine.createInitialState(schema);
  const r = nav(s, 'jump', 'confirm'); // confirm 可见但未到达
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /越过/);
});

test('跳到不存在的步骤被拒绝', () => {
  const s = engine.createInitialState(schema);
  const r = nav(s, 'jump', 'no-such-step');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /不存在/);
});

test('必填项未完成时不能下一步', () => {
  const s = engine.createInitialState(schema);
  const r = nav(s, 'next');
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /必填/);
});

test('已到达的步骤之间可以自由跳步', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  let r = nav(s, 'next'); s = r.state;                       // personal
  s = answer(s, 'personal', 'fullName', '王五');
  s = answer(s, 'personal', 'age', 40);
  r = nav(s, 'next'); s = r.state;                           // plan
  r = nav(s, 'jump', 'account'); assert.ok(r.ok); s = r.state; // 跳回
  r = nav(s, 'jump', 'plan'); assert.ok(r.ok); s = r.state;    // 跳去
  assert.strictEqual(s.currentStep, 'plan');
});

// ---------- 5. 状态序列化 / 草稿恢复 ----------
test('状态可序列化为 JSON 并完整恢复（模拟刷新）', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'company');
  s = answer(s, 'company', 'companyName', '测试公司');
  s = answer(s, 'company', 'taxId', '91110000XYZ');
  let r = nav(s, 'next'); s = r.state;
  r = nav(s, 'next'); s = r.state; // -> plan

  const json = engine.serialize(s);
  assert.strictEqual(typeof json, 'string');
  JSON.parse(json); // 必须是合法 JSON

  const restored = engine.deserialize(json); // 模拟刷新后从 IndexedDB 恢复
  assert.deepStrictEqual(restored, s);
  assert.strictEqual(restored.currentStep, 'plan');
  assert.strictEqual(restored.answers.company.companyName, '测试公司');
});

test('非法草稿被拒绝', () => {
  assert.throws(() => engine.deserialize('{"version":99,"state":{}}'), /版本/);
  assert.throws(() => engine.deserialize('{"version":1}'), /state/);
  assert.throws(() => engine.deserialize('not json'), /JSON|token|Unexpected/i);
});

// ---------- 6. 状态回放 ----------
test('回放能重现每个事件后的状态', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  let r = nav(s, 'next'); s = r.state;
  s = answer(s, 'personal', 'fullName', '赵六');
  s = answer(s, 'personal', 'age', 28);
  r = nav(s, 'next'); s = r.state;

  const { snapshots, final } = engine.replay(schema, s.history);
  assert.deepStrictEqual(final, s, '回放终态必须与实际状态一致');
  assert.strictEqual(snapshots.length, s.history.length + 1); // 含初始快照
  assert.strictEqual(snapshots[0].event, null, '首个快照是初始状态');

  // 第 2 个事件（nav next）之后，当前步骤应为 personal
  const afterNav = snapshots[2];
  assert.strictEqual(afterNav.state.currentStep, 'personal');
  assert.deepStrictEqual(afterNav.visibleSteps, ['account', 'personal', 'plan', 'confirm']);
});

test('回放分支切换：可见步骤随答案事件变化', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  s = answer(s, 'account', 'accountType', 'company');
  const { snapshots } = engine.replay(schema, s.history);
  assert.ok(snapshots[1].visibleSteps.includes('personal'));
  assert.ok(!snapshots[2].visibleSteps.includes('personal'));
  assert.ok(snapshots[2].visibleSteps.includes('company'));
});

// ---------- 7. 提交 ----------
test('全部可见步骤完成后可提交，提交数据只含可见步骤', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  s = answer(s, 'personal', 'fullName', '张三');
  s = answer(s, 'personal', 'age', 30);
  // 制造隐藏分支的残留数据
  s = answer(s, 'company', 'companyName', '不该被提交');
  s = answer(s, 'plan', 'plan', 'free');
  s = answer(s, 'confirm', 'agree', true);

  const r = engine.submit(schema, s);
  assert.ok(r.ok, '提交应成功: ' + (r.reason || ''));
  const data = engine.submittedData(schema, r.state);
  assert.ok(data.personal, '提交数据包含 personal');
  assert.ok(!data.company, '提交数据不包含被剪枝的 company 分支');
});

test('有未完成步骤时提交被拒绝', () => {
  let s = engine.createInitialState(schema);
  s = answer(s, 'account', 'accountType', 'personal');
  const r = engine.submit(schema, s);
  assert.strictEqual(r.ok, false);
});

console.log('\n' + passed + ' 项测试通过' + (process.exitCode ? '（存在失败）' : ''));
