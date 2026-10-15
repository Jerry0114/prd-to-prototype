# 开源版本与首次发布

官方仓库：[Jerry0114/prd-to-prototype](https://github.com/Jerry0114/prd-to-prototype)。

## 抽离范围

本版基于 2026-09-21 本机已安装 Skill 的通用核心提取，来源文件相对路径及提取时 SHA-256 记录于 [upstream-snapshot.json](upstream-snapshot.json)。这是输入快照，不是发布文件校验和；未导入任何原仓库历史。

保留需求追溯、两道确认关卡、模块标注 v2.1、人工标注持久化、Markdown 文档预览、标准查看器及核心迁移工具。

排除了企业专用移动端／运营后台 Kit、配套初始化与检查脚本、字体、图标、品牌图片、内部产品案例、旧发布包和系统缓存。查看器改用从零绘制的通用 SVG；案例是从零编写的任务板。命令不依赖作者目录、内网服务或其他技能。两个专用 Kit 测试不在公开范围，保留通用回归测试并新增独立包检查。

公共版的同步器只处理显式指定的项目及该项目下的模板镜像，不再隐式写入命令工作目录的模板。预览服务增加了符号链接越界检查、隐藏文件限制和写入来源检查。查看器的状态按钮按页面规格的适用状态显示，兼容无规格的旧项目。这些是本版独立改动。

## 发布检查

1. 运行 `npm run check`，并在浏览器验收受影响的流程。
2. 查看 `git status --short` 和 `git diff --cached`，只提交本开源目录。不要在内部工作区根目录执行 `git add .`。
3. 本包预置 MIT 许可证。发布前由维护者确认自己有权以该许可证授权代码；第三方 Marked 原许可证须保留。
4. 新建空 GitHub 仓库，使用公开仓库地址作为 remote。仓库名建议 `prd-to-prototype`。
5. 使用自己的提交身份；若希望隐藏邮箱，使用 GitHub 账号提供的 noreply 邮箱。不要复用内部提交历史。

下面命令从本开源包根目录执行，先将占位地址替换为实际仓库：

```bash
git init -b main
git add .
git diff --cached --stat
git commit -m "Initial public release"
git remote add origin https://github.com/YOUR_ACCOUNT/prd-to-prototype.git
git push -u origin main
```

以上命令适用于首次发布到新仓库；已有仓库继续使用现有 remote 提交和推送。自动扫描只覆盖已定义模式，不是对所有形式敏感信息或知识产权归属的证明。二进制文件需人工查看；后续新增业务案例需要重新审阅。
