AI短剧作品集 — GitHub Pages 部署包

一、目标仓库
GitHub 用户名：zhangqiwu-ctrl
仓库名称：11
仓库可见性：Public
GitHub Pages 预期网址：https://zhangqiwu-ctrl.github.io/11/

二、目录说明
- index.html：原始作品集页面。保留原有页面结构、内联 CSS、JavaScript、字体与交互。
- assets/films/：从原始 HTML 中提取的 13 个 MP4 视频及 13 张 JPG 封面图。
- DEPLOYMENT-MANIFEST.json：媒体文件路径、大小与校验摘要。
- .nojekyll：让 GitHub Pages 按静态文件方式发布。

三、部署方式
将本 ZIP 解压，然后把解压目录内的所有文件和文件夹上传到 GitHub 仓库 11 的根目录。
不要把 ZIP 压缩包本身作为网站内容上传。
然后进入仓库 Settings → Pages：
- Build and deployment：Deploy from a branch
- Branch：main
- Folder：/(root)
保存后等待 GitHub Pages 发布。

四、媒体与兼容性
- 视频：13 个 MP4，均为 H.264 编码；未转码、未压缩、未降低画质。
- 图片：13 张 JPG；未重新压缩。
- 最大单个媒体文件约 18.9 MB。
- 所有媒体均使用相对路径，适用于项目站点 /11/ 路径。

五、发布前提醒
原始模板中的姓名、邮箱、电话仍保留占位文字（例如 YOUR NAME、你的邮箱、你的电话）。本包未擅自替换这些信息。Public 仓库和 GitHub Pages 网站均可被公众访问；如需更换个人信息，请在正式公开前完成。

六、维护
以后替换视频或封面时，尽量保持现有文件路径和文件名不变；若要新增作品，需要同时更新页面中的作品数据和相应资源映射。
