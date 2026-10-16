# 项目设计系统

开源版只附带通用查看器，不内置企业组件、商标、商业字体、专用图标或内部规范。

1. 先读取目标项目已有设计规则，确认 Web 或 mobile、视口、品牌和主题。
2. 使用项目已有且允许使用的资源；未提供时采用本地 CSS、系统字体和简单 SVG，不默认安装外部组件库或请求在线服务。
3. 在 `page-specs/*.json` 的 `designSystemRefs` 中记录实际引用的项目文件；不要声称不存在的设计系统检查已通过。
4. Web 至少检查 1440px 与 1280px；移动端至少检查 390px 与 375px。检查中文换行、溢出、状态和关键交互。
5. 查看器品牌与业务品牌分开。需要更换查看器图标时，修改当前 Skill 副本的 `assets/prototype-viewer/prototype-mark.svg`，再运行 `sync_viewer.js`。商业项目素材不应复制回公共仓库。

`examples/task-board/` 是从零编写的虚构任务管理案例。其确认记录仅为校验夹具，不是任何真实用户的授权；处理新 PRD 时必须重新获取页面范围与逐页定义确认。

## 原生下拉组件

没有项目专用下拉组件时，查看器和业务原型共用 `assets/prototype-viewer/select-controls.css`；同步器会将其复制到原型根目录。业务 HTML 在自身 CSS 后引入，例如位于 `pages/` 的页面：

```html
<link rel="stylesheet" href="../assets/project.css">
<link rel="stylesheet" href="../select-controls.css">
```

- 单选保留真实 `<select>` 与 `<option>`、可访问名称和键盘操作，仅自定义收起状态的箭头。
- 箭头 12 × 12px，距尾端 12px，垂直居中；起始文字留白 12px，尾端预留 36px，长选项不能覆盖箭头。
- 高度、字体、背景色、边框与焦点跟随所属页面；不要用后加载的 `background` 或 `padding` 简写清除共享箭头与留白。
- 多选或 `size > 1` 的列表不加单选箭头；RTL 将箭头移至左侧，系统强制颜色模式恢复原生箭头。
- 验证业务原型和运行预览中的选项切换，以及 375px、855px 与桌面布局。已有设计系统的独立组件不强行覆盖，但仍检查箭头与文字间距。
