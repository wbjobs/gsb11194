/*
 * 纯函数状态引擎：可见性计算、导航校验、事件应用、回放、序列化。
 * 不依赖 DOM / IndexedDB，可同时运行在 Web Worker 与 Node（测试）中。
 *
 * 状态模型（全部可 JSON 序列化）：
 *   {
 *     answers:   { [stepId]: { [field]: value } },  // 所有答案，含当前不可见分支（切分支不丢数据）
 *     currentStep: string,                          // 当前所在步骤 id
 *     visited:   { [stepId]: true },                // 到达过的步骤（用于跳步可达性判断）
 *     history:   [event],                           // 追加式事件日志（回放与草稿恢复的唯一事实来源）
 *     submitted: boolean
 *   }
 */
(function (root) {
  'use strict';

  var STATE_VERSION = 1;

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getStep(schema, stepId) {
    for (var i = 0; i < schema.steps.length; i++) {
      if (schema.steps[i].id === stepId) return schema.steps[i];
    }
    return null;
  }

  function evalCondition(cond, answers) {
    if (!cond) return true;
    var stepAnswers = answers[cond.step] || {};
    return stepAnswers[cond.field] === cond.equals;
  }

  /** 当前答案下可见的步骤 id 列表（分支解析 + 合并后的线性路径）。 */
  function computeVisibleSteps(schema, answers) {
    var visible = [];
    for (var i = 0; i < schema.steps.length; i++) {
      var step = schema.steps[i];
      if (evalCondition(step.visibleIf, answers)) visible.push(step.id);
    }
    return visible;
  }

  function isFieldVisible(field, answers) {
    return evalCondition(field.visibleIf, answers);
  }

  function isEmptyValue(value) {
    return value === undefined || value === null || value === '' ||
      (typeof value === 'number' && isNaN(value));
  }

  /** 步骤是否完成：所有"可见且必填"的字段都有值。 */
  function isStepComplete(schema, answers, stepId) {
    var step = getStep(schema, stepId);
    if (!step) return false;
    var stepAnswers = answers[stepId] || {};
    for (var i = 0; i < step.fields.length; i++) {
      var field = step.fields[i];
      if (!field.required) continue;
      if (!isFieldVisible(field, answers)) continue;
      var value = stepAnswers[field.name];
      if (field.type === 'checkbox') {
        if (value !== true) return false;
      } else if (isEmptyValue(value)) {
        return false;
      }
    }
    return true;
  }

  function createInitialState(schema) {
    var first = schema.steps[0].id;
    var visited = {};
    visited[first] = true;
    return {
      answers: {},
      currentStep: first,
      visited: visited,
      history: [],
      submitted: false
    };
  }

  /**
   * 导航校验。nav = { kind: 'next' | 'prev' | 'jump', to?: stepId }
   * 返回 { ok: boolean, to?: string, reason?: string }
   *
   * 跳步规则（非法跳步会被拒绝）：
   *   1. 目标步骤必须存在于 schema；
   *   2. 目标步骤在当前分支下必须可见（不能跳到被剪枝的分支）；
   *   3. 目标位置不能超过"已到达过的最远可见步骤 + 1"（不能越过未完成的步骤）。
   */
  function validateNav(schema, state, nav) {
    var visible = computeVisibleSteps(schema, state.answers);
    var curIdx = visible.indexOf(state.currentStep);

    if (nav.kind === 'next') {
      if (curIdx === -1) return { ok: false, reason: '当前步骤不在可见路径上' };
      if (!isStepComplete(schema, state.answers, state.currentStep)) {
        return { ok: false, reason: '请先完成当前步骤的必填项' };
      }
      if (curIdx >= visible.length - 1) return { ok: false, reason: '已经是最后一步' };
      return { ok: true, to: visible[curIdx + 1] };
    }

    if (nav.kind === 'prev') {
      if (curIdx <= 0) return { ok: false, reason: '已经是第一步' };
      return { ok: true, to: visible[curIdx - 1] };
    }

    if (nav.kind === 'jump') {
      var target = nav.to;
      if (!getStep(schema, target)) return { ok: false, reason: '目标步骤不存在: ' + target };
      var targetIdx = visible.indexOf(target);
      if (targetIdx === -1) return { ok: false, reason: '目标步骤在当前分支下不可见' };
      if (target === state.currentStep) return { ok: false, reason: '已在目标步骤' };
      var maxVisited = -1;
      for (var i = 0; i < visible.length; i++) {
        if (state.visited[visible[i]]) maxVisited = i;
      }
      if (targetIdx > maxVisited + 1) {
        return { ok: false, reason: '不能越过未到达的步骤（请先按顺序完成前面的步骤）' };
      }
      return { ok: true, to: target };
    }

    return { ok: false, reason: '未知的导航类型: ' + nav.kind };
  }

  /** 应用单个事件，返回新状态（不修改入参）。 */
  function applyEvent(schema, state, event) {
    var next = clone(state);
    if (event.type === 'answer') {
      if (!next.answers[event.step]) next.answers[event.step] = {};
      if (event.value === undefined || event.value === null || event.value === '') {
        delete next.answers[event.step][event.field];
      } else {
        next.answers[event.step][event.field] = event.value;
      }
      // 注意：切换分支时保留旧分支答案，仅影响可见性，不丢数据。
    } else if (event.type === 'nav') {
      next.currentStep = event.to;
      next.visited[event.to] = true;
    } else if (event.type === 'submit') {
      next.submitted = true;
    } else {
      throw new Error('未知事件类型: ' + event.type);
    }
    next.history.push(event);
    return next;
  }

  /** 校验并应用导航；非法导航返回 { ok:false, reason }，状态不变。 */
  function navigate(schema, state, nav) {
    var check = validateNav(schema, state, nav);
    if (!check.ok) return { ok: false, reason: check.reason, state: state };
    var event = {
      type: 'nav',
      from: state.currentStep,
      to: check.to,
      via: nav.kind,
      ts: Date.now()
    };
    return { ok: true, state: applyEvent(schema, state, event), event: event };
  }

  function answer(schema, state, stepId, field, value) {
    var event = { type: 'answer', step: stepId, field: field, value: value, ts: Date.now() };
    return { ok: true, state: applyEvent(schema, state, event), event: event };
  }

  function submit(schema, state) {
    var visible = computeVisibleSteps(schema, state.answers);
    for (var i = 0; i < visible.length; i++) {
      if (!isStepComplete(schema, state.answers, visible[i])) {
        return { ok: false, reason: '步骤 "' + visible[i] + '" 尚未完成，不能提交', state: state };
      }
    }
    var event = { type: 'submit', ts: Date.now() };
    return { ok: true, state: applyEvent(schema, state, event), event: event };
  }

  /**
   * 状态回放：从初始状态出发逐事件重放。
   * 返回 { snapshots: [{ index, event, state, visibleSteps }], final }
   */
  function replay(schema, events) {
    var state = createInitialState(schema);
    var snapshots = [{
      index: -1,
      event: null,
      state: clone(state),
      visibleSteps: computeVisibleSteps(schema, state.answers)
    }];
    for (var i = 0; i < events.length; i++) {
      state = applyEvent(schema, state, events[i]);
      snapshots.push({
        index: i,
        event: clone(events[i]),
        state: clone(state),
        visibleSteps: computeVisibleSteps(schema, state.answers)
      });
    }
    return { snapshots: snapshots, final: state };
  }

  /** 序列化为 JSON 字符串（草稿保存 / 分享）。 */
  function serialize(state) {
    return JSON.stringify({ version: STATE_VERSION, state: state });
  }

  /** 反序列化并做结构校验；非法输入抛错。 */
  function deserialize(json) {
    var payload = typeof json === 'string' ? JSON.parse(json) : json;
    if (!payload || typeof payload !== 'object') throw new Error('草稿格式错误：不是对象');
    if (payload.version !== STATE_VERSION) throw new Error('草稿版本不兼容: ' + payload.version);
    var s = payload.state;
    if (!s || typeof s !== 'object') throw new Error('草稿缺少 state');
    if (typeof s.currentStep !== 'string') throw new Error('state.currentStep 缺失');
    if (!s.answers || typeof s.answers !== 'object') throw new Error('state.answers 缺失');
    if (!s.visited || typeof s.visited !== 'object') throw new Error('state.visited 缺失');
    if (!Array.isArray(s.history)) throw new Error('state.history 缺失');
    return {
      answers: s.answers,
      currentStep: s.currentStep,
      visited: s.visited,
      history: s.history,
      submitted: s.submitted === true
    };
  }

  /** 提交时导出的数据：仅包含当前可见步骤的答案。 */
  function submittedData(schema, state) {
    var visible = computeVisibleSteps(schema, state.answers);
    var data = {};
    for (var i = 0; i < visible.length; i++) {
      var stepId = visible[i];
      if (state.answers[stepId]) data[stepId] = clone(state.answers[stepId]);
    }
    return data;
  }

  var StateEngine = {
    STATE_VERSION: STATE_VERSION,
    createInitialState: createInitialState,
    computeVisibleSteps: computeVisibleSteps,
    isFieldVisible: isFieldVisible,
    isStepComplete: isStepComplete,
    validateNav: validateNav,
    applyEvent: applyEvent,
    navigate: navigate,
    answer: answer,
    submit: submit,
    replay: replay,
    serialize: serialize,
    deserialize: deserialize,
    submittedData: submittedData,
    getStep: getStep
  };

  root.StateEngine = StateEngine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateEngine;
  }
})(typeof self !== 'undefined' ? self : globalThis);
