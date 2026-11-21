# 添加或修订 Web 论文

给 Agent 选定版本的论文目录、PDF 或公开原文链接即可。有原始插图、BibTeX 或 LaTeX 源码时优先使用。Agent 从稿本核对完整引文、抽取图表，选最能说明方法的 pipeline 图，并按论文简称拟定短地址。你可以指定其他图、地址、附录范围或外链。正文、作者顺序、单位、实验限定和引用编号以选定版本为准。

## 新论文

在网站仓库运行以下命令，将 `example-paper` 换成稳定的英文短地址。下文按已安装在 PATH 的 `hugo` 书写。Bixing 本机使用仓库旁的固定可执行文件，新建命令是 `../.tools/hugo new content --kind paper "paper/example-paper/index.md"`，预览用 `../.tools/hugo server --buildDrafts`，正式构建用 `../.tools/hugo --minify`。

```sh
hugo new content --kind paper "paper/example-paper/index.md"
```

生成的 `content/paper/example-paper/` 是这篇论文的完整目录。编辑其中的 `index.md`，放入 `pipeline.png` 和 `citation.bib`。首页、`/paper/` 和 `/paper/example-paper/` 会使用同一份资料。新论文按日期从新到旧排列在现有两篇之前。

| 填写位置 | 内容 |
| --- | --- |
| `title`、`description`、`date` | 完整题名、论文目录用的一句简介、此版本的真实日期 |
| `params.publication` | 必填 `short_name`、`venue`、按原文顺序的 `authors`、描述图中输入输出的 `figure_alt`。预印本的 `venue` 写实际来源 |
| 图和 BibTeX | `figure` 和 `bibtex` 可指定同目录的其他文件名。首页 pipeline 预览支持 PNG、JPEG 和 WebP。论文中的 SVG 可保留矢量原图 |
| 资源按钮 | `pdf` 支持完整 URL 或目录内文件名。原文入口填 `url` 和 `source_label`（如 arXiv、OpenReview 或 Publisher），有公开代码时填 `code` |
| 作者与版本 | 按需填写 `params.affiliations`、与作者一一对应的 `byline_marks`、`author_note`、`version`、`license_name` 和 `license_url`。首页的共同一作姓名可带 `*` |

### 正文与图表

按论文顺序写正文。每个二级标题自动进入目录。给重要小节一个稳定的锚点，如 `## Method {#method}`。使用 `appendix-` 开头的锚点可将附录收在同一个目录项下。

图和数据文件放在该论文目录。以下原生 Hugo 短代码支持点击放大、可访问描述及图注。把 `params.overview_id` 设为 `fig-method`，读者即可从 pipeline 跳到原文对应位置。

```md
{{< paper-figure src="figures/method.svg" id="fig-method" alt="…" caption="Figure 2. …" >}}
```

已有带公式、参考文献和表格的 HTML 时，把审核后的正文片段放进 `assets/papers/example-paper/body.html`。将 `index.md` 中的样例正文替换成一行 `{{< paper-fulltext >}}`。去掉导出网页的外壳、远程脚本和追踪代码。保留 MathML、真实表头、引用链接与原始图注。插图仍放在 `content/paper/example-paper/`。宽表可套用正文已有的 `.paper-scroll`，可放大的原图使用 `<a href="figures/result.svg" data-figure-zoom>…</a>`。

从原文生成目录，在标题或章节锚点变化后重新运行同一条命令。

```sh
python3 "tools/paper-contents.py" "assets/papers/example-paper/body.html"
```

脚本依次读取 `h2`，优先使用标题自身的 ID，其次使用所在 `section` 或 LaTeXML 摘要块的 ID，写入正文旁的 `contents.json`。遇到缺失或重复的锚点，先修正 HTML 再生成。同一源稿重跑会得到相同目录。

只改一项显示名称时，在 `params` 下写 `contents_titles: [{id: S3, title: Method}]`。它在重新生成目录后仍生效。要选取部分章节或调整顺序，可直接给出完整的 `params.contents`，如 `[{id: abstract1, title: Abstract}, {id: S3, title: Method}]`，阅读器优先使用这份目录。条目中的 `appendix: true` 会将对应章节放到附录分组。

### 预览与公开

完成资料后运行 `hugo server --buildDrafts`。检查首页作者和会议标记、论文目录、正文小节跳转、图的原尺寸、外链及 BibTeX 下载。在手机宽度查看最长的表格和公式。对照原稿检查图表、定量结论和最后一节，避免将节选当成全文。

公开前将该稿的 `draft` 设为 `false`，运行 `hugo --minify` 检查正式构建。项目现有发布方式是推送到 GitHub Pages 的 `main`。在获得本次发布授权后再提交和推送。仓库本身公开，私有稿、未发表实验和共享口令保存在仓库外。

## 修订已有论文

保留目录名和被链接的小节、图表 ID。新格式的稿件直接修改对应目录的正文、图片或引用文件。作者与外链只改该稿的 front matter。新版本需要重新核对图号、引文和版本标注。

AHA 和 HuPER 沿用已有结构。首页元数据在 `content/_index.md` 的 `publications`，阅读页参数和原图在 `content/paper/<slug>/`，导入的正文和目录在 `assets/papers/<slug>/`。其中 PDF 与 arXiv 链接沿用各自的版本号。
