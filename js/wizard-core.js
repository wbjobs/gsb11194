/*
 * wizard-core.js — 5 步分支表单的状态计算核心（纯函数，无 DOM/Worker 依赖）
 * 同时被 Web Worker（importScripts）和 Node 测试（require）使用。
 *
 * 状态模型：
 *   state = { answers: {stepId: {field: value}}, current: stepId, log: [event], seq: n }
 * 事件日志是唯一事实来源；answers/current 均可由 log 回放（replay）重建。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WizardCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const VERSION = 1;

  // ---------- 步骤与分支配置 ----------
  // visibleIf 决定分支；s4/s5 恒可见，是分支合并点。
  const STEPS = [
    {
      id: 's1',
      title: '基本信息',
      visibleIf: () => true,
      fields: [
        { name: 'name', label: '姓名', type: 'text', required: true, placeholder: '请输入姓名' },
        {
          name: 'userType', label: '用户类型', type: 'radio', required: true,
          options: [
            { value: 'personal', label: '个人用户' },
            { value: 'company', label: '企业用户' },
          ],
        },
      ],
    },
    {
      id: 's2',
      title: '个人资料',
      visibleIf: (a) => a.s1 && a.s1.userType === 'personal',
      fields: [
        { name: 'idNumber', label: '身份证号', type: 'text', required: true,
          pattern: /^\d{15}(\d{2}[0-9Xx])?$/, patternMsg: '身份证号须为 15 或 18 位' },
        { name: 'hobby', label: '爱好', type: 'text', placeholder: '选填' },
      ],
    },
    {
      id: 's3',
      title: '企业信息',
      visibleIf: (a) => a.s1 && a.s1.userType === 'company',
      fields: [
        { name: 'companyName', label: '企业名称', type: 'text', required: true },
        { name: 'taxId', label: '统一社会信用代码', type: 'text', required: true,
          pattern: /^[0-9A-Z]{18}$/, patternMsg: '须为 18 位数字或大写字母' },
      ],
    },
    {
      id: 's4',
      title: '配送方式',
      visibleIf: () => true, // 合并点：两条分支在此汇合
      fields: [
        {
          name: 'delivery', label: '配送方式', type: 'radio', required: true,
          options: [
            { value: 'express', label: '快递配送' },
            { value: 'pickup', label: '门店自提' },
          ],
        },
        { name: 'address', label: '收货地址', type: 'text',
          requiredIf: (a) => a.s4 && a.s4.delivery === 'express',
          placeholder: '选择快递配送时必填' },
      ],
    },
    {
      id: 's5',
      title: '确认提交',
      visibleIf: () => true, // 合并点
      confirm: true,
      fields: [
        { name: 'confirmed', label: '我已核对以上信息，确认无误', type: 'checkbox', required: true },
      ],
    },
  ];

  const stepById = (id) => STEPS.find((s) => s.id === id);

  // ---------- 派生计算 ----------
  function visibleSteps(answers) {
    return STEPS.filter((s) => s.visibleIf(answers)).map((s) => s.id);
  }

  function validateStep(stepId, answers) {
    const step = stepById(stepId);
    if (!step) return { ok: false, errors: { _: '未知步骤' } };
    const data = answers[stepId] || {};
    const errors = {};
    for (const f of step.fields) {
      const required = typeof f.requiredIf === 'function' ? !!f.requiredIf(answers) : !!f.required;
      const v = data[f.name];
      const empty = v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true);
      if (required && empty) {
        errors[f.name] = `「${f.label}」为必填项`;
        continue;
      }
      if (!empty && f.pattern && typeof v === 'string' && !f.pattern.test(v)) {
        errors[f.name] = f.patternMsg || `「${f.label}」格式不正确`;
      }
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }

  // 视图：可见序列、完成态、可达性（前置可见步骤全部完成才可达）
  function computeView(state) {
    const visible = visibleSteps(state.answers);
    const completed = {};
    const errors = {};
    for (const id of visible) {
      const r = validateStep(id, state.answers);
      completed[id] = r.ok;
      errors[id] = r.errors;
    }
    const reachable = {};
    let blocked = false;
    for (const id of visible) {
      reachable[id] = !blocked;
      if (!completed[id]) blocked = true;
    }
    return { visible, completed, reachable, errors };
  }

  // ---------- 状态归约 ----------
  function initialState() {
    return { answers: {}, current: STEPS[0].id, log: [], seq: 0 };
  }

  const clone = (s) => JSON.parse(JSON.stringify(s));

  function applyEvent(state, event) {
    const next = clone(state);
    next.log.push(event);
    next.seq = event.seq;
    if (event.type === 'answer') {
      next.answers[event.step] = Object.assign({}, next.answers[event.step], event.data);
    } else if (event.type === 'nav') {
      next.current = event.to;
    }
    return next;
  }

  function replay(log, upto) {
    let s = initialState();
    const n = upto == null ? log.length : Math.max(0, Math.min(upto, log.length));
    for (let i = 0; i < n; i++) s = applyEvent(s, log[i]);
    return s;
  }

  function ok(state) {
    return { ok: true, state, view: computeView(state) };
  }
  function fail(state, error, fieldErrors) {
    return { ok: false, state, view: computeView(state), error, fieldErrors: fieldErrors || null };
  }

  function nav(state, to, ts) {
    return applyEvent(state, { type: 'nav', from: state.current, to, seq: state.seq + 1, ts: ts || Date.now() });
  }

  // 动作派发：所有合法性校验都在这里（Worker 内）完成
  function applyAction(state, action) {
    const view = computeView(state);
    switch (action.type) {
      case 'answer': {
        const step = stepById(action.step);
        if (!step) return fail(state, `未知步骤: ${action.step}`);
        if (!step.visibleIf(state.answers)) return fail(state, `步骤「${step.title}」当前不可见，无法填写`);
        // 同一步骤的连续填写合并为一条事件，避免打字产生海量日志（回放仍是同一结果）
        const last = state.log[state.log.length - 1];
        let next;
        if (last && last.type === 'answer' && last.step === action.step) {
          next = clone(state);
          next.log[next.log.length - 1] = Object.assign({}, last, {
            data: Object.assign({}, last.data, action.data), ts: action.ts || Date.now(),
          });
          next.answers[action.step] = Object.assign({}, next.answers[action.step], action.data);
        } else {
          next = applyEvent(state, {
            type: 'answer', step: action.step, data: action.data, seq: state.seq + 1, ts: action.ts || Date.now(),
          });
        }
        // 兜底：答案导致当前步骤被分支隐藏时，退到第一个可见步骤
        const vis = visibleSteps(next.answers);
        if (!vis.includes(next.current)) next.current = vis[0];
        return ok(next);
      }
      case 'next': {
        const idx = view.visible.indexOf(state.current);
        if (idx === -1) return fail(state, '当前步骤不在可见序列中');
        if (!view.completed[state.current]) {
          return fail(state, '当前步骤校验未通过，请先补全必填项', view.errors[state.current]);
        }
        if (idx === view.visible.length - 1) return fail(state, '已是最后一步');
        return ok(nav(state, view.visible[idx + 1], action.ts));
      }
      case 'prev': {
        const idx = view.visible.indexOf(state.current);
        if (idx === -1) return fail(state, '当前步骤不在可见序列中');
        if (idx <= 0) return fail(state, '已是第一步');
        // 回退永远允许，且不清空任何答案
        return ok(nav(state, view.visible[idx - 1], action.ts));
      }
      case 'jump': {
        const target = action.to;
        const step = stepById(target);
        if (!step) return fail(state, `目标步骤不存在: ${target}`);
        if (target === state.current) return ok(state); // 原地跳转视为无操作
        if (!view.visible.includes(target)) {
          return fail(state, `目标步骤「${step.title}」在当前分支下不可见`);
        }
        if (!view.reachable[target]) {
          return fail(state, `前置步骤未完成，禁止跳步到「${step.title}」`);
        }
        return ok(nav(state, target, action.ts));
      }
      case 'reset':
        return ok(initialState());
      default:
        return fail(state, `未知动作: ${action.type}`);
    }
  }

  // ---------- 序列化 / 反序列化 ----------
  // 只持久化事件日志；answers/current 由回放重建，保证可校验、可回放。
  function serialize(state) {
    return JSON.stringify({ version: VERSION, savedAt: Date.now(), log: state.log });
  }

  function deserialize(text) {
    let obj = text;
    if (typeof text === 'string') {
      try { obj = JSON.parse(text); } catch (e) { throw new Error('草稿不是合法的 JSON'); }
    }
    if (!obj || obj.version !== VERSION) throw new Error('草稿版本不兼容');
    if (!Array.isArray(obj.log)) throw new Error('草稿缺少事件日志');
    for (const ev of obj.log) {
      if (!ev || typeof ev.seq !== 'number' || !ev.type) throw new Error('事件日志损坏');
    }
    return replay(obj.log);
  }

  return {
    VERSION, STEPS,
    visibleSteps, validateStep, computeView,
    initialState, applyEvent, applyAction, replay,
    serialize, deserialize,
  };
});
