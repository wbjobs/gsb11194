/*
 * app.js — DOM 渲染与交互。状态计算全部委托给 Web Worker，
 * 主线程只派发意图（answer/next/prev/jump）并渲染 Worker 返回的视图。
 */
(() => {
  'use strict';
  const Core = window.WizardCore; // 仅用于读取步骤 schema（标题/字段定义）
  const DRAFT_KEY = 'current';

  // ---------- Worker 客户端 ----------
  const worker = new Worker('js/worker.js');
  let msgId = 0;
  const pending = new Map();
  worker.onmessage = (e) => {
    const { id } = e.data;
    const p = pending.get(id);
    if (p) { pending.delete(id); p(e.data); }
  };
  worker.onerror = (e) => toast('Worker 错误: ' + e.message, true);
  function call(type, extra) {
    return new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      worker.postMessage(Object.assign({ id, type }, extra));
    });
  }

  // ---------- 全局 UI 状态 ----------
  let state = null;      // Worker 返回的最新状态
  let view = null;       // Worker 计算的派生视图
  let showErrors = false; // 仅在用户尝试前进失败后展示字段错误

  const $ = (sel) => document.querySelector(sel);
  const stepperEl = $('#stepper');
  const formEl = $('#step-form');
  const titleEl = $('#step-title');
  const summaryEl = $('#summary');
  const formErrorEl = $('#form-error');
  const draftStatusEl = $('#draft-status');

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ---------- 渲染 ----------
  function render() {
    renderStepper();
    renderForm();
    $('#btn-prev').disabled = view.visible.indexOf(state.current) <= 0;
    const isLast = view.visible.indexOf(state.current) === view.visible.length - 1;
    $('#btn-next').textContent = isLast ? '提交 ✓' : '下一步 →';
  }

  function renderStepper() {
    stepperEl.innerHTML = '';
    Core.STEPS.forEach((step, i) => {
      const chip = document.createElement('div');
      chip.className = 'step-chip';
      const visible = view.visible.includes(step.id);
      if (!visible) {
        chip.classList.add('hidden-step'); // 分支未激活的步骤不占位
      } else {
        if (step.id === state.current) chip.classList.add('current');
        else if (view.completed[step.id]) chip.classList.add('done');
        if (!view.reachable[step.id]) chip.classList.add('locked');
        chip.title = view.reachable[step.id] ? '点击跳转' : '前置步骤未完成，不可跳转';
        chip.addEventListener('click', () => onJump(step.id));
      }
      chip.innerHTML = `<span class="idx">第 ${i + 1} 步${visible ? '' : ' · 已隐藏'}</span>${step.title}`;
      stepperEl.appendChild(chip);
    });
  }

  function renderForm() {
    const step = Core.STEPS.find((s) => s.id === state.current);
    titleEl.textContent = step.title;
    formErrorEl.hidden = true;
    formEl.innerHTML = '';
    summaryEl.hidden = !step.confirm;
    if (step.confirm) renderSummary();

    const data = state.answers[step.id] || {};
    const fieldErrors = (showErrors && view.errors[step.id]) || {};

    for (const f of step.fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const required = typeof f.requiredIf === 'function' ? !!f.requiredIf(state.answers) : !!f.required;
      const star = required ? ' <span class="required-star">*</span>' : '';

      if (f.type === 'text') {
        wrap.innerHTML = `<label for="f-${f.name}">${f.label}${star}</label>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `f-${f.name}`;
        input.name = f.name;
        input.placeholder = f.placeholder || '';
        input.value = data[f.name] != null ? data[f.name] : '';
        if (fieldErrors[f.name]) input.classList.add('invalid');
        input.addEventListener('input', debounce(() => onAnswer(step.id, { [f.name]: input.value }), 300));
        wrap.appendChild(input);
      } else if (f.type === 'radio') {
        wrap.innerHTML = `<span class="field-label">${f.label}${star}</span>`;
        const group = document.createElement('div');
        group.className = 'radio-group';
        for (const opt of f.options) {
          const label = document.createElement('label');
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = f.name;
          radio.value = opt.value;
          radio.checked = data[f.name] === opt.value;
          radio.addEventListener('change', () => onAnswer(step.id, { [f.name]: opt.value }));
          label.appendChild(radio);
          label.appendChild(document.createTextNode(' ' + opt.label));
          group.appendChild(label);
        }
        wrap.appendChild(group);
      } else if (f.type === 'checkbox') {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = f.name;
        box.checked = data[f.name] === true;
        box.addEventListener('change', () => onAnswer(step.id, { [f.name]: box.checked }));
        label.appendChild(box);
        label.insertAdjacentHTML('beforeend', ` ${f.label}${star}`);
        wrap.appendChild(label);
      }

      if (fieldErrors[f.name]) {
        const err = document.createElement('div');
        err.className = 'field-error';
        err.textContent = fieldErrors[f.name];
        wrap.appendChild(err);
      }
      formEl.appendChild(wrap);
    }
  }

  function renderSummary() {
    // 确认页：汇总所有可见步骤的已填答案（只读）
    let html = '';
    for (const stepId of view.visible) {
      const step = Core.STEPS.find((s) => s.id === stepId);
      if (step.confirm) continue;
      const data = state.answers[stepId] || {};
      html += `<h4>${step.title}</h4><dl>`;
      for (const f of step.fields) {
        let v = data[f.name];
        if (f.type === 'radio' && f.options) {
          const opt = f.options.find((o) => o.value === v);
          v = opt ? opt.label : v;
        }
        html += `<dt>${f.label}</dt><dd>${v != null && v !== '' ? escapeHtml(String(v)) : '<em>未填写</em>'}</dd>`;
      }
      html += '</dl>';
    }
    summaryEl.innerHTML = html;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- 动作 ----------
  async function dispatch(action) {
    const r = await call('dispatch', { action });
    if (!r.ok) {
      showErrors = true;
      toast(r.error || '操作被拒绝', true);
      if (r.fieldErrors) {
        state = r.state; view = r.view;
        render();
        formErrorEl.textContent = r.error;
        formErrorEl.hidden = false;
      }
      return false;
    }
    state = r.state; view = r.view;
    showErrors = false;
    render();
    autosave();
    return true;
  }

  const onAnswer = (step, data) => dispatch({ type: 'answer', step, data });
  const onJump = (to) => dispatch({ type: 'jump', to });
  $('#btn-next').addEventListener('click', () => {
    const isLast = view.visible.indexOf(state.current) === view.visible.length - 1;
    if (isLast) {
      // 最后一步 = 提交：校验通过则提示完成，否则展示字段错误
      if (view.completed[state.current]) {
        toast('🎉 表单已完成并提交（草稿仍保留，可继续修改）');
      } else {
        showErrors = true;
        render();
        formErrorEl.textContent = '请先完成本页必填项再提交';
        formErrorEl.hidden = false;
      }
      return;
    }
    dispatch({ type: 'next' });
  });
  $('#btn-prev').addEventListener('click', () => dispatch({ type: 'prev' }));
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('确定重置？将清空所有答案与本地草稿。')) return;
    await dispatch({ type: 'reset' });
    await DraftDB.clearDraft(DRAFT_KEY);
    toast('已重置');
  });

  // ---------- 草稿持久化 ----------
  const autosave = debounce(async () => {
    try {
      const r = await call('serialize');
      await DraftDB.saveDraft(r.payload, DRAFT_KEY);
      draftStatusEl.textContent = '草稿已保存 ' + new Date().toLocaleTimeString();
      draftStatusEl.className = 'draft-status saved';
    } catch (e) {
      draftStatusEl.textContent = '草稿保存失败';
    }
  }, 300);

  // ---------- 导出 / 导入 / 分享 ----------
  const dialog = $('#share-dialog');
  const shareText = $('#share-text');
  let exportPayload = '';

  $('#btn-export').addEventListener('click', async () => {
    const r = await call('serialize');
    exportPayload = r.payload;
    $('#share-title').textContent = '导出 / 分享草稿';
    $('#share-hint').textContent = '以下为草稿 JSON（事件日志）。可下载、复制分享链接，或发给他人导入。';
    shareText.value = exportPayload;
    shareText.readOnly = true;
    dialog.showModal();
  });

  $('#btn-import').addEventListener('click', () => {
    $('#share-title').textContent = '导入草稿';
    $('#share-hint').textContent = '粘贴草稿 JSON（或分享链接中的 Base64 内容），点击确定导入。';
    shareText.value = '';
    shareText.readOnly = false;
    dialog.showModal();
  });

  $('#btn-share-ok').addEventListener('click', async () => {
    dialog.close();
    if (shareText.readOnly) return; // 导出模式，无需处理
    const text = shareText.value.trim();
    if (!text) return;
    try {
      const payload = text.startsWith('{') ? text : decodeBase64Url(text);
      const r = await call('restore', { payload });
      if (!r.ok) throw new Error(r.error);
      state = r.state; view = r.view; showErrors = false;
      render();
      autosave();
      toast('草稿导入成功');
    } catch (e) {
      toast('导入失败: ' + e.message, true);
    }
  });

  $('#btn-copy-link').addEventListener('click', async () => {
    const payload = exportPayload || shareText.value;
    if (!payload) return;
    const link = location.origin + location.pathname + '#draft=' + encodeBase64Url(payload);
    try {
      await navigator.clipboard.writeText(link);
      toast('分享链接已复制');
    } catch {
      prompt('复制以下链接:', link);
    }
  });

  $('#btn-download').addEventListener('click', () => {
    const payload = exportPayload || shareText.value;
    if (!payload) return;
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `form-draft-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function encodeBase64Url(s) {
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeBase64Url(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(escape(atob(b64)));
  }

  // ---------- 状态回放 ----------
  const replayPanel = $('#replay-panel');
  const replayList = $('#replay-list');
  const replaySnapshot = $('#replay-snapshot');
  let playTimer = null;

  $('#btn-replay').addEventListener('click', async () => {
    replayPanel.hidden = !replayPanel.hidden;
    if (!replayPanel.hidden) await renderReplayList();
  });
  $('#btn-replay-close').addEventListener('click', () => {
    replayPanel.hidden = true;
    stopPlay();
  });

  async function renderReplayList() {
    const r = await call('get');
    replayList.innerHTML = '';
    if (r.state.log.length === 0) {
      replayList.innerHTML = '<li>（暂无事件）</li>';
      return;
    }
    r.state.log.forEach((ev, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="ev-seq">#${ev.seq}</span>${describeEvent(ev)}`;
      li.addEventListener('click', () => showSnapshot(i + 1, li));
      replayList.appendChild(li);
    });
  }

  function describeEvent(ev) {
    if (ev.type === 'answer') return `填写 ${stepTitle(ev.step)}: ${escapeHtml(JSON.stringify(ev.data))}`;
    if (ev.type === 'nav') return `导航 ${stepTitle(ev.from)} → ${stepTitle(ev.to)}`;
    return ev.type;
  }
  const stepTitle = (id) => (Core.STEPS.find((s) => s.id === id) || {}).title || id;

  async function showSnapshot(upto, li) {
    replayList.querySelectorAll('li').forEach((el) => el.classList.remove('active'));
    if (li) li.classList.add('active');
    const r = await call('replay', { upto });
    const s = r.replayState;
    replaySnapshot.textContent = JSON.stringify({
      事件序号: `0..${upto}`,
      当前步骤: `${s.current} (${stepTitle(s.current)})`,
      可见步骤: r.view.visible,
      已完成步骤: Object.keys(r.view.completed).filter((k) => r.view.completed[k]),
      答案: s.answers,
    }, null, 2);
  }

  $('#btn-play').addEventListener('click', async () => {
    if (playTimer) { stopPlay(); return; }
    const r = await call('get');
    const total = r.state.log.length;
    if (!total) return;
    $('#btn-play').textContent = '⏸ 停止';
    let i = 0;
    playTimer = setInterval(() => {
      i += 1;
      const li = replayList.children[i - 1];
      showSnapshot(i, li);
      if (li) li.scrollIntoView({ block: 'nearest' });
      if (i >= total) stopPlay();
    }, 700);
  });
  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    $('#btn-play').textContent = '▶ 自动播放';
  }

  // ---------- 启动：分享链接 > IndexedDB 草稿 > 全新 ----------
  async function boot() {
    try {
      if (location.hash.startsWith('#draft=')) {
        const payload = decodeBase64Url(decodeURIComponent(location.hash.slice(7)));
        history.replaceState(null, '', location.pathname);
        const r = await call('restore', { payload });
        if (r.ok) {
          state = r.state; view = r.view;
          render();
          autosave();
          toast('已从分享链接恢复草稿');
          return;
        }
      }
      const row = await DraftDB.loadDraft(DRAFT_KEY);
      if (row && row.payload) {
        const r = await call('restore', { payload: row.payload });
        if (r.ok) {
          state = r.state; view = r.view;
          render();
          draftStatusEl.textContent = '草稿已恢复 ' + new Date(row.savedAt).toLocaleTimeString();
          draftStatusEl.className = 'draft-status saved';
          return;
        }
      }
    } catch (e) {
      console.warn('草稿恢复失败，使用全新表单', e);
    }
    const r = await call('get');
    state = r.state; view = r.view;
    render();
  }

  boot();
})();
