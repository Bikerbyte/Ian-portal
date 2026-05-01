---
title: "IaC 學習筆記 & 實作紀錄 - Ansible"
excerpt: "Ansible 基礎觀念、Inventory、Ad-Hoc 指令與第一個 Playbook 實作紀錄。"
date: 2026-04-30
category: "學習"
tags:
  - IaC
  - Ansible
series: "IaC Lab"
seriesOrder: 1
featured: false
---

## Agenda

- Ansible 介紹
- 安裝方式
- Inventory 設定
- Ad-Hoc 指令
- 第一個 Playbook 實作
- 小結

## Ansible 介紹

*[Ansible](https://github.com/ansible/ansible)* 是一個開源的 DevOps 工具，可用來實現基礎架構即程式碼（Infrastructure as code, IaC）的目標。

Ansible 架構其實非常簡單，分有以下兩種角色：
- 控制節點 (Control Node)：有安裝 Ansible，存有 Inventory file 和 Playbooks，負責下指令與執行自動化流程。
- 被管理節點 (Managed Node)：不需要安裝 Ansible，是欲管理的目標，可以是伺服器、網路設備或任何電腦裝置。

如上所示，Ansible 屬於無代理程式 (Agentless) 的 IaC 工具，控制節點會透過 SSH 連線，將設定好的配置與規格 (Playbooks)，套用到被管理節點上。

Ansible 的核心概念是「描述目標狀態」，而不是只寫一串命令。舉例來說，與其說「執行安裝 nginx 的指令」，更接近於描述「這台主機應該要安裝 nginx，且服務應該要啟動」。這種目標狀態的寫法，讓同一份設定可以重複執行，也比較適合被 Git 追蹤與團隊協作。

## 環境假設

這篇先用最小環境理解 Ansible 的操作流程：

- 一台 Ubuntu 作為控制節點。
- 一台或多台 Linux 主機作為被管理節點。
- 控制節點可以透過 SSH 連線到被管理節點。
- 被管理節點上有可登入的使用者，並視需求具備 sudo 權限。

## 安裝方式 (以 Ubuntu 為例)

先在控制節點安裝 Ansible：

```bash
sudo apt update
sudo apt install ansible -y
ansible --version
```

若要確認 SSH 是否能正常連線，可以先用一般 SSH 指令測試：

```bash
ssh ubuntu@192.168.1.10
```

如果需要使用 SSH key，建議先確認 key 已放到被管理節點的 `~/.ssh/authorized_keys`，避免後續執行 Ansible 時一直卡在連線或密碼問題。

## Inventory 設定

Inventory 是 Ansible 用來定義「有哪些主機要被管理」的檔案。可以先建立一個 `inventory.ini`：

```ini
[web]
web1 ansible_host=192.168.1.10 ansible_user=ubuntu

[db]
db1 ansible_host=192.168.1.11 ansible_user=ubuntu
```

上面的設定代表：

- `web` 與 `db` 是主機群組。
- `web1`、`db1` 是 Ansible 內使用的主機別名。
- `ansible_host` 是實際連線的 IP 或 domain。
- `ansible_user` 是 SSH 登入使用者。

建立好 Inventory 後，可以先使用 `ping` module 測試 Ansible 是否能連上所有主機：

```bash
ansible all -i inventory.ini -m ping
```

如果只想測試 `web` 群組：

```bash
ansible web -i inventory.ini -m ping
```

## Ansible Ad-Hoc 指令

Ad-Hoc 指令為 Ansible 提供的 CLI 指令，適合一次性操作、開發與測試驗證使用。

基本格式如下：

```bash
ansible <host group> -i <inventory file> -m <module> -a <module args>
```

其中：

- `<host group>` 代表 Inventory 裡的主機或群組，例如 `all`、`web`、`db`。
- `-i` 指定 Inventory 檔案。
- `-m` 後方代入模組名稱，例如 `ping`、`apt`、`shell`。
- `-a` 則代入模組的 arguments。

例如查看 `web` 群組的主機名稱：

```bash
ansible web -i inventory.ini -m shell -a "hostname"
```

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

## 第一個 Playbook 實作

Ad-Hoc 指令適合快速測試，但如果要把設定保存下來、重複執行、交給 Git 管理，就會改用 Playbook。

以下用安裝 nginx 當第一個 Playbook 範例，建立 `nginx.yml`：

```yaml
- name: Install and start nginx
  hosts: web
  become: true
  tasks:
    - name: Install nginx package
      apt:
        name: nginx
        state: present
        update_cache: true

    - name: Start and enable nginx service
      service:
        name: nginx
        state: started
        enabled: true
```

執行 Playbook：

```bash
ansible-playbook -i inventory.ini nginx.yml
```

這份 Playbook 做了幾件事：

- `hosts: web`：只套用到 Inventory 裡的 `web` 群組。
- `become: true`：使用 sudo 權限執行需要系統權限的任務。
- `apt state: present`：確保 nginx 套件存在。
- `service state: started`：確保 nginx 服務正在執行。
- `enabled: true`：確保 nginx 開機後會自動啟動。

## Idempotent 觀念

Ansible 很重要的一個特性是 Idempotent，意思是同一份 Playbook 可以重複執行，而且如果目標狀態已經符合設定，Ansible 就不會一直做重複變更。

例如上面的 nginx Playbook：

- 第一次執行時，可能會安裝 nginx 並啟動服務。
- 第二次執行時，如果 nginx 已安裝且服務已啟動，Ansible 會回報 `ok`，不會再次安裝。

這也是 Ansible 和單純 shell script 的差異之一。Shell script 常常是在描述「要做哪些步驟」，Ansible Playbook 則更偏向描述「最後狀態應該長什麼樣子」。

## Ad-Hoc 與 Playbook 的使用時機

| 使用方式 | 適合情境 | 特性 |
|----------|----------|------|
| Ad-Hoc | 測試連線、查詢狀態、一次性操作 | 快速、直接、不一定會保存 |
| Playbook | 正式設定、可重複流程、團隊協作 | 可讀性高、可版本控管、適合自動化 |

實務上通常會先用 Ad-Hoc 指令確認連線與模組行為，再把穩定的操作整理成 Playbook。

## 小結

這次先完成 Ansible 的基本操作流程：

- 安裝 Ansible。
- 建立 Inventory。
- 使用 Ad-Hoc 指令測試連線與執行簡單任務。
- 使用 Playbook 安裝並啟動 nginx。

下一步可以繼續補變數、template、handler、role 等結構化寫法。若要和 Terraform 比較，可以先把 Ansible 理解成偏向「設定管理」的工具，而 Terraform 則偏向「基礎設施佈建」的工具。
