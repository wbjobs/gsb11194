/* 验收标准测试：node test/core.test.js */
'use strict';
const assert = require('node:assert/strict');
const Core = require('../js/wizard-core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}
const run = (state, action) => Core.applyAction(state, action);
const mustOk = (state, action) => {
  const r = run(state, action);
  assert.ok(r.ok, `期望成功但被拒绝: ${r.error}`);
  return r.state;
};
const mustFail = (state, action, msgPart) => {
  const r = run(state, action);
  assert.ok(!r.ok, '期望被拒绝但成功了');
  if (msgPart) assert.ok(r.error.includes(msgPart), `错误信息应包含「${msgPart}」，实际: ${r.error}`);
  return r;
};

// 便捷：填满个人分支 / 企业分支
function fillPersonal(s) {
  s = mustOk(s, { type: 'answer', step: 's1', data: { name: '张三', userType: 'personal' } });
  s = mustOk(s, { type: 'answer', step: 's2', data: { idNumber: '110101199001011234', hobby: '读书' } });
  return s;
}
function fillCompany(s) {
  s = mustOk(s, { type: 'answer', step: 's1', data: { name: '李四', userType: 'company' } });
  s = mustOk(s, { type: 'answer', step: 's3', data: { companyName: '示例科技', taxId: '91110000MA01C8Y12A' } });
  return s;
}

console.log('分支可见性');
test('初始仅 s1/s4/s5 可见，s2/s3 由 s1 答案决定', () => {
  const v = Core.computeView(Core.initialState());
  assert.deepEqual(v.visible, ['s1', 's4', 's5']);
  let s = mustOk(Core.initialState(), { type: 'answer', step: 's1', data: { userType: 'personal' } });
  assert.deepEqual(Core.computeView(s).visible, ['s1', 's2', 's4', 's5']);
  s = mustOk(s, { type: 'answer', step: 's1', data: { userType: 'company' } });
  assert.deepEqual(Core.computeView(s).visible, ['s1', 's3', 's4', 's5']);
});

test('分支合并：两条分支都汇合到 s4/s5', () => {
  for (const fill of [fillPersonal, fillCompany]) {
    let s = fill(Core.initialState());
    s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'pickup' } });
    const v = Core.computeView(s);
    assert.ok(v.visible.includes('s4') && v.visible.includes('s5'));
    assert.ok(v.reachable.s5, '分支完成后 s5 应可达');
  }
});

console.log('下一步 / 上一步');
test('未通过校验时 next 被拒绝并返回字段错误', () => {
  const r = mustFail(Core.initialState(), { type: 'next' }, '校验未通过');
  assert.ok(r.fieldErrors.name && r.fieldErrors.userType);
});

test('个人分支路径 s1→s2→s4→s5，自动跳过 s3', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'next' });
  assert.equal(s.current, 's2');
  s = mustOk(s, { type: 'next' });
  assert.equal(s.current, 's4'); // s3 被分支跳过
});

test('回退不丢数据，前进后数据仍保留', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'express', address: '北京市海淀区' } });
  s = mustOk(s, { type: 'jump', to: 's4' }); // 前置均已完成，合法
  s = mustOk(s, { type: 'prev' }); // 回退到 s2
  assert.equal(s.current, 's2');
  assert.equal(s.answers.s2.idNumber, '110101199001011234', '回退后 s2 数据保留');
  s = mustOk(s, { type: 'next' }); // 再前进到 s4
  assert.equal(s.current, 's4');
  assert.equal(s.answers.s4.address, '北京市海淀区', '前进后 s4 数据保留');
});

test('prev 在第一步被拒绝', () => {
  mustFail(Core.initialState(), { type: 'prev' }, '已是第一步');
});

console.log('分支切换');
test('切换用户类型后，原分支数据不丢失', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'answer', step: 's1', data: { userType: 'company' } });
  assert.deepEqual(Core.computeView(s).visible, ['s1', 's3', 's4', 's5']);
  assert.equal(s.answers.s2.idNumber, '110101199001011234', 's2 隐藏后数据仍保留');
  s = mustOk(s, { type: 'answer', step: 's1', data: { userType: 'personal' } });
  assert.equal(s.answers.s2.idNumber, '110101199001011234', '切回后 s2 数据仍在');
});

test('在隐藏步骤上填写被拒绝', () => {
  let s = mustOk(Core.initialState(), { type: 'answer', step: 's1', data: { userType: 'personal' } });
  mustFail(s, { type: 'answer', step: 's3', data: { companyName: 'x' } }, '不可见');
});

console.log('非法跳步');
test('跳到不存在的步骤被拒绝', () => {
  mustFail(Core.initialState(), { type: 'jump', to: 's99' }, '不存在');
});

test('跳到分支未激活的步骤被拒绝', () => {
  let s = mustOk(Core.initialState(), { type: 'answer', step: 's1', data: { userType: 'personal' } });
  mustFail(s, { type: 'jump', to: 's3' }, '不可见');
});

test('前置步骤未完成时向前跳步被拒绝', () => {
  mustFail(Core.initialState(), { type: 'jump', to: 's4' }, '禁止跳步');
  mustFail(Core.initialState(), { type: 'jump', to: 's5' }, '禁止跳步');
  let s = fillPersonal(Core.initialState());
  // s4 未填，跳 s5 仍非法
  mustFail(s, { type: 'jump', to: 's5' }, '禁止跳步');
  // s4 完成后跳 s5 合法
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'pickup' } });
  s = mustOk(s, { type: 'jump', to: 's5' });
  assert.equal(s.current, 's5');
});

test('允许向回跳到任意已可见步骤', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'jump', to: 's4' });
  s = mustOk(s, { type: 'jump', to: 's1' });
  assert.equal(s.current, 's1');
});

console.log('条件必填');
test('快递配送时地址必填，自提时不必填', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'express' } });
  assert.ok(!Core.computeView(s).completed.s4, '未填地址时 s4 不应完成');
  s = mustOk(s, { type: 'answer', step: 's4', data: { address: '上海市黄浦区' } });
  assert.ok(Core.computeView(s).completed.s4);
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'pickup', address: '' } });
  assert.ok(Core.computeView(s).completed.s4, '自提时地址可空');
});

console.log('序列化 / 草稿恢复');
test('状态可序列化为 JSON 并完整恢复（模拟刷新）', () => {
  let s = fillPersonal(Core.initialState());
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'express', address: '广州市天河区' } });
  s = mustOk(s, { type: 'jump', to: 's4' });
  const json = Core.serialize(s);
  assert.doesNotThrow(() => JSON.parse(json), '必须是合法 JSON');
  const restored = Core.deserialize(json); // 模拟刷新后从 IndexedDB 恢复
  assert.deepEqual(restored, s, '恢复后状态应与序列化前完全一致');
});

test('损坏 / 不兼容的草稿被拒绝', () => {
  assert.throws(() => Core.deserialize('not json'), /JSON/);
  assert.throws(() => Core.deserialize('{"version":999,"log":[]}'), /版本/);
  assert.throws(() => Core.deserialize('{"version":1}'), /日志/);
});

console.log('状态回放');
test('回放完整日志 == 当前状态', () => {
  let s = fillCompany(Core.initialState());
  s = mustOk(s, { type: 'answer', step: 's4', data: { delivery: 'pickup' } });
  s = mustOk(s, { type: 'jump', to: 's5' });
  assert.deepEqual(Core.replay(s.log), s);
});

test('部分回放可还原任意历史时刻', () => {
  let s = Core.initialState();
  const snapshots = [s];
  for (const a of [
    { type: 'answer', step: 's1', data: { name: '王五', userType: 'personal' } },
    { type: 'answer', step: 's2', data: { idNumber: '110101199001011234' } },
    { type: 'next' }, { type: 'next' },
  ]) {
    s = mustOk(s, a);
    snapshots.push(s);
  }
  for (let i = 0; i < snapshots.length; i++) {
    assert.deepEqual(Core.replay(s.log, i), snapshots[i], `回放到第 ${i} 条事件应一致`);
  }
  // 回放第 1 条事件后（已选 personal），可见性应已切换
  const mid = Core.replay(s.log, 1);
  assert.deepEqual(Core.computeView(mid).visible, ['s1', 's2', 's4', 's5']);
});

test('同一步骤的连续填写合并为一条事件，且结果不变', () => {
  let s = Core.initialState();
  s = mustOk(s, { type: 'answer', step: 's1', data: { name: '张' } });
  s = mustOk(s, { type: 'answer', step: 's1', data: { name: '张三' } });
  s = mustOk(s, { type: 'answer', step: 's1', data: { userType: 'personal' } });
  assert.equal(s.log.length, 1, '连续填写同一步骤应合并');
  assert.deepEqual(s.answers.s1, { name: '张三', userType: 'personal' });
  assert.deepEqual(Core.replay(s.log), s, '合并后回放结果不变');
  // 中间穿插导航则不合并
  s = mustOk(s, { type: 'answer', step: 's2', data: { idNumber: '110101199001011234' } });
  assert.equal(s.log.length, 2);
});

console.log(`\n${passed} 个测试${process.exitCode ? '存在失败' : '全部通过'}`);
