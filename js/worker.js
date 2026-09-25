/*
 * Web Worker：所有状态计算（可见性、导航校验、回放、序列化）都在这里执行，
 * 主线程只负责 DOM 渲染与 IndexedDB 读写。
 *
 * 消息协议（reqId 用于请求/响应配对）：
 *   -> { reqId, type: 'navigate', state, nav }        <- { reqId, type:'result', ok, reason?, state? }
 *   -> { reqId, type: 'answer',   state, step, field, value }
 *   -> { reqId, type: 'submit',   state }
 *   -> { reqId, type: 'replay',   events }            <- { reqId, type:'replay', snapshots }
 *   -> { reqId, type: 'restore',  json }              <- 反序列化 + 校验草稿
 */
'use strict';

importScripts('schema.js', 'state.js');

var schema = self.FORM_SCHEMA;
var engine = self.StateEngine;

self.onmessage = function (e) {
  var msg = e.data;
  var reply = { reqId: msg.reqId };
  try {
    switch (msg.type) {
      case 'navigate': {
        var nav = engine.navigate(schema, msg.state, msg.nav);
        reply.type = 'result';
        reply.ok = nav.ok;
        reply.reason = nav.reason || null;
        reply.state = nav.ok ? nav.state : msg.state;
        break;
      }
      case 'answer': {
        var ans = engine.answer(schema, msg.state, msg.step, msg.field, msg.value);
        reply.type = 'result';
        reply.ok = true;
        reply.state = ans.state;
        break;
      }
      case 'submit': {
        var sub = engine.submit(schema, msg.state);
        reply.type = 'result';
        reply.ok = sub.ok;
        reply.reason = sub.reason || null;
        reply.state = sub.state;
        break;
      }
      case 'replay': {
        var r = engine.replay(schema, msg.events || []);
        reply.type = 'replay';
        reply.ok = true;
        reply.snapshots = r.snapshots;
        break;
      }
      case 'restore': {
        reply.type = 'result';
        reply.ok = true;
        reply.state = engine.deserialize(msg.json);
        break;
      }
      case 'serialize': {
        reply.type = 'serialized';
        reply.ok = true;
        reply.json = engine.serialize(msg.state);
        break;
      }
      default:
        throw new Error('未知消息类型: ' + msg.type);
    }
  } catch (err) {
    reply.type = reply.type || 'result';
    reply.ok = false;
    reply.reason = String((err && err.message) || err);
    reply.state = msg.state || null;
  }
  self.postMessage(reply);
};
