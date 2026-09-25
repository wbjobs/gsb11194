/*
 * worker.js — 状态计算 Worker：所有状态归约、分支可见性、跳步校验都在这里执行。
 * 主线程只发送意图（action），不直接修改状态。
 */
importScripts('wizard-core.js');
const Core = self.WizardCore;

let state = Core.initialState();

function respond(id, msg) {
  self.postMessage(Object.assign({ id }, msg));
}

self.onmessage = function (e) {
  const { id, type } = e.data;
  try {
    switch (type) {
      case 'dispatch': {
        const r = Core.applyAction(state, e.data.action);
        if (r.ok) state = r.state;
        respond(id, {
          ok: r.ok, error: r.error || null, fieldErrors: r.fieldErrors || null,
          state, view: Core.computeView(state),
        });
        break;
      }
      case 'restore': { // 从序列化草稿恢复（回放事件日志重建）
        state = Core.deserialize(e.data.payload);
        respond(id, { ok: true, state, view: Core.computeView(state) });
        break;
      }
      case 'replay': { // 回放到第 upto 条事件（不含当前实时状态之外的写）
        const s = Core.replay(state.log, e.data.upto);
        respond(id, { ok: true, replayState: s, view: Core.computeView(s) });
        break;
      }
      case 'serialize':
        respond(id, { ok: true, payload: Core.serialize(state) });
        break;
      case 'get':
        respond(id, { ok: true, state, view: Core.computeView(state) });
        break;
      default:
        respond(id, { ok: false, error: `未知消息类型: ${type}` });
    }
  } catch (err) {
    respond(id, { ok: false, error: String((err && err.message) || err) });
  }
};
