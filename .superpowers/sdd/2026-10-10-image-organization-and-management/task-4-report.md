# Task 4 报告：手动一键更新命令

## 红灯

- 先新增 `scripts/update-site.test.ts`，运行 `npm test -- scripts/update-site.test.ts`：7/7 失败，均因 `update-site.command` 尚不存在，符合预期。

## 实现与行为

- 新增可执行的根目录 `update-site.command`。从任意当前目录启动时会定位脚本所在仓库根目录；无参数时提示更新说明，空输入精确使用 `feat:update`；有参数时以全部参数组成一条提交说明。
- 依序确认 Git 仓库和 `origin`、拉取 `main`、检查 `origin/main` 是当前 HEAD 的祖先、运行 `npm test` 和 `npm run build`、暂存所有变化、仅在有暂存变化时提交、推送 `HEAD:main`，最后显示 GitHub Pages URL。
- 任何 Git、测试或构建失败都会中止。远端非祖先时提示先同步；没有文件变化时仍推送已存在的本地 ahead commit。提交说明使用引号传入 `git commit -m`，支持中文和空格。
- README 增加 macOS 双击和终端用法。

## 测试与检查

- 聚焦黑盒测试：7/7 通过；在隔离临时 Git 仓库和本地 bare remote 中直接执行脚本，使用 PATH 中的 fake npm 验证外部测试/构建命令顺序及失败路径。临时目录由 `afterEach` 清理。
- 完整 `npm test`：15 个测试文件、113 项通过。
- `npm run typecheck`、`npm run build`、`bash -n update-site.command`、`git diff --check`：通过。

## 顾虑

- Pages 地址根据标准 GitHub remote URL 推导；非 GitHub remote 只能提示到仓库 Pages 设置查看。GitHub Actions 的部署结果仍需在推送后等待，脚本打印地址不代表远端部署已完成。
