/*
 * 主线程控制器：DOM 渲染、Worker 通信、IndexedDB 自动保存、草稿分享、回放面板。
 * 所有状态计算都委托给 Web Worker，主线程不做分支/校验逻辑。
 */
(function () {
  'use strict';

  var DRAFT_ID = 'current';
  var schema = window.FORM_SCHEMA;
  var engine = window.StateEngine; // 仅用于渲染辅助（可见性判断），不做状态迁移

  var state = null;          // 当前状态（由 worker 计算产生）
  var worker = null;
  var reqSeq = 0;
  var pending = {};          // reqId -> resolve
  var saveTimer = null;

  // ---------- Worker RPC ----------
  function callWorker(type, payload) {
    return new Promise(function (resolve, reject) {
      var reqId = ++reqSeq;
      pending[reqId] = { resolve: resolve, reject: reject };
      var msg = { reqId: reqId, type: type };
      for (var k in payload) msg[k] = payload[k];
      worker.postMessage(msg);
    });
  }

  function initWorker() {
    worker = new Worker('js/worker.js');
    worker.onmessage = function (e) {
      var msg = e.data;
      var p = pending[msg.reqId];
      if (!p) return;
      delete pending[msg.reqId];
      p.resolve(msg);
    };
    worker.onerror = function (err) {
      toast('Worker 错误: ' + err.message, 'error');
    };
  }

  // ---------- IndexedDB 自动保存 ----------
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      DraftStore.save(DRAFT_ID, state).then(function () {
        setStatus('草稿已自动保存 ' + new Date().toLocaleTimeString());
      }).catch(function (err) {
        setStatus('草稿保存失败: ' + err);
      });
    }, 300);
  }

  // ---------- 渲染 ----------
  var els = {};

  function render() {
    var visible = engine.computeVisibleSteps(schema, state.answers);
    renderSteps(visible);
    renderForm();
    renderNavButtons(visible);
    document.getElementById('btn-submit').style.display =
      state.currentStep === 'confirm' ? '' : 'none';
    document.getElementById('btn-next').style.display =
      state.currentStep === 'confirm' ? 'none' : '';
    if (state.submitted) showSubmitted();
  }

  function renderSteps(visible) {
    var ul = els.stepList;
    ul.innerHTML = '';
    schema.steps.forEach(function (step) {
      var li = document.createElement('li');
      var isVisible = visible.indexOf(step.id) !== -1;
      var isCurrent = step.id === state.currentStep;
      var isDone = isVisible && engine.isStepComplete(schema, state.answers, step.id);
      li.className = 'step-item' +
        (isVisible ? '' : ' hidden-step') +
        (isCurrent ? ' current' : '') +
        (isDone ? ' done' : '');
      li.textContent = step.title + (isVisible ? '' : '（当前分支不可见）');
      li.dataset.step = step.id;
      li.addEventListener('click', function () { onJump(step.id); });
      ul.appendChild(li);
    });
  }

  function renderForm() {
    var step = engine.getStep(schema, state.currentStep);
    els.formTitle.textContent = step.title;
    els.formBody.innerHTML = '';
    var stepAnswers = state.answers[step.id] || {};

    step.fields.forEach(function (field) {
      if (!engine.isFieldVisible(field, state.answers)) return;
      var wrap = document.createElement('div');
      wrap.className = 'field';

      if (field.type === 'radio') {
        var legend = document.createElement('label');
        legend.className = 'field-label';
        legend.textContent = field.label + (field.required ? ' *' : '');
        wrap.appendChild(legend);
        field.options.forEach(function (opt) {
          var row = document.createElement('label');
          row.className = 'radio-row';
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = field.name;
          input.value = opt.value;
          input.checked = stepAnswers[field.name] === opt.value;
          input.addEventListener('change', function () {
            onAnswer(step.id, field.name, opt.value);
          });
          row.appendChild(input);
          row.appendChild(document.createTextNode(opt.label));
          wrap.appendChild(row);
        });
      } else if (field.type === 'checkbox') {
        var row2 = document.createElement('label');
        row2.className = 'radio-row';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = stepAnswers[field.name] === true;
        cb.addEventListener('change', function () {
          onAnswer(step.id, field.name, cb.checked);
        });
        row2.appendChild(cb);
        row2.appendChild(document.createTextNode(field.label + (field.required ? ' *' : '')));
        wrap.appendChild(row2);
      } else {
        var lab = document.createElement('label');
        lab.className = 'field-label';
        lab.textContent = field.label + (field.required ? ' *' : '');
        wrap.appendChild(lab);
        var input2;
        if (field.type === 'textarea') {
          input2 = document.createElement('textarea');
        } else {
          input2 = document.createElement('input');
          input2.type = field.type === 'number' ? 'number' : 'text';
        }
        input2.placeholder = field.placeholder || '';
        var v = stepAnswers[field.name];
        input2.value = v === undefined || v === null ? '' : v;
        input2.addEventListener('input', function () {
          var val = input2.value;
          if (field.type === 'number') val = val === '' ? '' : Number(val);
          onAnswer(step.id, field.name, val);
        });
        wrap.appendChild(input2);
      }
      els.formBody.appendChild(wrap);
    });
  }

  function renderNavButtons(visible) {
    var idx = visible.indexOf(state.currentStep);
    els.btnPrev.disabled = idx <= 0;
  }

  function showSubmitted() {
    var data = engine.submittedData(schema, state);
    els.submittedBox.style.display = '';
    els.submittedBox.querySelector('pre').textContent =
      JSON.stringify(data, null, 2);
  }

  // ---------- 事件 ----------
  function onAnswer(stepId, field, value) {
    callWorker('answer', { state: state, step: stepId, field: field, value: value })
      .then(function (res) {
        if (!res.ok) return toast(res.reason, 'error');
        state = res.state;
        render();
        scheduleSave();
      });
  }

  function onNav(kind, to) {
    callWorker('navigate', { state: state, nav: { kind: kind, to: to } })
      .then(function (res) {
        if (!res.ok) return toast('已拒绝: ' + res.reason, 'error');
        state = res.state;
        render();
        scheduleSave();
      });
  }

  function onJump(stepId) { onNav('jump', stepId); }

  function onSubmit() {
    callWorker('submit', { state: state }).then(function (res) {
      if (!res.ok) return toast('提交失败: ' + res.reason, 'error');
      state = res.state;
      render();
      scheduleSave();
      toast('提交成功！', 'ok');
    });
  }

  // ---------- 草稿分享 ----------
  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function exportDraft() {
    callWorker('serialize', { state: state }).then(function (res) {
      var url = location.origin + location.pathname + '#draft=' + toBase64Url(res.json);
      els.shareBox.style.display = '';
      els.shareUrl.value = url;
      els.shareUrl.select();
      if (navigator.clipboard) navigator.clipboard.writeText(url).catch(function () {});
      toast('草稿链接已生成并复制', 'ok');
    });
  }

  function importDraft() {
    var text = els.importText.value.trim();
    if (!text) return toast('请粘贴草稿 JSON 或分享链接', 'error');
    var json = text;
    var hashIdx = text.indexOf('#draft=');
    if (hashIdx !== -1) {
      try { json = fromBase64Url(text.slice(hashIdx + 7)); }
      catch (e) { return toast('链接解析失败: ' + e.message, 'error'); }
    }
    callWorker('restore', { json: json }).then(function (res) {
      if (!res.ok) return toast('草稿无效: ' + res.reason, 'error');
      state = res.state;
      render();
      scheduleSave();
      els.importText.value = '';
      toast('草稿已恢复', 'ok');
    });
  }

  // ---------- 回放 ----------
  function openReplay() {
    callWorker('replay', { events: state.history }).then(function (res) {
      renderReplay(res.snapshots);
      els.replayPanel.style.display = '';
    });
  }

  function renderReplay(snapshots) {
    var list = els.replayList;
    list.innerHTML = '';
    snapshots.forEach(function (snap) {
      var li = document.createElement('li');
      li.textContent = snap.event === null
        ? '初始状态'
        : '#' + snap.index + ' ' + describeEvent(snap.event);
      li.addEventListener('click', function () {
        list.querySelectorAll('li').forEach(function (n) { n.classList.remove('active'); });
        li.classList.add('active');
        els.replayDetail.textContent = JSON.stringify({
          visibleSteps: snap.visibleSteps,
          currentStep: snap.state.currentStep,
          answers: snap.state.answers,
          submitted: snap.state.submitted
        }, null, 2);
      });
      list.appendChild(li);
    });
    els.replayDetail.textContent = '点击左侧事件查看该时刻的状态快照';
  }

  function describeEvent(ev) {
    if (ev.type === 'answer') return '填写 ' + ev.step + '.' + ev.field + ' = ' + JSON.stringify(ev.value);
    if (ev.type === 'nav') return '导航 ' + ev.from + ' → ' + ev.to + ' (' + ev.via + ')';
    if (ev.type === 'submit') return '提交表单';
    return ev.type;
  }

  // ---------- 杂项 ----------
  function toast(msg, kind) {
    var t = els.toast;
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    setTimeout(function () { t.className = 'toast'; }, 3000);
  }

  function setStatus(text) { els.status.textContent = text; }

  function resetAll() {
    if (!confirm('确定清空当前草稿并重新开始？')) return;
    state = engine.createInitialState(schema);
    DraftStore.remove(DRAFT_ID);
    els.submittedBox.style.display = 'none';
    render();
    scheduleSave();
    toast('已重置', 'ok');
  }

  // ---------- 启动 ----------
  function boot() {
    [
      'step-list', 'form-title', 'form-body', 'btn-prev', 'btn-submit',
      'status', 'toast', 'share-box', 'share-url', 'import-text',
      'replay-panel', 'replay-list', 'replay-detail', 'submitted-box'
    ].forEach(function (id) {
      els[id.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); })] =
        document.getElementById(id);
    });

    initWorker();

    document.getElementById('btn-prev').addEventListener('click', function () { onNav('prev'); });
    document.getElementById('btn-next').addEventListener('click', function () { onNav('next'); });
    document.getElementById('btn-submit').addEventListener('click', onSubmit);
    document.getElementById('btn-export').addEventListener('click', exportDraft);
    document.getElementById('btn-import').addEventListener('click', importDraft);
    document.getElementById('btn-replay').addEventListener('click', openReplay);
    document.getElementById('btn-replay-close').addEventListener('click', function () {
      els.replayPanel.style.display = 'none';
    });
    document.getElementById('btn-reset').addEventListener('click', resetAll);

    // 恢复优先级：URL 分享链接 > IndexedDB 草稿 > 全新状态
    var hash = location.hash;
    if (hash.indexOf('#draft=') === 0) {
      var json;
      try {
        json = fromBase64Url(hash.slice(7));
      } catch (e) {
        toast('分享链接解析失败: ' + e.message, 'error');
        return loadFromDB();
      }
      callWorker('restore', { json: json }).then(function (res) {
        if (res.ok) {
          state = res.state;
          history.replaceState(null, '', location.pathname); // 消费掉 hash
          toast('已从分享链接恢复草稿', 'ok');
          render();
          scheduleSave();
        } else {
          toast('分享链接无效: ' + res.reason, 'error');
          loadFromDB();
        }
      });
    } else {
      loadFromDB();
    }
  }

  function loadFromDB() {
    DraftStore.load(DRAFT_ID).then(function (row) {
      if (row && row.state) {
        return callWorker('restore', { json: JSON.stringify({ version: 1, state: row.state }) })
          .then(function (res) {
            if (res.ok) {
              state = res.state;
              setStatus('已恢复上次草稿（保存于 ' + new Date(row.updatedAt).toLocaleString() + '）');
            } else {
              state = engine.createInitialState(schema);
            }
            render();
          });
      }
      state = engine.createInitialState(schema);
      render();
    }).catch(function () {
      state = engine.createInitialState(schema);
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
