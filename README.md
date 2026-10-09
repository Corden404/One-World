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

## 交互

- 向下滚动或向上滑动：当前幕逐渐改变光照，镜头向下经过木纹连接区域进入下一幕。下一幕保持独立的原始亮度。
- 停止滚动可停在任意进度，反向滚动可连续回退；最后一幕经连接区域回到森林，支持循环探索。
- 鼠标移动、水平触控或手机倾斜：产生基于深度图的视差。转屏后重新校准握持角度。
- 需要传感器授权的手机首次轻触场景后选择允许；传感器需要 HTTPS 或本机 localhost。没有传感器或拒绝授权时仍可触控探索。
- 日夜纹理共用深度网格，混合时有轻微模糊，端点清晰，外圈木框保持稳定。
- `D` 切换景深，`M` 请求传感器授权。系统启用「减少动态效果」时停用视差与过渡模糊。

## GitHub Pages

本项目可以直接部署到 GitHub Pages。`dist/` 已包含完整 HTML、CSS、JavaScript、WebP 场景和预生成深度图。浏览器运行 WebGL；Python 和深度模型只用于离线准备素材，无需服务器运行。

1. 在仓库 **Settings → Pages → Build and deployment** 中将 **Source** 设为 **GitHub Actions**。
2. 打开 **Actions → Deploy GitHub Pages → Run workflow**，选择 `main` 后运行。
3. 工作流通过检查后上传 `dist/` 并部署。页面地址为 https://Corden404.github.io/One-World/ 。

附带工作流仅手动触发。代码和资源使用相对路径，可在 `/One-World/` 项目子路径下运行。部署只上传 `dist/`，README、开发脚本与测试不会成为站点资源。

GitHub 官方说明：[GitHub Pages 概览](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[使用自定义发布工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 代码与素材

| 路径 | 用途 |
| --- | --- |
| `dist/scenes.js` | 场景图片、光照版本、深度图与连接区配置 |
| `dist/journey.js` | 线性滚动区间和循环坐标 |
| `dist/depth-view.js` | WebGL 深度网格、纹理混合与 GPU 资源管理 |
| `dist/motion.js` | 手机权限、相对倾斜、横竖屏映射和旋转速率回退 |
| `dist/assets/` | 浏览器直接使用的压缩图片和深度图 |
| `scripts/serve.mjs` | 本地静态 HTTP 服务 |
| `scripts/prepare-assets.py` | 可选的离线素材处理工具 |
| `tests/interaction.test.mjs` | 交互与素材完整性检查 |

素材处理工具需要自行提供上一级目录中的源图和 Depth Anything V2 Small ONNX 模型，并在 conda `dev` 环境安装 Pillow、NumPy、ONNX Runtime。仓库已有处理后的素材，运行和部署无需重新生成，也无需下载模型。

## 技术与许可

- 深度网格与边缘固定方法改编自 [Tiefling](https://github.com/combatwombat/tiefling)，MIT 许可保留于 `dist/LICENSE-Tiefling.txt`。
- 离线深度图使用 Depth Anything V2 Small，模型采用 Apache 2.0 许可；仓库不包含模型。
- 场景与木纹连接区包含生成的图片素材。剪纸场景通过纸层、阶梯、河道与铁路突出纵向景深。
- 运行时为纯静态 HTML、CSS、JavaScript，没有服务端、账户或数据库依赖。
