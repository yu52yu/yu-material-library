# 瑜の素材库 · Yu Material Library

Windows 本地设计素材管理工具。素材保存在你自己选择的文件夹中；本仓库只保存程序源码和界面资源，不同步本地素材图片。

## 在另一台电脑使用

- 直接安装：登录 GitHub 后，在 [Releases](https://github.com/yu52yu/yu-material-library/releases) 下载 `YuMaterialLibrary-*-Setup.exe`。安装包自带运行环境，无需另装 Node.js 或 pnpm。
- 版本说明：截至 2026-10-14，主分支源码与线上安装包均为 **v0.11.6**。在 [v0.11.6 下载页](https://github.com/yu52yu/yu-material-library/releases/tag/v0.11.6) 获取最新 Windows 安装包；源码更新仍需单独构建并发布安装包。
- 查看或修改源码：克隆仓库，安装 Node.js 和 pnpm，运行 `pnpm install`。使用 `pnpm run desktop` 启动桌面版，或运行 `pnpm run build:desktop` 生成 Windows 安装包。
- 首次打开后，选择那台电脑自己的素材文件夹，或使用“创建基础目录”。每台电脑独立设置项目名、分类名和本机收藏备注，安装包不带入这台电脑的文件夹命名、路径或素材。

## 项目文档

- [安装说明](安装说明.md)：下载、安装、首次创建目录和源码构建。
- [使用说明](使用说明.md)：素材导入、整理、预览、拖拽和删除。
- [开发日志](开发日志.md)：按日期记录改动、验证与 GitHub 同步情况。
- [需求记录](需求记录.md)：用户需求、设计决定和后续事项。
- [AGENTS.md](AGENTS.md)：后续开发应遵守的产品与维护约定。
- [design-qa.md](design-qa.md)：早期界面设计检查记录。
