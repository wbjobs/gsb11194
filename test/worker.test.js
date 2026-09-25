/* Worker 协议冒烟测试：用 vm 模拟 Web Worker 环境（self/importScripts/postMessage） */
'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

const outbox = [];
const sandbox = {
  self: {},
  console,
  importScripts(file) {
    vm.runInContext(read(file), sandbox, { filename: file });
  },
};
sandbox.self.postMessage = (msg) => outbox.push(msg);
vm.createContext(sandbox);
vm.runInContext(read('worker.js'), sandbox, { filename: 'worker.js' });

function send(msg) {
  sandbox.self.onmessage({ data: msg });
  // 跨 vm realm 的对象原型不同，经 JSON 往返后再断言（postMessage 本身也是结构化克隆）
  return JSON.parse(JSON.stringify(outbox.pop()));
}

// dispatch: 非法跳步
let r = send({ id: 1, type: 'dispatch', action: { type: 'jump', to: 's5' } });
assert.equal(r.ok, false);
assert.ok(r.error.includes('禁止跳步'));

// dispatch: 填写 + 前进
r = send({ id: 2, type: 'dispatch', action: { type: 'answer', step: 's1', data: { name: '张三', userType: 'personal' } } });
assert.equal(r.ok, true);
assert.deepEqual(r.view.visible, ['s1', 's2', 's4', 's5']);
r = send({ id: 3, type: 'dispatch', action: { type: 'next' } });
assert.equal(r.ok, true);
assert.equal(r.state.current, 's2');

// serialize -> restore（模拟刷新恢复）
const saved = send({ id: 4, type: 'serialize' }).payload;
r = send({ id: 5, type: 'restore', payload: saved });
assert.equal(r.ok, true);
assert.equal(r.state.current, 's2');
assert.equal(r.state.answers.s1.name, '张三');

// replay
r = send({ id: 6, type: 'replay', upto: 1 });
assert.equal(r.ok, true);
assert.equal(r.replayState.current, 's1');
assert.equal(r.replayState.answers.s1.userType, 'personal');

console.log('Worker 协议冒烟测试全部通过');
