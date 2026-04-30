---
title: "Observability 學習筆記 & 實作紀錄 - Grafana"
excerpt: "Grafana 基礎觀念、Ubuntu 安裝、Data Source、Dashboard 與第一個 Panel 實作紀錄。"
date: 2026-04-30
category: "學習"
tags:
  - Observability
  - Grafana
featured: false
---

## Agenda

- Grafana 介紹
- 環境假設
- 安裝方式
- 第一次登入
- Data Source 觀念
- 第一個 Dashboard 實作
- Alerting 與 Provisioning
- 小結

## Grafana 介紹

*[Grafana](https://grafana.com/grafana/)* 是一個常見的資料視覺化與監控平台，通常用來建立 Dashboard、查詢 metrics/logs/traces，並設定告警。

Grafana 本身不是資料庫，它比較像是一個查詢與視覺化入口。實際資料通常會放在其他系統中，例如：

- Prometheus：常用於 metrics。
- Loki：常用於 logs。
- Tempo：常用於 traces。
- Elasticsearch、InfluxDB、PostgreSQL、MySQL：也可以作為資料來源。

所以 Grafana 的核心流程可以先理解成：

1. 新增 Data Source。
2. 用 Query 從 Data Source 查資料。
3. 用 Panel 把資料視覺化。
4. 把多個 Panel 組成 Dashboard。
5. 視需求設定 Alert。

## 環境假設

這篇先用最小環境理解 Grafana 的操作流程：

- 一台 Ubuntu 主機。
- 安裝 Grafana OSS。
- 先用 Grafana 內建的 TestData data source 做練習。
- 後續若要接真實監控資料，可以再接 Prometheus、Loki 或其他資料來源。

## 安裝方式 (以 Ubuntu 為例)

先安裝必要套件：

```bash
sudo apt-get update
sudo apt-get install -y apt-transport-https wget gnupg
```

匯入 Grafana GPG key：

```bash
sudo mkdir -p /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/grafana.asc https://apt.grafana.com/gpg-full.key
sudo chmod 644 /etc/apt/keyrings/grafana.asc
```

加入 Grafana stable repository：

```bash
echo "deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main" | \
  sudo tee /etc/apt/sources.list.d/grafana.list
```

安裝 Grafana OSS：

```bash
sudo apt-get update
sudo apt-get install grafana
```

啟動 Grafana server：

```bash
sudo systemctl enable --now grafana-server
sudo systemctl status grafana-server
```

預設服務會跑在 `3000` port：

```text
http://<server-ip>:3000
```

官方安裝文件可以參考：[Install Grafana on Debian or Ubuntu](https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/)。

## 第一次登入

第一次開啟 Grafana 後，預設登入帳號通常是：

```text
Username: admin
Password: admin
```

登入後 Grafana 會要求修改密碼。這裡建議不要在正式環境保留預設密碼，也不要直接把 Grafana 暴露在公開網路上。

常見的正式環境做法會包含：

- 放在反向代理後方，例如 Nginx。
- 啟用 HTTPS。
- 設定 OAuth、LDAP 或 SSO。
- 限制管理者權限。

## Data Source 觀念

Data Source 是 Grafana 查詢資料的來源。沒有 Data Source，Grafana 就無法畫出真正有意義的圖表。

常見 Data Source 如下：

| Data Source | 常見用途 | 查詢語言或格式 |
|-------------|----------|----------------|
| Prometheus | Metrics、服務指標 | PromQL |
| Loki | Logs、應用程式日誌 | LogQL |
| Tempo | Traces、分散式追蹤 | TraceQL |
| Elasticsearch | Logs、搜尋資料 | Lucene / Query DSL |
| PostgreSQL | 關聯式資料 | SQL |
| TestData | 測試 Dashboard | Grafana 內建測試資料 |

初學可以先使用 `TestData`，不用先架 Prometheus，也可以練習 Panel、Dashboard 和 Alert 的操作。

## 第一個 Dashboard 實作

先建立一個測試用 Data Source：

1. 進入 Grafana 左側選單。
2. 找到 `Connections` 或 `Data sources`。
3. 新增 `TestData` data source。
4. 儲存設定。

接著建立 Dashboard：

1. 新增 Dashboard。
2. 新增 Panel。
3. Data Source 選擇 `TestData`。
4. Scenario 可以選擇 `Random Walk`。
5. Visualization 選擇 `Time series`。
6. 儲存 Dashboard。

完成後會看到一個隨時間變動的折線圖。雖然這只是測試資料，但流程和接 Prometheus 時很接近：

- 選 Data Source。
- 寫 Query。
- 選 Visualization。
- 調整 Panel 標題、Legend、Unit、Threshold。
- 儲存 Dashboard。

## Dashboard 設計重點

Dashboard 不是把所有數字塞在一起就好，重點是讓人快速判斷系統狀態。

可以先用這種順序安排：

| 區塊 | 內容 | 目的 |
|------|------|------|
| Overview | Request rate、Error rate、Latency | 先看服務是否健康 |
| Resource | CPU、Memory、Disk、Network | 判斷是否接近資源瓶頸 |
| Dependency | Database、Cache、External API | 判斷問題是否來自相依服務 |
| Detail | Log links、Trace links、Instance breakdown | 深入排查 |

技術上可以從單一服務開始，不需要一開始就做很大的總覽頁。先把一個服務的指標看清楚，再慢慢擴充比較容易維護。

## Alerting 觀念

Grafana 也可以設定 Alert。Alert 的目標不是讓系統一有波動就通知，而是提醒真正需要人處理的狀況。

常見 Alert 條件例如：

- 錯誤率持續高於門檻。
- P95 latency 持續過高。
- 磁碟空間低於安全值。
- 服務沒有回報 metrics。

設計 Alert 時可以注意：

- 條件要能對應到實際行動。
- 避免太敏感造成通知疲勞。
- 要設定合理的持續時間，例如連續 5 分鐘都異常才通知。
- 通知訊息要包含服務名稱、環境、Dashboard 連結與可能原因。

## Provisioning 觀念

如果 Dashboard 或 Data Source 都只靠 UI 手動設定，環境多了之後會很難維護。Grafana 支援 Provisioning，可以用檔案方式管理 Data Source、Dashboard 等設定。

例如可以用 YAML 管理 Prometheus data source：

```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

Provisioning 的好處是：

- 設定可以進 Git。
- 可以在不同環境重複部署。
- 比較容易做 review。
- 比較不會只有某台 Grafana 有設定。

這個觀念和 IaC 很接近，也能和 Terraform、Ansible 或 Docker Compose 搭配使用。

## 小結

這次先完成 Grafana 的基本操作流程：

- 安裝 Grafana OSS。
- 啟動 `grafana-server`。
- 理解 Data Source、Panel、Dashboard 的關係。
- 使用 TestData 建立第一個 Dashboard。
- 初步理解 Alerting 與 Provisioning。

下一步可以接 Prometheus，把 Linux node exporter 或應用程式 metrics 接進來，做出真正能觀察服務健康狀態的 Dashboard。
