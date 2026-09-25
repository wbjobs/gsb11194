/*
 * 表单定义（schema）。5 个步骤，步骤可见性由前序步骤的答案决定（分支）。
 * 该文件同时被浏览器（<script>）、Web Worker（importScripts）和 Node（require）使用。
 */
(function (root) {
  'use strict';

  var FORM_SCHEMA = {
    id: 'demo-5-step-form',
    version: 1,
    steps: [
      {
        id: 'account',
        title: '账户类型',
        fields: [
          {
            name: 'accountType',
            type: 'radio',
            label: '请选择账户类型',
            required: true,
            options: [
              { value: 'personal', label: '个人账户' },
              { value: 'company', label: '企业账户' }
            ]
          }
        ]
      },
      {
        id: 'personal',
        title: '个人信息',
        // 分支 A：仅当第 1 步选择 personal 时可见
        visibleIf: { step: 'account', field: 'accountType', equals: 'personal' },
        fields: [
          { name: 'fullName', type: 'text', label: '姓名', required: true, placeholder: '张三' },
          { name: 'age', type: 'number', label: '年龄', required: true, placeholder: '18' }
        ]
      },
      {
        id: 'company',
        title: '企业信息',
        // 分支 B：仅当第 1 步选择 company 时可见（与 personal 互斥，在第 4 步合并）
        visibleIf: { step: 'account', field: 'accountType', equals: 'company' },
        fields: [
          { name: 'companyName', type: 'text', label: '企业名称', required: true, placeholder: '某某科技有限公司' },
          { name: 'taxId', type: 'text', label: '统一社会信用代码', required: true, placeholder: '91...' }
        ]
      },
      {
        id: 'plan',
        title: '套餐选择',
        // 无条件步骤：两个分支在此合并
        fields: [
          {
            name: 'plan',
            type: 'radio',
            label: '请选择套餐',
            required: true,
            options: [
              { value: 'free', label: '免费版' },
              { value: 'pro', label: '专业版' }
            ]
          },
          {
            name: 'coupon',
            type: 'text',
            label: '优惠码',
            required: false,
            placeholder: '仅专业版可填',
            // 字段级分支：仅当本步选择 pro 时显示
            visibleIf: { step: 'plan', field: 'plan', equals: 'pro' }
          }
        ]
      },
      {
        id: 'confirm',
        title: '确认提交',
        fields: [
          { name: 'agree', type: 'checkbox', label: '我已阅读并同意《服务条款》', required: true },
          { name: 'remark', type: 'textarea', label: '备注（可选）', required: false, placeholder: '还有什么想告诉我们的？' }
        ]
      }
    ]
  };

  root.FORM_SCHEMA = FORM_SCHEMA;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FORM_SCHEMA;
  }
})(typeof self !== 'undefined' ? self : globalThis);
