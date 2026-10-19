# UI Shelf · 游戏 UI 参考库

一个简单、私有、方便搜索的游戏 UI 图片书架。可以按游戏、模块和交互流程浏览截图，用标签、图片标题、游戏名称、平台和版本快速查找参考。

- 纯前端：React + TypeScript + Vite，使用 Hash 路由，适合 GitHub Pages 的项目子路径。
- 未配置 Supabase：自动进入只读 Demo，可直接体验浏览和搜索。
- 配置 Supabase：启用单用户登录、私有数据库、私有图片存储和文件夹批量上传。

## 本地启动

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run dev
```

如果不创建环境变量文件，网站会以只读 Demo 模式运行。Demo 中的图片位于 `public/demo`，会随静态网站一起公开发布，不要把私有截图放进这个目录。

常用命令：

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

## 启用私有云端资料库

### 1. 创建 Supabase 项目和唯一账号

1. 新建一个 Supabase 项目。
2. 在 **Authentication → Providers → Email** 中保留邮箱/密码登录，关闭 **Allow new users to sign up**（公开注册）。
3. 在 **Authentication → Users** 中手动创建你的唯一账号，设置邮箱和密码，并确保该用户已确认。

前端本身没有注册入口。`VITE_OWNER_EMAIL` 会在界面层限制允许登录的邮箱；关闭 Supabase 公开注册并只创建一个用户，才是单用户模式的完整设置。

### 2. 执行数据库 migration

最直接的方式是打开 Supabase 的 **SQL Editor**，按文件名顺序执行 `supabase/migrations` 中的全部 SQL：

1. [`202610090001_initial_schema.sql`](supabase/migrations/202610090001_initial_schema.sql)
2. [`202610090002_atomic_image_metadata.sql`](supabase/migrations/202610090002_atomic_image_metadata.sql)
3. [`202610100003_image_management.sql`](supabase/migrations/202610100003_image_management.sql)
4. [`202610140004_cleanup_ack.sql`](supabase/migrations/202610140004_cleanup_ack.sql)
5. [`202610150005_game_cover_from_image.sql`](supabase/migrations/202610150005_game_cover_from_image.sql)
6. [`202610150006_idempotent_image_uploads.sql`](supabase/migrations/202610150006_idempotent_image_uploads.sql)
7. [`202610160007_image_placement_and_cover_focus.sql`](supabase/migrations/202610160007_image_placement_and_cover_focus.sql)

第 3 份 migration 增加图片移动、批量删除、游戏删除和持久化文件清理队列；第 4 份用于安全收敛“Storage 已删除、但浏览器没来得及确认队列”的中断情况；第 5 份支持把已有截图安全设为游戏封面；第 6 份使重复上传可安全重试；第 7 份支持模块内重排、跨模块精确插入和封面焦点。建议在专用的新项目中执行；已有项目只需继续执行尚未执行的后续文件，不要重复执行已上线的 migration。

如果已使用 Supabase CLI，也可以在仓库根目录运行：

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

该 migration 会创建元数据表、RLS 策略、搜索索引，以及两个私有 Storage bucket：

- `game-ui-originals`：原图，单文件上限 25 MiB。
- `game-ui-thumbnails`：缩略图，单文件上限 2 MiB。

表和存储对象都按 `auth.uid()` 隔离，匿名用户没有数据表权限。

### 3. 配置本地环境变量

```bash
cp .env.example .env.local
```

然后填入：

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_OWNER_EMAIL=you@example.com
```

URL 和 key 必须同时存在；只配置其中一项时，页面会显示配置错误。修改后重新启动开发服务器。

## GitHub Pages 部署

仓库包含 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)。每次推送到 `main` 都会用 `npm ci` 和 `npm run build` 构建，再通过 GitHub 官方 Pages Actions 发布 `dist` 目录；也可在 Actions 页面手动运行。

1. 将项目推送到 GitHub，确保默认分支为 `main`。
2. 在 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions**。
3. 如果只需 Demo，无需增加任何变量。
4. 如果需要云端模式，在 **Settings → Secrets and variables → Actions → Variables** 中新建：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_OWNER_EMAIL`
5. 推送 `main`，在 **Actions** 中等待 `Deploy to GitHub Pages` 完成。

以后手动更新网站时，可以在 macOS 中双击仓库根目录的 [`update-site.command`](update-site.command)，输入本次更新说明后按回车；直接回车会使用提交信息 `feat:update`。也可以在终端中运行：

```bash
./update-site.command 修复 公会商店图片
```

命令行参数会合并为一条提交说明，无需再次输入。脚本会先检查远端 `main` 是否仍在当前提交历史中，再运行完整测试和生产构建；成功后暂存并提交变化，推送到 `origin/main`，最后显示 GitHub Pages 地址。若没有文件变化，会跳过新提交，但仍会推送已经验证的本地提交。远端有新提交、测试失败或构建失败时会停止；先处理错误再重试。首次使用前请完成 `npm ci`，并确认已配置 GitHub 推送权限。

项目使用相对 Vite `base` 和 Hash 路由，因此在 `https://<user>.github.io/<repo>/` 这类子路径下也能正常打开。`public/404.html` 只负责把意外的非 Hash 地址送回站点入口。

> `VITE_*` 值会在构建时写入前端文件。Supabase `anon` key 或新版 `publishable` key 本来就允许公开，安全性依赖 Auth 和 RLS。绝对不要把 `service_role` key、数据库密码或登录密码放进 GitHub Variables、源码或 Pages 构建产物。

## 文件夹与文件名规则

上传时选择整个游戏文件夹。第一层文件夹名会成为游戏名称。推荐文件名格式是 `模块_图片内容名称[_序号].扩展名`；只有最后一个纯数字下划线段会被视为顺序。

```text
IDOL/
├── 首页_主界面.png
├── 任务_日常任务.png
├── 奖励_奖励详情_1.png
├── 奖励_奖励领取_2.png
└── 公会_兑换商店界面_3.jpg
```

- 例如 `公会_兑换商店界面_2.jpg` 会自动归入“公会”模块，图片标题为“兑换商店界面”，顺序为 `2`。
- 系统会根据模块和标题自动生成去重关键词标签（例如“公会”“兑换”“商店”），并过滤“界面”“页面”等泛词；上传前仍可自由增删修改。
- 同一大模块中的所有图片使用一个统一网格，按展示顺序从左到右排满后再换行；流程名保留为可搜索的图片资料，不再拆成单独小模块。
- 旧格式 `reward奖励-奖励详情.png`、`02-reward奖励-奖励领取.jpeg` 以及带下划线的旧模块 key（如 `guild_shop公会商店-兑换详情.png`）继续兼容，其中真实多图流程会保留。
- 没有显式序号时按选择顺序预排。上传预览中可修改模块、流程、标题、标签和顺序，再确认提交。
- 支持 PNG、JPG/JPEG、WebP、GIF 和 AVIF。单张原图不能超过 25 MiB。
- 缩略图在浏览器中生成为 WebP，最长边 560px；原图不会被替换或压缩。
- 非图片、超限或重复文件会在上传前标出。批量过大时建议分批处理，实际总容量还受 Supabase 套餐与浏览器内存限制。

## 删除与延迟清理

单图、批量图片和整本游戏的删除都是永久删除。数据库会先在同一事务中删除元数据，并把原图、缩略图和封面路径写入持久化清理队列；浏览器随后删除私有 Storage 对象。如果网络中断、权限校验失败或关闭页面，未确认项会留在队列中，下次加载或删除操作时自动重试。只有服务端确认该账号对应的 Storage 对象已不存在时，才会移除队列项；网络或权限错误不会被当作“已删除”。

## 设置游戏封面

在游戏详情页的封面上点击“设置游戏封面”或“更换或调整游戏封面”，可从当前游戏截图中选择封面，并拖动设置视觉焦点。编辑器会同时预览书架横版和详情竖版的自动裁切结果；更换截图与保存焦点会在同一数据库事务中完成，不会出现新封面配旧焦点的中间状态。系统会复制截图缩略图作为独立封面文件，因此以后删除或移动原截图不会让封面失效。旧封面会通过同一套持久化清理队列安全回收。

## 调整图片顺序

在游戏详情页拖动图片卡片右上角的“移动”手柄，放到目标图片左半边会插入其前，放到右半边会插入其后；放到模块空白处或顶部模块目录则追加到末尾。点击“移动”手柄可通过对话框精确选择目标模块和位置，适用于触屏和键盘操作。保存后源模块与目标模块都会自动重新编号为连续顺序。标题、流程和标签等元数据可单独编辑，但元数据保存不会改动已经排好的图片顺序。

## 备份与恢复策略

1. 定期在站点的“设置与备份”中导出 JSON。它是带版本号的元数据快照，不包含短时 signed URL、账号凭证或图片二进制文件。
2. 妥善保留原始的本地游戏文件夹，它是最可靠的原图离线备份。如需云端完整备份，还要单独备份两个 Storage bucket 的对象。
3. Supabase 的数据库备份不等于 Storage 文件备份；不要只依赖数据库恢复。恢复前保留同一时点的 JSON、数据库和原图副本。

当前 JSON 功能是备份/审计导出，不是一键恢复工具；需要恢复时，先在新项目执行 migration，再根据导出数据和原图重建。

## 隐私边界

GitHub Pages 上的 HTML/CSS/JavaScript “站点外壳”是公开的，仓库公开时源码和 Demo 素材也是公开的。真实元数据和上传图片保存在 Supabase，需要有效登录会话，并受 RLS 和私有 bucket 策略限制。

不要仅靠页面隐藏或 `VITE_OWNER_EMAIL` 保密；它们不是服务端权限边界。账号密码、RLS 策略和关闭公开注册才共同构成私有访问控制。
