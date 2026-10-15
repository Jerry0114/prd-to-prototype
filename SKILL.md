---
name: prd-to-prototype
description: 将 Markdown PRD 转换为可追溯需求模型、页面地图、逐页定义、确认关卡和可交互的 Web 或移动端 HTML 原型；内置多页面查看器、模块标注、本地备注持久化和结构校验。适用于从需求文档制作或更新原型、开发交付说明和页面跳转验证，不用于直接交付生产应用。
---

# PRD 原型生成

## 目标

把 PRD 转换成“可解释、可确认、可验证”的 HTML 原型。下文命令均从本 Skill 根目录运行；安装到其他路径时按实际位置调用脚本，不依赖作者电脑目录。

始终保留原文来源，明确区分需求事实与智能体推断。页面范围和逐页定义必须分别确认；默认只有两道确认关卡均通过后，才开始逐页实现。

## 项目目录隔离

新项目必须区分“业务项目根目录”和“原型产物目录”：

- 业务项目根目录保留 PRD、需求资料、项目文档、源代码和其他业务资产；
- 原型产物统一放在业务项目根目录下的 `prototype/` 目录；
- `prototype/` 是所有原型命令的工作目录，后文命令中的 `<原型目录>` 均指向它；
- `intermediate/`、`prototype.json`、`pages/`、`assets/`、`annotations/`、查看器文件等生成文件不得散落在业务项目根目录；
- 新项目开始时先运行 `scripts/init-prototype-project.mjs --project <项目根目录>` 创建 `prototype/`，再把生成、校验和预览命令的 `--project` / `--target` 指向该目录；
- 已有把原型文件直接放在项目根目录的案例继续兼容，不自动移动、覆盖或删除；新一轮改造优先使用 `prototype/`，如需迁移必须由用户明确授权。

原型目录初始化示例：

```bash
node scripts/init-prototype-project.mjs \
  --project "my-project"
```

## 工作流

1. 定位 PRD、项目规则、设计系统、合规和脱敏规则；记录缺失输入，不伪造内容。
2. 按 `references/interpretation-rules.md` 提取 `requirements.json`，为每份来源记录 SHA-256，为每条需求保留可在对应行号内精确核验的原文短引文、分类、置信度和确认状态。
3. 生成 `page-map.json`，列出完整页面候选、目录层级、入口出口、状态、跳转、覆盖关系和未生成原因；同时记录当前 `requirements.json` 的 SHA-256。
4. 在页面地图确认关卡暂停。向产品经理展示页面清单、层级、关键流程、未覆盖项和待确认问题；未经确认不得把页面范围标记为 `confirmed`。
5. 为本轮每个 `built` 或 `planned` 页面准备一份独立页面定义 MD。默认生成到 `intermediate/page-briefs/<page-id>.md`；用户已提供结构完整的逐页规格时，可原样登记为 `origin: "provided"`，不复制、不改写权威原文。页面定义至少包含页面定位、用户与场景、功能结构或信息架构、内容与数据规则、关键交互与路由、页面状态、原型制作说明和待确认项，模板见 `references/page-brief-template.md`。
6. 创建 `intermediate/page-brief-gate.json`，默认 `enabled: true`、`status: "needs-confirmation"`。一次性向产品经理展示页面地图和每份页面定义 MD，逐页说明定位、结构、关键逻辑与待确认项，然后暂停；未经用户明确确认，不得生成业务 HTML、CSS、JS 或把关卡标记为 `confirmed`。
7. 用户确认后，为每份 MD 记录 `confirmedBy: "user"`、确认时间、确认依据、待确认项已关闭状态和 SHA-256，并在关卡中记录当前 `page-map.json` 的 SHA-256，再运行 `scripts/check_page_brief_gate.js`。来源、需求模型、页面地图或逐页 MD 任一层在确认后变化，均使下游确认失效。
8. 判断设计资产。读取 `references/design-system.md`，按目标端与项目已有规范选择通用或用户提供的设计系统；记录资产来源与适用范围。
9. 为确认生成的每个页面创建独立的 `page-specs/<page-id>.json`。按开发交接视角定义字段、区块、交互、状态和页面说明；关键交付页面使用模块完整标注 v2.1，并完整读取 `references/annotation-authoring-rules.md`。
10. 运行 `scripts/sync_viewer.js --project <原型目录>`，从 Skill 内置主资产复制标准查看器。不得为单个案例重新设计或重写 `index.html`、`viewer.css`、`viewer.js`；需要人工编辑标注时，通过 `scripts/serve_prototype_project.js` 启动当前项目的受限写入服务。
11. 生成或更新业务 HTML 页面和 `prototype.json`。允许页面采用不同技术栈，但每页必须输出独立 HTML 入口并遵守查看器消息协议；写入可见文案前必须完成目标用户视角审查，研发规则只进入页面规格和标注。
12. 让页面说明优先绑定稳定 DOM 锚点，同时保留文档百分比坐标作为回退；不使用查看器窗口坐标。
13. 运行确定性校验；再按项目设计系统运行实际可用的检查。修复错误后交付原型、验证报告和明确的待确认项。

## 页面定义确认关卡

页面地图和页面定义解决不同问题，不能合并为一次隐含确认：

- 页面地图确认“本轮做哪些页面、页面之间如何连接”；
- 页面定义 MD 确认“每个页面的定位、功能结构、业务逻辑和原型应该怎么做”；
- `page-specs` 是确认后的开发交付模型，不能倒过来代替实现前的产品确认。

新项目默认强制开启逐页定义确认。开关只控制这道逐页确认关卡，不会关闭页面地图确认。只有用户明确要求跳过时，才允许将 `enabled` 设为 `false`、`status` 设为 `bypassed`，并记录 `bypass.confirmedBy: "user"`、时间、原因和用户原话证据；智能体不能自行关闭，也不能用“用户要求直接实现”等推断替代明确授权。

确认前运行以下命令必须返回非零；确认或用户明确关闭后才允许继续：

```bash
node scripts/check_page_brief_gate.js \
  --project "my-project/prototype"
```

严格关卡会实际执行 JSON Schema，并校验来源文件哈希、引文行号与原文、页面地图用户确认、需求模型哈希、页面 MD 路径唯一性、文档完整性和逐层确认哈希。页面定义确认开关只跳过逐页 MD；页面地图和来源一致性仍是硬阻断。

来源文档、`requirements.json`、`page-map.json` 或页面定义 MD 发生修改后，对应下游确认立即失效，必须重新展示受影响范围并再次确认。

## 输出结构

```text
项目根目录/
├── PRD与项目资料/
└── prototype/
    ├── intermediate/
    │   ├── requirements.json
    │   ├── page-map.json
    │   ├── page-briefs/<page-id>.md
    │   ├── page-brief-gate.json
    │   ├── page-specs/<page-id>.json
    │   └── validation-report.md
    ├── prototype.json
    ├── index.html              # 从标准模板同步，不在案例内重新设计
    ├── viewer.css              # 从标准模板同步
    ├── viewer.js               # 从标准模板同步
    ├── annotation-store.js     # 人工标注差异合并与坐标换算
    ├── document-viewer.html    # 关联 Markdown 文档的统一 HTML 阅读页
    ├── document-viewer.css
    ├── document-viewer.js
    ├── document-preview-core.js
    ├── marked.umd.js           # 随查看器离线分发的 Markdown 解析器
    ├── marked.LICENSE
    ├── annotations/
    │   └── manual-annotations.json # 人工差异与当前生效备注快照，首次写入时创建
    ├── pages/
    ├── assets/prototype-viewer/prototype-mark.svg # 从 Skill 查看器主资产同步
    └── docs/
```

Schema 内置于 Skill 的 `schemas/`，校验脚本会直接读取；目标项目只保存业务产物。字段定义与示例见 `references/intermediate-models.md`。

## 标准查看器

标准查看器主资产固定在 Skill 的 `assets/prototype-viewer/`，其中包含 `index.html`、`viewer.css`、`viewer.js`、`annotation-store.js` 和品牌图片。调用原型目录下的 `templates/prototype-viewer/` 只是同步镜像，不是编辑源。标准查看器统一提供：

- 白色亮色工作台框架；
- 使用 Skill `assets/prototype-viewer/prototype-mark.svg` 中的通用页面图标；
- 每次只展示一个页面的独立画布；
- 按页面 `viewport.kind` 自动选择移动端手机容器或 Web 横向容器；
- 页面模式的节点距离画布顶部和左侧均为 `32px`，即两个 `16px` 小网格；
- 右侧按“概要、标注、状态、交付”组织页面说明，并提供标记显隐；每条标注正文只包含标题和内容，复杂规则在内容中分段；系统说明作为基线，用户可新增、修改、删除和重新定位标注，最新差异和完整快照写入项目内 `annotations/manual-annotations.json`；
- 数字标记在业务 iframe 加载后绑定页面规格中的真实 DOM 锚点；隐藏模块默认定位到打开它的可见入口，打开后迁移到真实内容，并在滚动、异步渲染和布局变化后保持同步；
- `50% / 80% / 100% / 125% / 150%` 五档缩放，页面模式默认使用 `125%`；
- 单独的流程总览入口；
- 二至三层可展开目录，并直接读取确认后的 `page-map.json`；
- 运行预览、页面状态和跨页面跳转；
- 交付页签中的关联 Markdown 文档通过标准 HTML 阅读页打开，统一使用原型工作台样式；已有 HTML 文档保持直接打开，不触发文件下载。

项目可以调整业务页面、项目名称和 `prototype.json` 数据。自定义查看器或 Logo 时，先修改当前 Skill 副本的主资产，再统一同步；不要只改生成目录而造成校验不一致。`sync_viewer.js` 始终以 Skill 查看器主资产为源，同步到项目模板镜像和目标案例。需要优化查看器时，只修改 Skill 的 `assets/prototype-viewer/`，再同步到所有案例。

页面规格的 `handoff.relatedDocs[].path` 是查看器“交付”页签可直接打开的文件路径。优先保留原始 Markdown 文档并使用从 `prototype/` 根部开始的相对路径，例如 `docs/功能需求.md`；标准查看器会将 `.md` / `.markdown` 安全转换为统一风格的 HTML 阅读页，不下载文件，也不执行 Markdown 中的原始 HTML、脚本、iframe、SVG 或越界资源。已有 `.html` / `.htm` 文档保持直接打开。需要在独立预览中提供的交付文档必须保存于当前 `prototype/` 目录；不得指向业务项目外的 PRD、源资料、Kit 规范、本机绝对路径或使用 `..` 越出原型目录。交付文档自身引用的图片和其他本地资源也必须位于当前 `prototype/` 内。

同步命令：

```bash
node scripts/sync_viewer.js \
  --project "my-project/prototype"
```

启动单项目可写服务：

```bash
node scripts/serve_prototype_project.js \
  --project "my-project/prototype"
```

查看器优先从项目文件读取人工标注，通过写入接口保存；`localStorage` 只作为服务不可用时的缓存降级。纯静态部署会显示“仅浏览器保存”，不得把该状态当作已经完成项目落盘。

## 项目设计系统

开源版不附带任何企业专用设计系统、字体、图标库或品牌素材。优先使用用户提供且有使用权的设计系统；没有时采用项目内的通用 CSS 与系统字体。Web 与移动端分别确定视口、布局和交互，避免跨端混用。参考 `references/design-system.md`。

## 解释边界

- `explicit`：PRD 或已确认项目规则直接表达。
- `inferred`：为形成完整页面或交互，根据上下文作出的低风险推断。
- `proposed`：产品或设计方案建议，必须显式标注，不能伪装成需求。
- `unresolved`：信息不足或存在冲突，必须进入待确认清单。
- 不确定的业务规则、数据口径、权限、合规要求和跳转目标不得自动标记为已确认。
- 原型中的模拟数据必须脱敏，并在页面规格、标注或交付说明中标记为演示数据；除非业务或合规要求目标用户看到，不把“演示数据”“原型反馈”等研发说明直接放进 App/Web 业务界面。
- HTML 是视觉与交互参考，不作为可直接上线的生产代码。

## 界面文案角色隔离

原型画布内的全部可见内容必须从目标用户视角审视，包括标题、说明、空状态、错误提示、Toast、按钮、Tooltip 和无障碍名称。页面规格、标注和交付说明则从产品、设计与研发视角记录完整规则，两者不能混写。

- 业务界面回答“用户现在看到什么、能做什么、下一步怎么办”，使用目标用户熟悉的业务语言。
- 固定顺序、过滤条件、排序字段、数量上限、审核状态、接口参数、来源参数、版本范围和降级策略写入 `page-specs` 与标注，不直接作为界面说明文案。
- 不在业务界面出现“固定顺序展示、按发布时间倒序、返回正常态、原型反馈、演示内容、column_id、published_at、第一期不做”等研发或产品规则措辞。
- 空、失败、权限和失效状态只解释当前结果与可执行的恢复动作，不向用户暴露缓存、审核流、接口、数据层或页面状态机。
- 交互反馈模拟真实产品结果，例如“已关闭”“分享方式已打开”；不使用“原型未真实外发”“落地页已唤起”等原型实现说明。
- 只有目标用户本身就是运营、审核、研发或管理员，且该术语属于其真实任务语言时，才允许在对应业务页面显示技术或流程规则。
- 完成页面后同时检查正常态、所有异常态和交互反馈；无法确认是否属于用户语言时，先移入标注，并在 `openQuestions` 记录待确认。

## 页面说明

页面说明的目标是让开发在不打开 PRD 的情况下完成页面主要实现，不只是提示几个重点。关键交付页面默认使用模块完整标注 v2.1，并在 `handoff.completenessTarget` 声明 `implement-without-opening-prd`。

按四层组织说明：

- **概要**：从 `purpose` 和 `handoff.pageOverview` 说明页面目的、使用角色、入口、出口及前置条件；
- **标注**：用页面数字点位解释展示规则、核心业务规则、触发结果、输入校验、异常和权限；
- **状态**：用 `states` 声明加载、空、失败、无权限、失效等页面状态，用 `handoff.statusTransitions` 声明业务状态变化；无业务状态变化时写空数组；
- **交付**：把 `openQuestions` 写成包含影响、状态和当前假设的结构化事项，并用 `handoff.acceptanceCriteria` 保存 GIVEN / WHEN / THEN 验收标准。

模块标注必须完整读取并遵守 `references/annotation-authoring-rules.md`：

- 先把页面上有独立业务目的、数据、交互或状态的一级区域列入 `sections[]`；
- 全新页面或整体重构使用 `coverageScope: "full-page"`，每个 `section` 都有独立主标注；
- 既有页面增量改造使用 `coverageScope: "change-impact"`，section 标记 `new / changed / impacted / unchanged`，只为前三类生成标注；
- 未改模块只作为页面上下文，不生成 marker；仅因插入新模块而位置下移不算受影响；
- 纳入本轮范围的每个 `section` 必须恰好有一条 `scope: "module"`、`moduleId` 与其一致的主标注；
- 一条主标注只能覆盖一个 `section:*`，不能把头部、推荐、广告、导航和内容列表压进同一条标注；
- 每条模块标注至少说明 3 个适用维度，必须包含“模块定义”；所有维度统一写入 `content`，使用段落标题和空行分隔；
- 只有本轮修改全页状态时才使用额外的 `scope: "page"` 标注；模块局部异常直接写入对应模块标注。

标注标题和内容必须严格分工：

- `annotations[].title` 只定位被说明的页面对象，使用模块、区域、卡片、字段、按钮、提示或状态名称；必要时可增加“内容说明、交互逻辑、权限说明”等维度，但不能把规则结论或具体动作写成标题；
- `annotations[].content` 说明该对象的展示构成、业务逻辑、触发条件、交互结果、输入校验、权限、异常和恢复方式；复杂内容按段落写在同一字符串中；
- 错误示例：标题“品牌文案不可图片化”、内容“主口号由 HTML 渲染”；
- 正确示例：标题“左侧品牌图”、内容“品牌图由图片底图和独立 HTML 文案构成，文字不是图片的一部分”；
- 错误示例：标题“登录目标与分流”、内容“普通成员进入首页”；
- 正确示例：标题“登录面板的进入逻辑”、内容“账号登录成功后的进入页面根据账号状态和权限确定；首次登录先进入改密页，其他账号进入其有权访问的默认页面”。

生成每个页面后，对实际 DOM 与模块清单再做一次覆盖扫描：

- 每个本轮新增、修改或受影响的一级模块必须有稳定 DOM `id`，并与 `sections[].id`、模块主标注 `moduleId` 建立一一对应；
- `full-page` 覆盖所有 section；`change-impact` 只覆盖 `new / changed / impacted` section，且禁止为 `unchanged` section 生成标注；
- 本轮范围内的 `section`、`field`、`action` 和适用状态必须被至少一个 `annotations[].covers` 覆盖；
- 选择型字段写明固定选项，或明确动态数据来源、默认值和空值语义；
- 操作写明触发条件、请求参数、分页、加载、成功、空结果、失败恢复和重复提交处理；
- 页面说明统一写入 `content`，按段落标题展开结构化规则；PRD、接口或业务规则统一写入“关联文档”段。
- 未确认的接口字段、数据全集、权限和业务口径明确标记为待确认，不伪造事实；
- 标注数量由模块数量决定，不为追求少点位合并独立模块；复杂管理页可在模块主标注之外增加字段组或操作组标注，重复列表项仍由所属列表模块统一说明。

锚点按以下优先级生成：

1. `anchor.anchorId` 指向页面内稳定且唯一的 DOM `id`；
2. `anchor.offset` 表示相对锚点的偏移；
3. `anchor.fallback` 保存参考视口下的文档百分比坐标；
4. 暂无 DOM 锚点时，将 `bindingStatus` 标记为 `fallback-only`，不得声称已完成稳定绑定。

已有案例需要迁移到“标题 + 分段内容”时，先预跑检查，再正式写入。标题与内容分别重跑；内容脚本以业务页面模块数据为准，按定义、展示、数据、交互和状态重建分段 `content`：

```bash
node scripts/rerun_annotation_titles.js \
  --project "my-project/prototype" \
  --dry-run

node scripts/rerun_annotation_titles.js \
  --project "my-project/prototype"

node scripts/rerun_annotation_content.js \
  --project "my-project/prototype" \
  --dry-run

node scripts/rerun_annotation_content.js \
  --project "my-project/prototype"
```

标题脚本只重建标注标题；内容脚本同步业务模块名称和内容规则，并按段落重建模块标注的 `content`。两者都不改动锚点、需求引用或页面实现。旧项目先运行 `scripts/migrate_annotation_model.js`，把 `type / description / details / relatedDocs` 合并为标题和分段内容。业务页面使用 `window.PrototypeData` 时，标题脚本不得把 `prototype.json` 镜像覆盖到同名业务数据文件。DOM ID 无法可靠还原中文对象名时，在项目的 `intermediate/annotation-title-overrides.json` 中提供显式标题，不能根据旧规则标题猜测。

## 验证

本包支持 Node.js 22 或更高版本；可视验收需要可用的本地浏览器或 Playwright。核心流程无需外部 API Key，通用查看器资产已内置。人工标注写入服务默认只绑定 `127.0.0.1` 并限定单个原型目录；它不提供身份认证，不用于直接对外共享。

在原型目录对应的工作区运行：

```bash
node scripts/validate_artifacts.js \
  --project "examples/task-board/prototype"
```

校验规则见 `references/validation-rules.md`。出现错误时脚本返回非零退出码；警告允许交付样例，但必须保留在报告中。

修改 Skill 脚本或 Schema 后运行回归测试：

```bash
node tests/run-tests.js
```
