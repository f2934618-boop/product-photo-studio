# 第三方来源

- `vendor/refine.py`：原样复制自 [thhanns/local-background-remover](https://github.com/thhanns/local-background-remover/blob/main/refine.py)，MIT，Copyright (c) 2026 Ann。完整许可在 `licenses/local-background-remover.txt`。当前原型仅调用 guided_filter 与 sharpen_alpha。
- `engine.py` 中 ONNX 预处理参考 [danielgatis/rembg](https://github.com/danielgatis/rembg)，MIT。许可在 `licenses/rembg.txt`。该文件为新编写的整合代码。
- U²-Net / ISNet 模型来自 rembg 官方 GitHub release，下载脚本校验上游 MD5。模型源项目为 [U-2-Net](https://github.com/xuebinqin/U-2-Net) 和 [DIS](https://github.com/xuebinqin/DIS)，许可保存在 `licenses/`。
- `upstream/` 与 `research/` 是研究时下载的原仓库副本，保留各自原始许可。它们未作为本原型运行服务。

网页版使用 ONNX Runtime Web (MIT)、fflate (MIT)、Vite (MIT)。ISNet 与 U²-Net 模型使用上游 Apache-2.0 许可。发布包 LICENSES.txt 汇总许可。

界面图标取自 @phosphor-icons/core 2.1.1 (MIT)，仅嵌入本应用使用的图标，许可一并包含在发布包。

网页版的界面、工作流、修补蒙版、灰度引导滤波和 Canvas 模板为本项目实现，不包含上述 Python 实验代码或研究仓库。

festive.png 是为本项目生成的节庆背景：红金摄影棚、空白标题区域、底部展台，无文字、无商标、无商品。实际商品始终从原图抠图后合成。
