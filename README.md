# RateMySJTU

Chrome / Edge Manifest V3 浏览器插件，用于在上海交通大学教学信息服务网选课页旁标注选课社区评分。

## 功能

- 从 `https://course.sjtu.plus` 读取课程评分数据并缓存到浏览器本地 `chrome.storage.local`。
- 打开交大选课页时，自动匹配课程名和教师名，并在课程名单元格旁插入 `⭐ 4.8` 形式的评分标签。
- Popup 提供“刷新数据”按钮，可手动更新本地评分库。

## 使用

1. 在 Chrome 或 Edge 打开扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展”，加载本目录。
4. 先在 [选课社区](https://course.sjtu.plus) 登录。
5. 点击插件图标，在 Popup 中点击“刷新数据”。
6. 访问交大选课页面：`https://i.sjtu.edu.cn/xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default`。

## 说明

选课社区课程接口需要登录态。插件刷新数据时会使用当前浏览器对 `course.sjtu.plus` 的 Cookie；如果未登录，Popup 会提示先登录。
