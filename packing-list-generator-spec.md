# Packing List Generator 規格草案

## 1. 專案定位

這是一個適合部署在 GitHub Pages / github.io 的前端工具。

核心不是做一個「固定的旅遊清單網站」，而是做一個：

**根據旅程條件產生基礎行李清單，並支援個人習慣客製化的打包工具。**

這個工具的價值不在於替所有人決定該帶什麼，
而在於：

- 幫使用者快速產生一份合理初稿
- 降低每次旅行重新整理清單的成本
- 允許疊加個人固定需求
- 支援手動調整與保存

---

## 2. 核心問題

使用者在整理行李時常遇到：

1. 每次都要從零開始想一次
2. 低頻但重要的物品容易漏掉
3. 每個人有自己的固定習慣，很難套用死板模板
4. 一般 checklist app 太泛，不是為旅行情境設計

---

## 3. 產品定位一句話

> A packing list starter that generates a practical base list from trip conditions, then lets users personalize it with their own essentials.

中文可理解為：

> 一個先生成旅行行李初稿，再讓使用者加入個人固定需求的行李清單工具。

---

## 4. 設計原則

### 4.1 不做固定死清單
不是直接吐一份標準答案。

### 4.2 先生成，再客製
先給使用者一份合理 base list，再讓他調整。

### 4.3 個人需求是功能，不是例外
使用者的個人習慣不是問題，而是產品亮點。

### 4.4 前端優先
以 github.io 為前提，不依賴後端。

### 4.5 輕量但完整
第一版功能不求太多，但流程要完整。

---

## 5. 主要使用情境

### 情境 A：快速準備短途旅行
使用者準備週末兩天一夜，想快速得到一份基礎清單。

### 情境 B：依不同條件生成不同清單
例如：
- 國內 vs 國外
- 夏天 vs 冬天
- 商務 vs 休閒
- 有洗衣 vs 沒洗衣

### 情境 C：套用個人固定必帶物
例如：
- 過敏藥
- 隱形眼鏡藥水
- 行動電源
- 特定充電線
- 耳塞
- 頸枕

### 情境 D：生成後再微調
使用者可以刪除、增加、勾選、修改。

---

## 6. MVP 功能範圍

第一版建議只做這些核心功能。

### 6.1 Trip Setup 表單
讓使用者輸入旅程條件，例如：

- 旅程名稱（可選）
- 天數
- 國內 / 國外
- 目的類型（休閒 / 商務 / 戶外 / 海邊）
- 天氣（炎熱 / 溫和 / 寒冷 / 多雨）
- 是否可洗衣
- 是否需要筆電
- 是否攜帶相機
- 是否需要正式服裝
- 是否需要藥品類提醒

---

### 6.2 Base List Generation
根據條件產生基礎行李清單。

建議分類：

- 文件 / 證件
- 衣物
- 盥洗用品
- 3C / 電子產品
- 健康 / 藥品
- 其他雜項

生成時的邏輯應偏向規則式，不需要 AI。

---

### 6.3 Personal Essentials 模組
讓使用者自定義固定必帶物清單，例如：

- 我的 3C
- 我的藥品
- 我的盥洗用品
- 我的固定隨身物

生成清單時可以選擇是否套用。

---

### 6.4 Editable Checklist
生成後的清單可：

- 勾選已打包
- 新增項目
- 刪除項目
- 編輯項目名稱
- 切換分類（可選）
- 調整數量（可選，MVP 可不做）

---

### 6.5 Local Save
使用者資料預設存在本機：

- localStorage

至少要能保存：
- 最近一次旅程條件
- 生成後的清單
- Personal Essentials

---

### 6.6 Export
支援匯出：

- 純文字清單
- Markdown 清單

第二版可再加：
- JSON export/import
- Printable view
- PDF（非必要）

---

## 7. 非 MVP，先不要做

第一版先不要碰：

- 帳號系統
- 雲端同步
- 多人共享
- 地區天氣 API 串接
- 自動推薦品牌 / 商品
- 太細的穿搭建議
- 太複雜的行程規劃功能
- 購物功能
- AI 聊天式互動

---

## 8. 資料儲存策略

### 建議方案
- `localStorage` 作為 MVP 的主要儲存方式

### 為什麼
- 適合 github.io
- 不需要後端
- 實作成本低
- 對作品集來說已足夠

### 建議後續加值
- JSON export/import
- 多個 trip profiles
- local draft versions

---

## 9. 資料模型草案

## 9.1 Trip Conditions
```ts
type TripConditions = {
  tripName?: string;
  durationDays: number;
  destinationType: "domestic" | "international";
  purpose: "leisure" | "business" | "outdoor" | "beach";
  weather: "hot" | "mild" | "cold" | "rainy";
  laundryAvailable: boolean;
  needLaptop: boolean;
  needCamera: boolean;
  needFormalWear: boolean;
  needMedicineReminders: boolean;
};
```

## 9.2 Packing Item
```ts
type PackingItem = {
  id: string;
  category: "documents" | "clothing" | "toiletries" | "electronics" | "health" | "others";
  name: string;
  checked: boolean;
  source: "generated" | "personal" | "manual";
};
```

## 9.3 Personal Essential Group
```ts
type PersonalEssentialGroup = {
  id: string;
  name: string;
  items: string[];
};
```

---

## 10. 規則生成邏輯方向

這個工具不要做得太聰明，先做清楚。

例如：

### 基本固定項目
幾乎所有旅程都帶：
- 手機
- 充電器
- 錢包
- 身分證件
- 內衣褲
- 牙刷牙膏

### 根據天數增加
例如衣物數量隨天數調整：
- 上衣
- 內衣
- 襪子

### 根據 destinationType
如果是 international：
- 護照
- 轉接頭（可選）
- 外幣 / 國際信用卡提醒（可選）

### 根據 weather
如果是 cold：
- 外套
- 保暖衣物

如果是 rainy：
- 雨具
- 防水袋（可選）

如果是 hot：
- 防曬用品
- 帽子

### 根據 purpose
如果是 business：
- 筆電
- 正式服裝
- 名片（可選）

如果是 beach：
- 泳衣
- 拖鞋
- 防曬用品

如果是 outdoor：
- 運動衣物
- 水壺
- 防蚊用品

---

## 11. 頁面架構建議

### 11.1 首頁 / Hero
- 專案名稱
- 一句簡介
- Start Packing 按鈕

### 11.2 Step 1：Trip Setup
表單輸入旅程條件

### 11.3 Step 2：Apply Personal Essentials
選擇是否套用個人固定模組

### 11.4 Step 3：Generated Packing List
顯示結果清單，按分類呈現，可勾選與編輯

### 11.5 Step 4：Export / Save
- 匯出 txt / markdown
- 儲存本地資料

---

## 12. UI / UX 建議

### 視覺方向
- 簡潔
- 輕量
- 不要太花
- 行動裝置友好

### UX 重點
- 不要一次顯示過多欄位
- 生成結果要清楚分組
- 勾選操作要順手
- 手機版也能快速勾選

### 顯示方式
建議用卡片或 section grouping：
- Documents
- Clothing
- Toiletries
- Electronics
- Health
- Others

---

## 13. 首頁文案方向草稿

### Title
Packing List Generator

### Subtitle
Generate a practical trip packing checklist, then personalize it with your own essentials.

### CTA
- Start a Trip
- View Demo

---

## 14. 作品集包裝方式

這個專案如果放在作品集裡，描述不要寫成：
- A checklist app

這樣太弱。

比較好的描述方式：

> A front-end packing list generator designed for trip preparation.  
> It creates a practical base checklist from trip conditions, then lets users customize the result with personal essentials and local persistence.

或中文：

> 一個以旅行準備為情境的前端工具，根據旅程條件生成基礎行李清單，並支援個人固定需求客製化與本機保存。

---

## 15. 這題的亮點

1. **有明確使用情境**
   - 旅行前準備

2. **不需要後端**
   - 適合 github.io

3. **不是標準死模板**
   - 可以個人化

4. **不是一般 todo app**
   - 有條件生成邏輯

5. **可持續擴充**
   - trip profiles
   - export/import
   - category presets

---

## 16. 建議技術

如果只是純 github.io：
- HTML / CSS / JavaScript
- 或 React + Vite
- 或 Astro + 小型 client component

如果你想做得比較有 component 結構，建議：
- React + TypeScript + Vite

如果你之後想把它整合進 personal portal，也可考慮：
- Astro + React components

---

## 17. 給 Codex 的實作要求

可直接這樣描述：

### 目標
建立一個可部署到 GitHub Pages 的 Packing List Generator。

### 核心需求
1. 使用者可輸入旅程條件
2. 系統根據規則生成分類式行李清單
3. 使用者可建立與套用 Personal Essentials
4. 清單可勾選、增刪、編輯
5. 資料保存在 localStorage
6. 支援匯出 txt / markdown
7. 需支援手機版

### 非需求
- 不需要登入
- 不需要後端
- 不需要第三方 API
- 不需要 AI 功能

---

## 18. 建議實作順序

1. 先定義 TripConditions 與 PackingItem 資料結構
2. 先做 Trip Setup 表單
3. 實作規則生成函式
4. 顯示分類式 checklist
5. 加入編輯 / 勾選功能
6. 接 localStorage
7. 加 Personal Essentials
8. 加 Export
9. 最後做 UI polish 與手機版調整

---

## 19. 成功標準

這個專案第一版完成後，應該要做到：

- 使用者能快速建立一份旅行清單
- 清單不是死的，可修改
- 能保留個人固定需求
- 關掉網站後資料仍在
- 整體流程完整，不像半成品 demo

---

## 20. 一句話總結

這個專案不是在解決「所有人該帶什麼」，
而是在解決：

**每次旅行都要從零開始整理行李，而且個人習慣難以套用的麻煩。**
