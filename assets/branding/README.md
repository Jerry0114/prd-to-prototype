# PRD to Prototype Logo

单一折带组成 P，中央的三角留白带出向前与运行的含义。沿用知觉蓝 `#2537B8`，白色实心图形在小尺寸下保持可辨识的轮廓。

- `prototype-mark-ai.png`：OpenAI 官方 imagegen 内置工具生成的设计原图，保留透明背景。
- `../prototype-viewer/prototype-mark.svg`：依据生成轮廓整理的矢量成品，用于查看器、文档阅读器、示例页和 favicon。清除生成图中的轻微纹理，统一为纯色。
- `prototype-mark.png`：从 SVG 导出的 512 × 512 透明 PNG。
- `prototype-mark-white.svg`：透明背景的白色单色标志，适合深色底。

## 生成提示词

使用 OpenAI 内置 imagegen；未使用第三方图像接口或 CLI。模型具体版本由内置工具管理。

```text
Use case: logo-brand.
Asset type: final app icon for PRD to Prototype, an open-source tool that turns product requirements into interactive prototypes.
Primary request: design a remarkably simple, confident, premium software symbol. A single white folded ribbon forming an abstract capital P, its open counter cut as a crisp forward-pointing triangular negative space. The meaning is a document becoming an actionable interface. Prioritize one coherent silhouette with generous negative space, not several overlapping pictograms. Think excellent independent design-tool branding, clear at 16px.
Composition: one icon only, perfectly frontal and centered. Solid cobalt #2537B8 rounded square with corner radius about 24 percent of width; bold white glyph occupying about 58 percent width and 64 percent height. Small transparent margin outside the square. Exactly two flat colors, white and cobalt. All edges extremely clean and vector-like.
Style: mathematical geometric construction, optically balanced, quiet and distinctive. Flat 2D, no shading, no gradient, no texture, no shadows, no mockup. No text or wordmark or letters outside the symbol. No stacked pages, no arrows crossing outlines, no tiny horizontal document lines, no knot, no OpenAI or ChatGPT logo resemblance. Single polished finished icon, not a concept sheet. Transparent outside the rounded square.
```
