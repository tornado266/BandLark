# BandLark

BandLark（原 EssayPilot）是一款面向雅思 Task 2 写作的训练工具。这份源码展示新版工作台怎样将反馈对应到学生写下的原句，再让学生检查修订的具体变化。它取自 2026 年 11 月在用的本地前端工作副本，另配一页可独立运行的演示。

## 在本机试用

在仓库根目录执行：

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Windows 亦可用 `py -m http.server 8000 --bind 127.0.0.1`。打开 [本地工作台](http://127.0.0.1:8000/)，修改作文、报告引用的原句和修订后的句子，再点击“更新报告”。浏览器运行期间无需联网，输入不提交给服务器。把同一句复制两遍再试，可以看到引文因位置不明确而无法标出的情形。

## 源码导航

| 文件（web/workspace） | 在 BandLark 中的作用 |
| --- | --- |
| text-anchor.mjs | 对引文进行 Unicode 规范化，保留通往原文 UTF-16 区间的映射。可用 SHA-256 校验显式锚点。 |
| report-original.mjs | 原文批注的定位、排序与重叠处理。此版抽取原工作台用于纸面报告的相关函数，并沿用原 HTML 转义函数。 |
| word-diff.mjs | 对英文收缩词、标点、空白分词，限时计算逐词改动并渲染修订。 |
| revision-comparison.mjs、assistant-reply-format.mjs | 渲染两稿对照说明，单独折叠反馈文字中的估分描述。 |
| grading-client.mjs | 产品中的异步评分请求客户端，处理任务状态与重试。需搭配评分 API；演示页仅使用本地报告呈现模块。 |

原应用中由服务端产生评分与反馈。本演示用人工给定的引用和修改展示报告行为，固定示例独立编写。完整的在线评分、账户、词库与教学助手均属于另行运行的产品部分。独立演示入口、样式与测试于 2026-11-23 添加。

## 运行测试

安装 Node.js 20 或以上版本后，执行：

```sh
node --test tests/report.test.mjs
```

## 许可

Copyright © 2026 EssayPilot contributors. BandLark 此处发布的前端程序采用 [GNU GPL v3 only](LICENSE)。`web/workspace/vendor/jsdiff` 随附 [BSD-3-Clause 许可证](web/workspace/vendor/jsdiff/LICENSE)、[版本和改编说明](web/workspace/vendor/jsdiff/README.md) 及对应上游源码。
