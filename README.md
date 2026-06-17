# RateMySJTU

在交大选课页上标注[选课社区](https://course.sjtu.plus)评分，支持 Chrome / Edge Manifest V3。

## 功能

- **教师评分标注**：展开课程后，每位教师旁自动显示选课社区的评分。有评分显示 `⭐ 4.8`，无评分显示灰色 `无评分`。
- **一键跳转**：点击评分或「无评分」标签，新标签页打开对应课程在选课社区的详情页。
- **本地缓存**：评分数据缓存在浏览器本地，12 小时自动刷新。
- **Popup 控制面板**：手动刷新数据，查看评分索引数、API 读取量等统计信息。

## 安装

1. 打开 Chrome / Edge 扩展管理页（`chrome://extensions` 或 `edge://extensions`）。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展」，选择本项目根目录。
4. 在浏览器右上角固定 RateMySJTU 图标。

## 使用

1. **登录选课社区**：打开 [course.sjtu.plus](https://course.sjtu.plus) 并登录（需要 Jaccount 账号）。
2. **刷新评分数据**：点击浏览器工具栏中的 RateMySJTU 图标，在弹窗中点击「刷新数据」。
3. **打开选课页**：访问[交大选课页面](https://i.sjtu.edu.cn)，点击课程旁的「展开」，即可在每位教师旁看到评分。

## 技术说明

- 评分数据来自选课社区公开 API，携带浏览器 Cookie 请求，需先登录。
- 若后台请求因未登录失败（401/403），会自动通过已打开的选课社区页面代为抓取。
- 请求间设有 300ms 延迟和指数退避重试，避免触发限流（HTTP 429）。
- 通过课程编码（如 `PHY1262`）匹配子行与主行，不依赖页面 DOM 的具体结构。

## 项目结构

```
RateMySJTU/
├── manifest.json          # 扩展清单
├── src/
│   ├── background.js      # Service Worker：数据抓取、缓存、定时刷新
│   ├── content.js         # 选课页注入：DOM 标注、评分匹配
│   ├── content.css        # 评分标签样式
│   ├── course-bridge.js   # 选课社区页注入：辅助数据抓取
│   ├── popup.html         # 弹窗界面
│   ├── popup.js           # 弹窗逻辑
│   └── popup.css          # 弹窗样式
└── README.md
```

## License

MIT
