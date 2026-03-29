# Personal Portal / Blog + Tools 規格草案

## 1. 專案定位

這不是單純的 blog，也不是只有一個工具的 landing page。

目標是做一個 **Personal Portal**，作為個人入口站，整合：

- 個人簡介
- Side projects / tools
- Blog / notes
- 遊戲攻略
- 學習筆記
- 之後可持續擴充的內容

其中第一個主打功能是：

- **Packing List Generator**（旅行行李清單產生器）

---

## 2. 核心目標

這個網站要同時做到：

1. **像個人網站**
   - 有自己的主頁、簡介、風格
   - 不只是工具 demo

2. **像作品入口**
   - 可以集中展示 side projects
   - 之後新增功能不需要重開新 repo

3. **像知識整理站**
   - 可以放遊戲攻略、學習筆記、生活整理
   - 類型可以不同，但要維持整體一致性

4. **第一版就能完成**
   - 不追求大而全
   - 先做小而完整的 v1

---

## 3. 網站定位一句話

可用這種方向描述：

> A personal portal for tools, notes, guides, and side projects.

或中文理解：

> 一個收納個人工具、筆記、攻略與作品的個人入口站。

---

## 4. 建議網站名稱

先用中性一點的名字，不要綁死在某個單一主題。

可考慮：

- Ian's Portal
- Ian's Notes & Tools
- Ian's Hub
- Ian's Space
- Ian's Playground
- Ian's Lab

如果先不決定，開發時先用暫名：

- **Ian Portal**

---

## 5. 資訊架構（Sitemap）

建議第一版做這幾個主要頁面：

- `/` Home
- `/about` About
- `/projects` Projects
- `/tools/packing-list` Packing List Generator
- `/blog` Blog index
- `/blog/[slug]` Blog post detail

之後可擴充：

- `/guides` Guides
- `/notes` Notes
- `/tools` Tools index
- `/tags/[tag]` Tag pages

---

## 6. 導覽列規劃

建議主選單：

- Home
- Projects
- Blog
- About

可選：

- Tools（如果未來工具變多再獨立）
- Guides（如果攻略內容很多再獨立）

第一版不建議導覽列塞太多，避免太散。

---

## 7. Home 頁面結構

Home 不要做得太滿，重點是乾淨、清楚、有入口。

### 7.1 Hero Section
內容建議包含：

- 名字 / 標題
- 一句簡短介紹
- CTA 按鈕 1：View Projects
- CTA 按鈕 2：Read Notes

可參考文案：

- Hi, I'm Ian.
- I build small tools, write notes, and collect useful stuff I want to keep.

---

### 7.2 Featured Section
放 2 到 4 個重點卡片，例如：

- Packing List Generator
- 最近一篇學習筆記
- 一篇遊戲攻略
- 一個未來可擴充的 side project

目的：
- 讓首頁不是只有自我介紹
- 讓訪客一進站就有可以點的東西

---

### 7.3 Recent Posts
顯示最近 2 到 4 篇文章：

- 學習筆記
- 遊戲攻略
- 生活整理類文章

---

### 7.4 Project / Tool Highlight
主推第一個工具：

- Packing List Generator
- 簡短描述
- 前往工具頁按鈕

---

### 7.5 Footer
包含：

- GitHub
- Email 或 Contact
- Copyright
- 簡短一句站點描述

---

## 8. About 頁面

目的不是寫很長的自傳，而是簡潔說明：

- 你是誰
- 你對哪些東西有興趣
- 這個網站會放什麼
- 為什麼做這個站

可包含：

- 短版自介
- 興趣 / 關注主題
- 本站內容分類
- 技術棧（可簡單列）

---

## 9. Projects 頁面

這頁是作品入口，不一定很多，但要清楚。

第一版可先放：

### 9.1 Packing List Generator
簡介：
- 根據旅程條件生成基礎行李清單
- 支援個人固定必帶物
- 支援手動調整與本機儲存

之後可放：
- 新的工具
- 小型 side project
- 可互動 demo

每個 project card 建議包含：

- 名稱
- 一句描述
- 標籤（Tool / Blog / Guide / Experiment）
- 連結

---

## 10. Blog 頁面

Blog 用來放比較偏內容型的頁面。

### 10.1 內容類型建議
可以接受不同主題，但要整理得有結構。

例如：

- 遊戲攻略
- 學習筆記
- 工具使用心得
- 生活整理
- 旅遊相關記錄

### 10.2 顯示方式
每篇文章卡片可顯示：

- Title
- Date
- Category
- Tags
- Short excerpt

---

## 11. Blog 文章 detail 結構

每篇文章頁建議包含：

- Title
- Date
- Tags
- Estimated reading time（可選）
- TOC（如果文章長）
- 文章內容
- 上一篇 / 下一篇（可選）

---

## 12. Packing List Generator 在整站中的角色

這個工具不是獨立存在，而是作為 portal 的第一個主打工具。

它的定位是：

> 一個根據旅程條件產生基礎清單，並支援個人習慣客製化的旅行打包工具。

### 12.1 工具頁核心功能
- 輸入旅程條件
- 生成基礎清單
- 套用個人固定項目
- 手動新增 / 刪除項目
- 勾選完成狀態
- 本機儲存
- 匯出清單

### 12.2 資料儲存方式
建議第一版：

- `localStorage`
- 可選：匯出 / 匯入 JSON

---

## 13. 第一版 MVP 範圍

請特別控制範圍，不要一開始做太大。

### 必做頁面
- Home
- About
- Projects
- Blog index
- 1 篇 blog post detail 範例
- Packing List Generator

### 必做內容
- 至少 1 個工具：Packing List Generator
- 至少 2 篇文章
  - 1 篇遊戲攻略
  - 1 篇學習筆記

### 必做設計
- RWD
- 清楚導覽
- 卡片式內容列表
- 簡潔一致視覺

---

## 14. 第二版可加功能

等 v1 穩了再做：

- Dark mode
- Tag filter
- Search
- Tools index page
- JSON import/export for packing list
- Saved trip profiles
- 收藏文章 / pinned posts
- RSS
- Sitemap / SEO enhancement

---

## 15. 不建議一開始做的事

- 後端資料庫
- 登入系統
- 留言功能
- 太多分類
- 太複雜的 CMS
- 一次做很多工具
- 首頁做成超花的動畫展示站

重點是先做一個穩定、可擴充的入口站。

---

## 16. 視覺風格建議

方向建議：

- 簡潔
- 偏乾淨實用
- 不要太花
- 讓內容與工具都清楚可讀

可採用：

- 卡片式區塊
- 足夠留白
- 明確字級層次
- 柔和但不花俏的配色
- 手機版優先思考

---

## 17. 技術建議

如果要給 Codex，建議這樣指定：

### 方案 A：Astro
適合：
- blog
- 靜態內容
- 少量互動工具頁

優點：
- 很適合 personal portal / blog / content site
- 工具頁也能用 client-side components 補互動
- 部署到 GitHub Pages 合理

### 方案 B：Next.js static export
適合：
- 如果你比較熟 React 生態
- 之後可能會加更多互動功能

但如果以 portal + blog + 小工具來看，**Astro 很適合**。

---

## 18. 建議內容模型

### Project
- title
- slug
- description
- type
- tags
- featured
- url

### Blog Post
- title
- slug
- date
- category
- tags
- excerpt
- content

### Packing List Profile（前端儲存）
- tripType
- destinationType
- durationDays
- weather
- laundryAvailable
- personalModules
- generatedItems

---

## 19. 首頁文案方向草稿

### Hero
Title:
- Ian's Portal

Subtitle:
- Small tools, notes, guides, and projects I want to keep in one place.

Buttons:
- View Projects
- Read Blog

### Featured card examples
- Packing List Generator
- Latest Study Notes
- Featured Game Guide

---

## 20. 給 Codex 的實作要求

可直接這樣描述：

### 目標
建立一個可部署到 GitHub Pages 的 personal portal / blog / tools site。

### 第一版需求
1. Home / About / Projects / Blog / Blog detail 頁面
2. Packing List Generator 作為第一個工具頁
3. Blog 支援文章列表與文章細節頁
4. 所有內容先用本地 markdown / content collections 管理
5. 工具資料先存在 localStorage
6. 整站需支援 RWD
7. 視覺風格簡潔、現代、可擴充

### 非需求
- 不需要後端
- 不需要登入
- 不需要資料庫
- 不需要 CMS

---

## 21. 我建議的實作順序

1. 先搭 portal 基本框架
2. 完成 Home / About / Projects / Blog layout
3. 做 blog content loading
4. 做 Packing List Generator MVP
5. 補假資料與示範文章
6. 微調整體視覺與 RWD
7. 最後再補 SEO / metadata / favicon

---

## 22. 成功標準

這個網站第一版完成後，應該要能做到：

- 看起來像完整個人站，不是單頁 demo
- 有一個真的可以用的工具
- 有幾篇可閱讀的內容
- 結構清楚，未來可持續擴充
- 可直接部署在 GitHub Pages

---

## 23. 一句話總結

這個專案的方向不是做一個單點工具，而是做一個：

**以 personal portal 為主體，整合 blog、notes、guides 與 side tools 的可擴充個人網站。**
