# One World · 一方世界

木质相框中的八幕微缩世界：森林秘境、深蓝之境、云端山谷、雪夜小屋、星空天文台、竹林幽径、纸影古城和云间列车。网页只显示场景图片，保持原比例，剩余区域为纯黑。

## 本地运行

需要 Node.js 22 或更新版本，无需安装 npm 运行依赖。

```sh
git clone https://github.com/Corden404/One-World.git
cd One-World
npm run dev
```

打开 http://127.0.0.1:4173。执行 `npm run check` 检查 JavaScript 语法、场景素材、灯光隔离、循环滚动与传感器逻辑。

浏览器回归检查使用开发依赖 Playwright：执行 `npm ci`、`npx playwright install chromium`，再执行 `npm run check:browser`。检查覆盖项目子路径、加载失败重试、正反向滚轮循环、手机素材切换、静态回退和 WebGL 上下文恢复。检查输出位于忽略的 `output/playwright/`。

## 交互

- 向下滚动或向上滑动：当前幕逐渐改变光照，镜头向下经过木纹连接区域进入下一幕。下一幕保持独立的原始亮度。
- 滚轮向前探索时，每幕完全进入黑夜后停留约 1 秒；期间滚动不累积，停留结束后继续滚动才移动镜头。反向滚动可立即回退。
- 停止滚动可停在任意进度，反向滚动可连续回退；最后一幕经连接区域回到森林，支持循环探索。
- 鼠标移动、水平触控或手机倾斜：产生基于深度图的视差。转屏后重新校准握持角度。
- 手机倾斜以首次有效读数为握持基准，横竖方向支持相对倾斜至 30°，超过后保持最大视差。
- 需要传感器授权的手机首次轻触场景后选择允许；传感器需要 HTTPS 或本机 localhost。没有传感器或拒绝授权时仍可触控探索。
- 日夜纹理共用深度网格，混合时有轻微模糊，端点清晰，外圈木框保持稳定。
- `D` 切换景深，`M` 请求传感器授权。系统启用「减少动态效果」时停用视差与过渡模糊。

首次访问只加载当前幕的日夜图片与深度图；开始滚动后再准备下一幕和连接区。小屏触控设备使用 768 像素宽的图片，场景比例和深度图保持一致。图像加载失败会有限重试；网络恢复或重新进入场景时可以再次加载。

渲染器复用最多两个 WebGL 上下文，并缓存网格、着色器和最近使用的纹理。仅进入视口的场景绘制；静止且无视差动画时停止重绘和动画帧调度。小尺寸场景使用较低网格密度。

## GitHub Pages

本项目可以直接部署到 GitHub Pages。`dist/` 已包含完整 HTML、CSS、JavaScript、WebP 场景和预生成深度图。浏览器运行 WebGL；Python 和深度模型只用于离线准备素材，无需服务器运行。

1. 在仓库 **Settings → Pages → Build and deployment** 中将 **Source** 设为 **GitHub Actions**。
2. 推送到 `main` 会自动运行检查并发布；也可通过 **Actions → Deploy GitHub Pages → Run workflow** 手动运行。
3. 工作流通过单元检查与浏览器检查后上传 `dist/` 并部署。页面地址为 https://Corden404.github.io/One-World/ 。

拉取请求运行相同检查。代码和资源使用相对路径，可在 `/One-World/` 项目子路径下运行。部署只上传 `dist/`，README、开发脚本与测试不会成为站点资源。

GitHub 官方说明：[GitHub Pages 概览](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[使用自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 代码与素材

| 路径 | 用途 |
| --- | --- |
| `dist/scenes.js` | 场景图片、光照版本、深度图与连接区配置 |
| `dist/journey.js` | 线性滚动区间和循环坐标 |
| `dist/depth-view.js` | WebGL 深度网格、纹理混合与 GPU 资源管理 |
| `dist/motion.js` | 手机权限、相对倾斜、横竖屏映射和旋转速率回退 |
| `dist/assets.js`、`dist/geometry.js` | 手机素材选择与缓存深度网格生成 |
| `dist/assets/` | 浏览器直接使用的压缩图片和深度图 |
| `scripts/serve.mjs` | 本地静态 HTTP 服务 |
| `scripts/prepare-assets.py` | 可选的离线素材处理工具 |
| `tests/interaction.test.mjs` | 交互与素材完整性检查 |
| `scripts/check-browser.mjs` | 浏览器与 WebGL 回归检查 |

素材处理工具需要自行提供上一级目录中的源图和 Depth Anything V2 Small ONNX 模型，并在 conda `dev` 环境安装 Pillow、NumPy、ONNX Runtime。仓库已有处理后的素材，运行和部署无需重新生成，也无需下载模型。

脚本将素材输出到当前项目的 `dist/assets/`。运行 `python scripts/prepare-assets.py --mobile-only` 可从已有部署图片重新生成手机尺寸素材，无需源图或深度模型。未使用素材的本地恢复副本可放在忽略的 `.trash/`，不会随站点发布。

## 技术与许可

- 深度网格与边缘固定方法改编自 [Tiefling](https://github.com/combatwombat/tiefling)，MIT 许可保留于 `dist/LICENSE-Tiefling.txt`。
- 离线深度图使用 Depth Anything V2 Small，模型采用 Apache 2.0 许可；仓库不包含模型。
- 场景与木纹连接区包含生成的图片素材。剪纸场景通过纸层、阶梯、河道与铁路突出纵向景深。
- 运行时为纯静态 HTML、CSS、JavaScript，没有服务端、账户或数据库依赖。
