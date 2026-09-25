/*
 * IndexedDB 草稿持久层。
 * 库: multistep-form / 表: drafts (keyPath: id)
 * 每条草稿: { id, state, updatedAt }
 */
(function (root) {
  'use strict';

  var DB_NAME = 'multistep-form';
  var DB_VERSION = 1;
  var STORE = 'drafts';

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function withStore(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, mode);
      var store = tx.objectStore(STORE);
      var req = fn(store);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  var DraftStore = {
    save: function (id, state) {
      return openDB().then(function (db) {
        return withStore(db, 'readwrite', function (store) {
          return store.put({ id: id, state: state, updatedAt: Date.now() });
        });
      });
    },
    load: function (id) {
      return openDB().then(function (db) {
        return withStore(db, 'readonly', function (store) {
          return store.get(id);
        });
      }).then(function (row) { return row || null; });
    },
    remove: function (id) {
      return openDB().then(function (db) {
        return withStore(db, 'readwrite', function (store) {
          return store.delete(id);
        });
      });
    }
  };

  root.DraftStore = DraftStore;
})(typeof self !== 'undefined' ? self : globalThis);
