# 制作和发布组会 Slides

每个项目有一个固定入口，如 `/GroupMeeting/Ocula/`。总览显示公开项目名，报告、图片与逐页预览保存在同一份密文中。

## 制作一份报告

在网站仓库外保存本场材料。可以把几页写在同一 HTML 文件，也可以用 `slides/01-method.html`、`slides/02-result.html` 这样的文件名编排。每页是一个 `<section class="slide">`。正文题名写在 `h1` 或 `h2` 中，侧栏默认沿用该题名，需要短名称时加 `data-slide-title`。看[可编辑的 HuPER 示例](meeting/huper-example.html)可以直接找到方法图、双图和表格的写法。

从网站仓库运行下面的命令。输入目录中的 `.html` 按文件名排序。输出放在源页目录外，后续增加或修改某一页可以重复使用同一命令。

```sh
python3 "tools/meeting/build_deck.py" --title "Ocula · Research meeting" \
  --slides "/private/work/Ocula/slides" --output "/private/work/Ocula/report.html"
```

图片、GIF、视频、poster、字幕与音频可在源 HTML 中使用普通相对路径。脚本按各片段的目录查找这些文件，打包时内嵌，并生成逐页缩略图。显式排序可重复传 `--slides`。本场的额外样式可用 `--css`，其中用到的字体、背景图等资源应自行内嵌。需要重做证据页时修改源 HTML并重新组装。成品保留同一套翻页、预览与 Notes。

例如，先用仓库里的公开样稿熟悉操作。输出位置可换成本场私有目录。

```sh
python3 "tools/meeting/build_deck.py" --title "HuPER · Paper discussion" \
  --slides "tools/meeting/huper-example.html" --output "../meeting-work/HuPER-example.html"
```

带缩略图的构建使用 Node.js 和 Playwright，优先用本机 Chrome。若沙箱拦截启动，可允许此次本机渲染后重跑原命令。快速文字预览可加 `--no-previews`。先在电脑和手机上试讲，核对实际数字、图轴、标题和逐页笔记。演示中播放的短片保留原始时间、条件和播放控件。

比如汇报同一实验的连续轨迹，可以把证据框中的图片换成下面这段。海报会出现在静止画面和缩略图中。离开该页后，正在播放的短片会暂停。

```html
<video controls playsinline preload="metadata" poster="../media/trajectory-frame.png"
       aria-label="Tracked trajectory over the evaluation window">
  <source src="../media/trajectory.mp4" type="video/mp4">
</video>
```

## 选择发布方式

在网站仓库运行以下命令，需 Node.js 18 或以上版本。用实际项目名与私有文件路径替换示例。

**首次发布**会创建项目入口和共享口令。把终端显示的完整链接保存为仓库外的 `private-link.txt`。

```sh
node tools/seal-slides.mjs --project Ocula "/private/work/report.html"
```

**修订或续讲同一份报告**时，沿用原链接、口令和逐页备注。打包器先用保存的链接核验旧报告，然后原子替换密文。备注按页号对应，润色时请保留原页序。续讲时把新证据页排到末尾。

```sh
node tools/seal-slides.mjs --project Ocula --revise-with "/private/work/private-link.txt" "/private/work/report.html"
```

**发布下一场组会**时，用 `--replace` 在同一项目地址生成新口令和独立的笔记空间。保存这次命令输出的新链接。

```sh
node tools/seal-slides.mjs --project Ocula --replace "/private/work/next-report.html"
```

确认发布后，提交该项目在 `content/GroupMeeting/` 下的清单与密文变更。项目名区分大小写，可用字母、数字和内嵌连字符，以字母开头。同一项目同时只运行一次打包命令。进程中断后如果出现锁提示，确认打包器已退出，再移除提示中的空锁目录。

需使用独立的随机地址时，省略 `--project`。此时发布生成的 `content/slides/<id>/`，报告可通过私链打开。

## 演示与分享

- 点击缩略图、页码或方向键跳页。桌面会记住当前报告的预览栏开合，手机选页后回到正文。
- 点击底部笔记栏直接记录。笔记按报告和页码保存在当前设备；换设备或开始新场次前可复制需要的文字。
- 点击底栏右侧的链接图标即可复制私链，复制成功时图标会变为对勾。接收者从封面开始；要从第 2 页开始，可把链接的 `#p=` 改为 `#2&p=`。剪贴板不可用时，页面提供手动复制。
- 浏览器成功解锁后会记住该报告的口令，并从地址栏收起口令片段。持有完整链接的人可以阅读和转发；共享设备可用隐私窗口打开。

密文使用 AES-256-GCM，每次写入生成新的 IV。密钥由口令经 PBKDF2-SHA256 的 600,000 轮迭代派生，附加认证数据绑定报告 ID。
