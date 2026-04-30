---
title: "IaC 學習筆記 & 實作紀錄 - Ansible"
excerpt: "Ansible、Terraform"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Ansible
featured: false
---

## Agenda

- Ansible 介紹
- 安裝方式
- 實作

## Ansible 介紹

*[Ansible](https://github.com/ansible/ansible)* 是一個開源的 DevOps 工具，可用來實現基礎架構即程式碼（Infrastructure as code, IaC）的目標。

Ansible 架構其實非常簡單，分有以下兩種角色：
- 控制節點 (Management Node)：有安裝 Ansible ，存有 Inventory file 和 Playbooks，為整個 Ansible 架構的核心中控。
- 管理節點 (Control Node)：不需要安裝 Ansible，是欲管理的目標（可以是伺服器、網路設備或任何電腦裝置）。

如上所示，Ansible 屬於無代理程式 (Agentless) 的 IaC 工具，控制節點會透過 SSH 連線，將設定好的配置與規格 (Playbooks)，套用到管理節點上。

## 安裝方式 (以 Ubuntu 為例)

## Ansible Ad-Hoc 指令
Ad-Hoc 指令為 Ansible 提供的 cli 指令，適合開發與測試驗證使用。  
<br>
以此指令作為例子 ``ansible <host group> -m <module> -a <module args>``  
-m 後方代入模組名稱 (如: ping、apt、shell 等)  
-a 則代入模組的 arguments  
<br>
其他的 Ansible Ad-Hoc 應用如下表：

| 參數 / 選項             | 說明 | 範例 |
|------------------------|------|------|
| **-m MODULE**          | 指定要使用的模組，例如 `ping`、`shell`、`copy` | ``ansible all -m ping`` |
| **-a 'ARGS'**           | 模組的 arguments（模組參數） | ``ansible all -m shell -a "uptime"`` |
| **-i INVENTORY**        | 指定 inventory 檔案 | ``ansible all -i ./hosts -m ping`` |
| **-u USER**             | 指定登入主機的帳號 | ``ansible all -u admin -m ping`` |
| **-k / --ask-pass**     | 問 SSH 密碼（適用於非 key 登入） | ``ansible all -m ping -k`` |
| **--become**            | 使用 sudo/root 權限執行 | ``ansible all -m apt -a "name=nginx state=present" --become`` |
| **--ask-become-pass**   | 問 sudo 密碼 | ``ansible all -m apt -a "name=nginx state=present" --become --ask-become-pass`` |
| **-e EXTRA_VARS**       | 傳遞額外變數 | ``ansible all -e "var1=value1 var2=value2"`` |
| **-f FORKS**            | 同時執行的主機數（預設 5） | ``ansible all -m ping -f 10`` |
| **--limit HOST_PATTERN**| 限制執行的主機範圍 | ``ansible all -m ping --limit web1`` |
| **--timeout SECS**      | SSH 連線逾時秒數（預設 10） | ``ansible all -m ping --timeout 20`` |
| **-v / -vvv**           | 顯示詳細輸出（debug mode） | ``ansible all -m ping -vvv`` |

## Ansible 常用的模組(module)

| 模組名稱   | 功能說明 | Ad-Hoc 範例 |
|------------|---------|-------------|
| **ping**   | 測試與遠端主機的連通性 | `ansible all -m ping` |
| **shell**  | 在遠端主機上執行 shell 命令 | `ansible all -m shell -a "uptime"` |
| **command**| 執行命令（不會解析管道符號） | `ansible all -m command -a "ls /tmp"` |
| **copy**   | 將本地檔案複製到遠端 | `ansible all -m copy -a "src=/tmp/test.txt dest=/tmp/test.txt"` |
| **fetch**  | 從遠端取回檔案到本地 | `ansible all -m fetch -a "src=/var/log/syslog dest=./logs"` |
| **file**   | 管理檔案/目錄屬性（權限、擁有者、刪除等） | `ansible all -m file -a "path=/tmp/test.txt state=absent"` |
| **apt**    | 在 Debian/Ubuntu 系統上安裝或移除套件 | `ansible all -m apt -a "name=nginx state=present"` |
| **yum**    | 在 CentOS/RHEL 系統上安裝或移除套件 | `ansible all -m yum -a "name=httpd state=present"` |
| **service**| 管理服務啟動、停止、重新啟動 | `ansible all -m service -a "name=nginx state=started"` |
| **systemd**| 使用 systemd 管理服務與單元 | `ansible all -m systemd -a "name=nginx state=restarted"` |
| **user**   | 建立或管理使用者帳戶 | `ansible all -m user -a "name=testuser state=present"` |
| **group**  | 建立或管理群組 | `ansible all -m group -a "name=testgroup state=present"` |
| **setup**  | 收集遠端主機的系統資訊（facts） | `ansible all -m setup` |
| **timezone**| 設定系統時區 | `ansible all -m timezone -a "name=Asia/Taipei"` |
| **hostname**| 設定或檢查系統主機名稱 | `ansible all -m hostname -a "name=webserver1"` |
| **debug**  | 顯示變數或訊息 | `ansible all -m debug -a "msg='Hello world'"` |
