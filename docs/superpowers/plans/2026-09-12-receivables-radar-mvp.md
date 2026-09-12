# 回款雷达 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一个面向自由职业者和小型服务商的本地优先网页工具，完成“记录应收—安排跟进—登记到账—关闭应收”的最小闭环。

**Architecture:** 使用无框架的 HTML、CSS 和原生 JavaScript ES Modules，避免账号、服务器和外部依赖。业务规则、存储、备份、日历和文案分别封装成独立模块，页面层只负责组合数据与处理用户操作。

**Tech Stack:** HTML5、CSS3、JavaScript ES2022、浏览器 LocalStorage、Node.js 内置测试运行器

**Spec:** `../../../../outputs/receivables-radar-mvp-prd.md`

## Global Constraints

- 首版为响应式网页，手机和桌面浏览器均可使用。
- 数据只保存在当前浏览器，不实现账号、云同步和后台服务。
- 金额默认人民币并按两位小数处理。
- 已收款优先于暂停跟进；暂停记录不进入今日行动和逾期金额。
- 首版支持 JSON 完整备份与恢复，以及 `.ics` 日历文件导出。
- 不实现搜索、复杂排序、CSV、支付、AI、微信或邮件自动发送。
- 不自动执行 Git commit、push 或发布；只有用户明确要求后才能执行。

---

## File Map

| 文件 | 职责 |
|---|---|
| `package.json` | 项目元数据与测试命令 |
| `index.html` | 页面结构、表单、弹窗和无障碍标签 |
| `src/styles.css` | 响应式视觉样式与组件状态 |
| `src/domain.js` | 应收状态、金额、日期、队列和仪表盘计算 |
| `src/storage.js` | LocalStorage 读取、保存和仓库接口 |
| `src/backup.js` | JSON 导入导出、结构校验和重复 ID 处理 |
| `src/templates.js` | 分阶段催款文案生成 |
| `src/calendar.js` | `.ics` 内容生成与下载 |
| `src/app.js` | 页面状态、渲染、表单和用户事件 |
| `tests/domain.test.js` | 核心业务规则测试 |
| `tests/storage.test.js` | 本地存储仓库测试 |
| `tests/backup.test.js` | 备份恢复测试 |
| `tests/templates-calendar.test.js` | 催款模板和日历测试 |
| `README.md` | 运行、使用、数据安全和验收说明 |

---

### Task 1: 核心领域规则

**Files:**
- Create: `package.json`
- Create: `src/domain.js`
- Test: `tests/domain.test.js`

**Interfaces:**
- Produces: `createReceivable(input, now) -> Receivable`
- Produces: `deriveReceivable(record, today) -> DerivedReceivable`
- Produces: `addPayment(record, payment, now) -> Receivable`
- Produces: `addFollowUp(record, followUp, now) -> Receivable`
- Produces: `getTodayQueue(records, today) -> DerivedReceivable[]`
- Produces: `calculateDashboard(records, today) -> DashboardMetrics`

- [ ] **Step 1: 建立测试命令并编写状态、金额和日期的失败测试**

```json
{
  "name": "receivables-radar",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceivable, deriveReceivable, addPayment } from '../src/domain.js';

test('全额到账后状态为已收款并且剩余金额为零', () => {
  const record = createReceivable({
    clientName: '青禾设计', projectName: '官网设计', totalAmount: 5000,
    invoiceSent: true, dueDate: '2026-09-10'
  }, '2026-09-01T08:00:00.000Z');
  const paid = addPayment(record, { amount: 5000, paidAt: '2026-09-09', method: '银行转账' }, '2026-09-09T08:00:00.000Z');
  assert.equal(deriveReceivable(paid, '2026-09-12').status, 'paid');
  assert.equal(deriveReceivable(paid, '2026-09-12').remainingAmount, 0);
});

test('暂停的未收款计入待收总额但不计入逾期金额', () => {
  const record = { ...createReceivable({
    clientName: '启明咨询', projectName: '咨询服务', totalAmount: 3000,
    invoiceSent: true, dueDate: '2026-09-01'
  }, '2026-08-20T08:00:00.000Z'), paused: true };
  const result = deriveReceivable(record, '2026-09-12');
  assert.equal(result.status, 'paused');
  assert.equal(result.isOverdue, false);
});
```

- [ ] **Step 2: 运行测试，确认因领域模块不存在而失败**

Run: `npm test -- tests/domain.test.js`
Expected: FAIL，提示无法找到 `src/domain.js`。

- [ ] **Step 3: 实现最小领域模型和业务规则**

实现输入校验、唯一 ID、到账累计、剩余金额、状态优先级、逾期天数和本地日期比较。状态固定为 `unbilled | awaiting | partial | paid | paused`。

- [ ] **Step 4: 增加队列排序和仪表盘的失败测试**

```js
test('今日队列优先显示已逾期且到达跟进日的记录', () => {
  const records = [futureRecord, overdueRecord];
  assert.equal(getTodayQueue(records, '2026-09-12')[0].id, overdueRecord.id);
});

test('仪表盘分别计算待收、逾期、今日行动和七天内到期', () => {
  assert.deepEqual(calculateDashboard(records, '2026-09-12'), {
    outstandingAmount: 8000,
    overdueAmount: 3000,
    actionCount: 1,
    dueWithinSevenDaysAmount: 5000
  });
});
```

- [ ] **Step 5: 运行测试确认失败，再实现队列和仪表盘计算**

Run: `npm test -- tests/domain.test.js`
Expected: 新测试先因导出缺失或结果不匹配而 FAIL；实现后全部 PASS。

- [ ] **Step 6: 运行完整领域测试**

Run: `npm test -- tests/domain.test.js`
Expected: 全部 PASS，0 failures。

---

### Task 2: 本地存储和 JSON 备份恢复

**Files:**
- Create: `src/storage.js`
- Create: `src/backup.js`
- Test: `tests/storage.test.js`
- Test: `tests/backup.test.js`

**Interfaces:**
- Consumes: `Receivable` from `src/domain.js`
- Produces: `createRepository(storage, key) -> { list, get, save, remove, replaceAll }`
- Produces: `serializeBackup(records, exportedAt) -> string`
- Produces: `parseBackup(jsonText, existingRecords) -> { records, importedCount, skippedCount }`

- [ ] **Step 1: 编写仓库保存、读取、更新和删除的失败测试**

使用内存版 Storage 测试真实序列化行为，不模拟仓库本身。验证空数据返回空数组、相同 ID 更新而非重复、损坏数据安全返回空数组。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/storage.test.js`
Expected: FAIL，提示 `createRepository` 不存在。

- [ ] **Step 3: 实现 LocalStorage 仓库**

存储键固定为 `receivables-radar:v1`；所有写入使用 JSON；`save` 返回保存后的记录；`remove` 返回剩余列表。

- [ ] **Step 4: 编写备份结构、错误文件和重复 ID 的失败测试**

```js
test('恢复时跳过已有 ID 并返回导入统计', () => {
  const result = parseBackup(validBackupText, [{ id: 'existing' }]);
  assert.equal(result.importedCount, 1);
  assert.equal(result.skippedCount, 1);
});

test('错误备份不会返回可覆盖现有数据的结果', () => {
  assert.throws(() => parseBackup('{bad json', []), /备份文件无法读取/);
});
```

- [ ] **Step 5: 运行失败测试，再实现完整备份与合并恢复**

Run: `npm test -- tests/backup.test.js`
Expected: 测试先 FAIL；实现后 PASS。备份格式包含 `version: 1`、`exportedAt` 和 `records`。

- [ ] **Step 6: 运行存储与备份测试**

Run: `npm test -- tests/storage.test.js tests/backup.test.js`
Expected: 全部 PASS，0 failures。

---

### Task 3: 催款文案和日历文件

**Files:**
- Create: `src/templates.js`
- Create: `src/calendar.js`
- Test: `tests/templates-calendar.test.js`

**Interfaces:**
- Consumes: `DerivedReceivable` from `src/domain.js`
- Produces: `buildReminderMessage(record, today) -> { stage, text }`
- Produces: `buildCalendarEvent(record, eventType) -> string`
- Produces: `downloadTextFile(filename, content, mimeType) -> void`

- [ ] **Step 1: 编写五种跟进阶段和变量替换的失败测试**

验证到期前提醒、逾期 1—3 天、逾期 4—7 天、逾期超过 7 天、承诺付款日已过；文案必须带入客户、项目、剩余金额和日期。

- [ ] **Step 2: 运行测试确认失败，再实现模板生成器**

Run: `npm test -- tests/templates-calendar.test.js`
Expected: 测试先因模块缺失而 FAIL；模板实现后相关用例 PASS。

- [ ] **Step 3: 增加付款截止日和下次跟进日的 ICS 失败测试**

```js
test('日历内容包含有效事件标题和日期', () => {
  const ics = buildCalendarEvent(derivedRecord, 'followUp');
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260915/);
  assert.match(ics, /SUMMARY:回款跟进/);
});
```

- [ ] **Step 4: 运行失败测试，再实现 ICS 转义和文件内容生成**

Run: `npm test -- tests/templates-calendar.test.js`
Expected: 新用例先 FAIL；实现后全部 PASS。

---

### Task 4: 三页面响应式界面与核心交互

**Files:**
- Create: `index.html`
- Create: `src/styles.css`
- Create: `src/app.js`
- Modify: `src/calendar.js`

**Interfaces:**
- Consumes: Task 1—3 导出的全部公共函数
- Produces: 浏览器中的今日、全部应收、新建/编辑三个视图

- [ ] **Step 1: 创建语义化页面骨架**

页面包含顶部品牌区、指标卡、底部移动导航、今日列表、全部应收列表、编辑表单、详情弹窗、到账弹窗、跟进弹窗、备份与恢复入口。所有输入框均有可见标签。

- [ ] **Step 2: 实现移动端优先样式**

使用 CSS 自定义属性定义颜色和间距；手机为单列，宽屏为双栏；正文不小于 14px；点击目标不小于 44px；页面不得横向滚动。

- [ ] **Step 3: 连接新建、编辑和删除流程**

表单调用 `createReceivable` 和仓库 `save`；删除前使用明确的二次确认；成功后刷新指标和列表。

- [ ] **Step 4: 连接到账和跟进流程**

到账调用 `addPayment`；跟进调用 `addFollowUp`；支持设置客户承诺付款日、下次跟进日和暂停状态。

- [ ] **Step 5: 连接催款文案、JSON备份恢复和日历下载**

文案在可编辑文本框中展示并提供复制按钮；恢复前校验且错误不得覆盖；日历可按截止日或下次跟进日导出。

- [ ] **Step 6: 添加首次使用示例数据和空状态**

首次加载提供三条可删除的示例：待开票、已逾期、部分到账。空状态提供“新建第一笔应收”按钮。

---

### Task 5: 验收、说明和交付

**Files:**
- Create: `README.md`
- Modify: any file required by failed acceptance checks

**Interfaces:**
- Consumes: 完整应用
- Produces: 可本地启动、可测试、可由用户继续迭代的项目

- [ ] **Step 1: 编写 README**

写明双击或本地静态服务器运行方式、`npm test`、数据只保存在浏览器、如何备份恢复，以及不应录入银行卡号等敏感信息。

- [ ] **Step 2: 运行全部自动化测试**

Run: `npm test`
Expected: 全部 PASS，0 failures，0 warnings。

- [ ] **Step 3: 启动本地静态服务器并执行浏览器验收**

Run: `python -m http.server 4173`
Expected: `http://localhost:4173` 可访问。

依次验证：新建应收、状态变化、逾期排序、部分到账、全部到账、记录跟进、暂停、复制文案、JSON导出恢复、ICS导出、手机宽度无横向滚动。

- [ ] **Step 4: 对照 PRD 完成定义逐项核查**

记录任何未满足项；只有自动测试和页面主流程均通过后才标记完成。

- [ ] **Step 5: 输出变更摘要，不执行 Git 操作或外部发布**

列出项目目录、主要文件、测试结果、已知限制和下一轮建议。
