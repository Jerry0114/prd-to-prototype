# 中间模型说明

## 路径约定

中间模型和原型文件都以 `<原型目录>` 为相对路径基准。新项目默认使用业务项目根目录下的 `prototype/`；PRD、项目规则和其他输入资料可以留在业务项目根目录或其 `docs/` 中，但不得把原型产物写回业务项目根目录。

## 1. `requirements.json`

它回答“PRD 到底说了什么”。每条需求必须具备稳定 ID、原文位置、语义分类和确认状态。

关键字段：

| 字段 | 说明 |
| --- | --- |
| `sourceDocuments` | 输入文档、相对路径与当前文件 `sha256` |
| `requirements[].sourceRefs` | 可在声明行号范围内精确核验的原文短引文 |
| `classification` | `explicit / inferred / proposed / unresolved` |
| `confirmationStatus` | `confirmed / needs-confirmation / rejected` |
| `prototypeCritical` | 缺失时是否影响原型主要流程 |
| `openQuestions` | 不能从现有材料可靠判断的问题 |

## 2. `page-map.json`

它回答“需要哪些页面，页面之间是什么关系”。先生成完整候选，再区分本轮生成、延期和阻塞页面。

`confirmation.status` 是强制关卡：

- `draft`：智能体初稿；
- `needs-confirmation`：等待产品确认；
- `confirmed`：已有明确确认依据，可继续生成。

确认时同时写入 `confirmation.confirmedBy: "user"`、确认依据、时间和 `requirementsSha256`。需求模型内容变化后，页面地图确认自动失效，必须重新核对页面范围。

`pages[].implementationStatus` 使用 `built / planned / deferred / blocked`。只有 `built` 页面必须存在对应 page spec 和 HTML；其余页面必须写明原因。

## 3. `page-briefs/<page-id>.md` 与 `page-brief-gate.json`

逐页定义文档回答“这个页面应该怎么做”。本轮每个 `built` 或 `planned` 页面必须且只能对应一份独立 MD，至少包含：

- 页面定位、目标用户和使用场景；
- 页面功能结构或信息架构；
- 内容与数据规则；
- 关键交互、路由与返回关系；
- 正常、加载、空、失败、无权限、失效等适用状态；
- 原型制作说明和待确认项。

默认生成路径为 `intermediate/page-briefs/<page-id>.md`。用户已提供结构完整的逐页权威规格时，不重复生成或修改原文，只在关卡中以 `origin: "provided"` 登记其相对路径。

`page-brief-gate.json` 回答“这些逐页定义是否已经被用户确认”。核心字段：

- `enabled`：默认 `true`；只允许在用户明确要求时关闭；
- `status`：`draft / needs-confirmation / confirmed / bypassed`；
- `targetPageIds`：必须与页面地图中本轮 `built`、`planned` 页面完全一致；
- `pageMapSha256`：逐页确认时的页面地图哈希；页面范围或连接变化后自动失效；
- `documents[]`：逐页登记 `pageId`、标题、唯一路径、来源、`openQuestionsResolved`、确认状态、确认人、时间、证据和 SHA-256；
- `bypass`：关闭开关时必须记录用户授权、时间、原因和原话证据。

每份文档只有在 `confirmedBy: "user"`、`openQuestionsResolved: true` 且哈希与文件当前内容一致时才视为有效确认。每个页面必须使用独立的 `.md` 路径，技能生成文档还必须在 frontmatter 中声明一致的 `page_id`。确认后修改 MD 会使关卡失效，必须重新确认。开关关闭只跳过逐页定义确认，不跳过来源一致性和页面地图确认。

## 4. `page-specs/<page-id>.json`

它回答“单页具体如何实现和说明”。每份规格只描述一个页面，至少包含：

- 页面目标和来源需求；
- 信息优先级和布局区块；
- 字段与数据规则；
- 操作、跳转和失败反馈；
- 正常、空、错误、无权限等适用状态；
- 开发视角页面说明及 DOM 锚点；
- 待确认项与设计系统引用。

### 4.1 模块标注 v2.2

新生成页面在 `handoff.version` 使用 `2.2`，目标为 `implement-without-opening-prd`。`2.0 / 2.1` 继续兼容；v2.1 仍要求定义与至少三维度，新版按对象需要声明维度，不自动迁移旧规格。完整规则见 `annotation-authoring-rules.md`。

关键字段：

| 字段 | 说明 |
| --- | --- |
| `fields[].controlType` | 控件类型，用于判断是否需要枚举或动态数据源 |
| `fields[].options` | 固定选项、值和业务含义 |
| `fields[].defaultValue` | 初始值；空值语义同时写入 `dataRule` |
| `fields[].dataSource` | 动态选项或字段数据来源；演示数据与生产数据分开说明 |
| `actions[].logic` | 请求、分页、加载、成功、空结果、失败和并发处理 |
| `handoff.pageOverview` | v2.2 可选背景，只写有实际信息的角色、特殊入口、出口和前置条件；分组可为空或省略，description 不必复述 label |
| `states[]` | 页面正常、加载、空、失败、无权限和失效状态是否适用及其规则说明，不等同于相应画面已实现 |
| `handoff.statusTransitions` | 业务对象的起始状态、触发条件、目标状态和规则；无变化时使用空数组 |
| `annotations[].title` | 被说明对象的名称，例如页面区域、卡片、字段、按钮或状态；不能写规则结论 |
| `annotations[].content` | 对该对象的完整说明；需要区分模块定义、展示内容、数据规则、交互逻辑、异常与状态、布局、合规或关联文档时，在同一字符串中用空行分段 |
| `annotations[].scope` | `module` 表示一级模块主标注，`page` 表示全页状态或跨模块规则，`element` 表示补充元素说明 |
| `annotations[].moduleId` | `scope=module` 时必填，必须与一个 `sections[].id` 一致且一一对应 |
| `fields[] / actions[] / states[].moduleId` | 字段、动作必填；局部状态填写，页面状态省略；用于归属和增量覆盖 |
| `annotations[].requiredDimensions` | 该对象的必需维度，与页面策略合并验证；正文不能为空或占位 |
| `annotations[].ruleSources` | 可选规则来源：维度、明确/实现/推断/建议/未决分类、相关需求和依据说明 |
| `annotations[].covers` | 标注覆盖的 `section / field / action / state` 对象 |
| `sections[].changeStatus` | 增量页面使用，标记 `new / changed / impacted / unchanged` |
| `sections[].changeReason` | 说明本轮为何需要或不需要标注，`change-impact` 下必填 |
| `handoff.annotationPolicy.coverageScope` | `full-page` 表示全页标注，`change-impact` 表示只标注本轮变更影响范围 |
| `openQuestions[]` | 待确认问题、影响、状态、当前假设和需求引用 |
| `handoff.acceptanceCriteria` | 使用 GIVEN / WHEN / THEN 表达的页面验收标准 |

查看器按“标注 / 页面说明”展示，默认标注。页面说明内按需展开背景、异常规则和验收清单；文档紧凑显示，未决问题有计数并优先展示，空区块隐藏。模型字段保留兼容；v2.2 只声明实际适用的 coverageDimensions（需包含 acceptance），不强制凑六类或填泛化角色。旧版仍要求完整背景组。

本轮范围内的区块、字段、操作及适用局部状态必须有标注覆盖；全页状态在“异常与业务规则”保留。具体异常区分当前页面触发与恢复路径；验收清单不代表验证结果。选择型字段提供固定选项或动态数据来源。

v2.2 要求：

- `sections[]` 是页面一级业务模块清单，不只是方便布局的容器；
- 新建或整体重构页面使用 `full-page`，每个 section 恰好对应一条模块主标注；
- 既有页面增量改造使用 `change-impact`，只为 `new / changed / impacted` section 生成模块主标注，`unchanged` section 不生成 marker；
- 每条主标注至少一段有效说明，按模块类型选择维度；页面 `requiredDimensions` 可为空，单条补充必需维度。不为凑段落复述定义或复制公共说明；
- 字段/操作/局部状态默认继承模块变更范围，例外通过自身 `changeStatus/changeReason` 声明；变更子项的父模块需纳入影响范围；
- 同一模块只覆盖自身所属对象；来源引用按实际规则选择，不能整页照抄；
- 页面级状态只有在本轮修改全页状态时才使用 `scope=page` 补充，不能替代模块主标注；
- 标注锚点必须绑定模块自身的稳定 DOM ID。

`intermediate/annotation-source.json` 是可选的可重跑规则输入，结构为 `pages[{id, modules[{id, content, data, interaction, state, layout, compliance, docs, ...}]}]`；它不是页面渲染数据。重跑未提供的维度保留，显式 `removeDimensions` 才删除，匹配失败不部分写入。规范标注在 page-spec，prototype.json 仅为镜像；人工差异层独立合并。

标注只保留“标题 + 内容”两个正文字段。标题回答“当前说明的是哪个模块或元素”；内容集中记录该对象的定义、展示、数据、交互、状态和关联文档，复杂规则使用段落标题与空行分隔。同一对象存在多条标注时，标题可以写为“筛选区 · 字段说明”“筛选区 · 查询逻辑”，但不能写成“查询后回到第一页”这类动作结论。

## 5. 追溯链

稳定追溯关系为：

```text
PRD 文件 SHA-256 + 可核验原文行号
  → requirements[].id
  → requirements.json SHA-256 + page-map.pages[].requirementRefs
  → page-map.json SHA-256
  → page-briefs/*.md + page-brief-gate.json 用户确认与文件哈希
  → page-spec.requirementRefs / annotations[].requirementRefs
  → prototype.json 页面与标记
  → HTML DOM anchorId
```

任何一层不能建立关系时，都应产生警告或错误，不通过自然语言解释绕过。
