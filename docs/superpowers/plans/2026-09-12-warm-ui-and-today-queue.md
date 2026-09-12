# 温暖陪伴 UI 与今日行动规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将回款雷达改为“温暖陪伴”视觉方向，并保证首页只显示当天确实需要处理的应收款。

**Architecture:** 保持原生 HTML、CSS 和 ES Modules 架构。业务层在 `getTodayQueue` 根据既有 `needsActionToday` 派生字段过滤记录；页面层只消费过滤后的队列。视觉改动集中在 `index.html` 的今日页文案和 `src/styles.css`，不改变本地数据结构或交互接口。

**Tech Stack:** HTML5、CSS3、JavaScript ES Modules、Node.js 内置测试运行器

**Spec:** `docs/requirements/receivables-radar-mvp-prd.md`

## Global Constraints

- 面向个人自由职业者单人使用；无需账号，数据只保存在当前浏览器。
- 不增加云同步、自动发送、支付、多人协作、搜索或复杂报表。
- 页面必须按屏幕宽度自动适配，最终用户没有手机版/网页版切换控件。
- 今日行动只显示承诺付款日已过、逾期、已到跟进日、当天到期或未安排跟进的待开票记录。
- 状态、金额和日期规则继续由 `src/domain.js` 统一计算。
- 每次业务逻辑变更都先写失败测试；不执行 Git 提交或发布。

---

## File Map

| 文件 | 职责 |
|---|---|
| `src/domain.js` | 将今日队列限制为真正需当日处理的记录 |
| `tests/domain.test.js` | 验证未来未到期记录不会进入今日行动 |
| `index.html` | 更新今日页的温暖陪伴文案与信息提示 |
| `src/styles.css` | 实现方案 B 的暖色、行动引导和响应式视觉 |

### Task 1: 修正今日行动队列

**Files:**
- Modify: `tests/domain.test.js`
- Modify: `src/domain.js`

**Interfaces:**
- Consumes: `deriveReceivable(record, today) -> DerivedReceivable`，其中包含 `needsActionToday` 和 `actionPriority`。
- Produces: `getTodayQueue(records, today) -> DerivedReceivable[]`，仅含 `needsActionToday === true` 且未暂停、未收款的记录。

- [x] **Step 1: 将现有队列测试改为只期待需处理记录**

在 `tests/domain.test.js` 的“今日队列把承诺已过和逾期记录排在未来到期记录前”用例中，保留 `future`、`overdue`、`promised` 三条数据，并将断言替换为：

```js
const queue = getTodayQueue([future, overdue, promised], '2026-09-12');
assert.deepEqual(queue.map((item) => item.clientName), ['承诺客户', '逾期客户']);
assert.equal(queue.some((item) => item.clientName === '未来客户'), false);
```

- [x] **Step 2: 运行该测试并确认失败**

Run: `npm test -- tests/domain.test.js`

Expected: FAIL；当前实现仍返回“未来客户”。

- [x] **Step 3: 最小化修改队列过滤逻辑**

在 `src/domain.js` 的 `getTodayQueue` 中，将现有状态过滤替换为：

```js
.filter((record) => record.needsActionToday)
```

保留现有 `actionPriority`、截止日、客户名称排序，不改动 `deriveReceivable` 的状态计算。

- [x] **Step 4: 运行领域测试并确认通过**

Run: `npm test -- tests/domain.test.js`

Expected: PASS，所有领域测试通过。

### Task 2: 应用方案 B 的今日页文案

**Files:**
- Modify: `index.html:35-74`

**Interfaces:**
- Consumes: 现有 `#metric-*`、`#queue-count`、`#today-list`、`data-new-record`、`data-view`、`#export-backup`、`#import-backup` DOM 接口。
- Produces: 不改变 JavaScript 选择器的温暖陪伴版首页结构和文案。

- [x] **Step 1: 更新用户可见文案**

保留所有 ID 和 `data-*` 属性。将指标卡第 3 项的小字改为“今天只处理最关键的几笔”，将第 4 项标题改为“7 天内到期”，并将侧栏引导文案改为：

```html
<p class="eyebrow">今天的回款进度</p>
<h2>先完成最关键的 1—3 笔</h2>
<p>不用一次清空所有事项。处理一笔，就离回款更近一步。</p>
```

这同时修正“逋期”和“到到期”两个错别字。

- [x] **Step 2: 在浏览器验证页面绑定仍可用**

Run: `python -m http.server 4173`

Manual check at: `http://localhost:4173`

Expected: 新建按钮、列表、备份按钮和导航仍可操作；控制台无找不到元素的错误。

### Task 3: 实现温暖陪伴视觉系统

**Files:**
- Modify: `src/styles.css:1-224`

**Interfaces:**
- Consumes: 既有 CSS 类名和响应式断点（1020px、760px、390px）。
- Produces: 方案 B 的暖白背景、橙色重点、柔和圆角、行动导向卡片和自动响应式布局。

- [x] **Step 1: 更新主题变量**

将根变量调整为暖色系，使用以下关键值并保持变量名不变：

```css
--ink: #422006;
--muted: #7c6657;
--line: #f0dfcf;
--paper: #fffdf9;
--canvas: #fff8ef;
--primary: #c2410c;
--primary-dark: #9a3412;
--primary-soft: #ffedd5;
--accent: #f97316;
--danger: #c2410c;
--danger-soft: #fff0e6;
--radius: 20px;
```

- [x] **Step 2: 强化行动引导视觉**

在 `.focus-card`、`.metric-card.emphasis`、`.action-panel`、`.receivable-card.is-overdue` 和 `.button.primary` 的现有规则中，使用暖白底、橙色渐变、柔和阴影和圆角；逾期金额与逾期左边线仍需有足够对比度。不要改变 HTML 类名或遮蔽金额、状态信息。

- [x] **Step 3: 保持手机自动适配**

在既有 `@media (max-width: 760px)` 中，保留单列指标、固定底部导航和 44px 最小操作区域；将移动端 `focus-card` 从 `display: none` 改为显示，使手机用户也能看到当日回款引导。

- [x] **Step 4: 进行桌面与手机宽度视觉验收**

Manual check at: `http://localhost:4173`

Expected:

1. 桌面宽度下页面呈温暖、低压力的行动工作台，不再是冷色财务面板。
2. 窄至 390px 宽度时内容单列、无水平滚动，底部导航可见。
3. 金额、逾期标签、主要按钮和操作入口保持清晰可辨。
4. 用户无需点击任何“模式切换”控件。

### Task 4: 回归验证与文档同步

**Files:**
- Modify: `docs/superpowers/plans/2026-09-12-warm-ui-and-today-queue.md`

**Interfaces:**
- Consumes: Task 1—3 的已完成改动。
- Produces: 可复现的测试和人工验收记录。

- [x] **Step 1: 运行完整自动化测试**

Run: `npm test`

Expected: PASS，0 failures。

- [x] **Step 2: 验证关键业务路径**

Manual check:

1. 首次加载示例数据后，今日行动不显示“未来客户”。
2. 打开逾期记录，登记部分到账后剩余金额更新。
3. 记录跟进后，今日行动排序符合承诺超期、逾期、到期的优先级。
4. 在手机宽度下执行新建、跟进、到账和催款文案复制。

- [x] **Step 3: 在本计划中勾选已完成步骤并记录事实结果**

在每项执行完成后，将对应 `- [ ]` 改为 `- [x]`。在文末新增“Execution Record”小节，如实写入实际执行日期、`npm test` 的通过数量、桌面视觉检查结果和手机视觉检查结果；不得使用占位文本。

## Execution Record

- 2026-09-12：`npm test` 通过 30 项，失败 0 项。
- 2026-09-12：本地静态服务返回 HTTP 200。
- 2026-09-12：桌面端方案 B（温暖陪伴）和加大字号版本已由用户在浏览器中确认。
- 2026-09-12：用户确认手机端关键交互可用，同意进入下一阶段。
