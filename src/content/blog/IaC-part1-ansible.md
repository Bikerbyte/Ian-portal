---
title: "IaC 學習筆記 & 實作紀錄 - Ansible"
excerpt: "Ansible 從零到面試不怕被問：基礎、Inventory、Playbook、Variables、Template、Handler、Roles、Vault、面試重點整理。"
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

- Ansible 介紹與架構
- 安裝方式
- Inventory 設定（含 Dynamic Inventory）
- Ad-Hoc 指令
- 第一個 Playbook 實作
- Variables、Facts、Magic variables
- Jinja2 Template
- Handler（事件驅動）
- 控制流：when、loop、block/rescue
- Tags、Check mode、Diff
- Roles 結構化
- Ansible Vault（敏感資料）
- ansible.cfg 與常見調校
- Ansible 與其他工具比較
- 面試常考重點
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

## Variables、Facts、Magic variables

Ansible 的變數來源有很多種，**優先序由低到高**大致是：

1. `role defaults`（`roles/xxx/defaults/main.yml`）
2. inventory group/host variables
3. playbook `vars`、`vars_files`
4. role `vars`（`roles/xxx/vars/main.yml`）
5. block / task `vars`
6. `set_fact`、`register`
7. `-e / --extra-vars`（CLI，**最高優先**）

在 Playbook 內用變數：

```yaml
- hosts: web
  vars:
    nginx_port: 8080
  tasks:
    - debug:
        msg: "Nginx will listen on {{ nginx_port }}"
```

**Facts** 是 Ansible 跑 `setup` module 自動收集的目標主機資訊，例如 `ansible_os_family`、`ansible_distribution`、`ansible_memtotal_mb`，可以拿來做條件判斷。如果不需要可以加 `gather_facts: false` 加快執行速度。

**Magic variables** 是 Ansible 自動提供的特殊變數，常用的：

- `inventory_hostname`：目前正在處理的主機名稱。
- `hostvars`：所有主機的變數，例如 `hostvars['db1'].ansible_host`。
- `groups`：所有群組，例如 `groups['web']` 列出 web 群組的所有主機。
- `ansible_play_hosts`：目前 play 中還沒失敗的主機。

`register` 把上一個 task 的結果存進變數：

```yaml
- shell: cat /etc/os-release
  register: os_info

- debug:
    var: os_info.stdout
```

## Jinja2 Template

`template` module 跟 `copy` 很像，差別是會經過 **Jinja2** 處理變數和邏輯，常用於設定檔。

`templates/nginx.conf.j2`：

```jinja
server {
    listen {{ nginx_port | default(80) }};
    server_name {{ inventory_hostname }};

    {% if enable_gzip | default(true) %}
    gzip on;
    {% endif %}

    location / {
        root /var/www/{{ site_name }};
    }
}
```

Playbook：

```yaml
- name: Deploy nginx config
  template:
    src: nginx.conf.j2
    dest: /etc/nginx/conf.d/site.conf
    owner: root
    group: root
    mode: "0644"
  notify: restart nginx
```

`notify` 會觸發後面定義的 handler。

## Handler（事件驅動）

Handler 只有在被 `notify` 而且 task 真的有 `changed` 時才會執行，且**整個 play 跑完才執行一次**。最常用於「設定檔變更後重啟服務」這個情境，避免重複重啟。

```yaml
- hosts: web
  become: true
  tasks:
    - name: Deploy nginx config
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/conf.d/site.conf
      notify: restart nginx

  handlers:
    - name: restart nginx
      service:
        name: nginx
        state: restarted
```

如果想立刻觸發而不等到 play 結束，可以 `meta: flush_handlers`。

## 控制流：when、loop、block/rescue

**`when`**：條件判斷。

```yaml
- name: Install nginx (Debian)
  apt:
    name: nginx
    state: present
  when: ansible_os_family == "Debian"

- name: Install nginx (RedHat)
  yum:
    name: nginx
    state: present
  when: ansible_os_family == "RedHat"
```

**`loop`**：迴圈（取代舊版 `with_items`）。

```yaml
- name: Install multiple packages
  apt:
    name: "{{ item }}"
    state: present
  loop:
    - nginx
    - curl
    - vim
```

**`block / rescue / always`**：類似 try/except，做錯誤處理。

```yaml
- block:
    - name: Try risky task
      command: /opt/might-fail.sh
  rescue:
    - name: Run if block failed
      debug:
        msg: "Failed, doing fallback"
  always:
    - name: Always run cleanup
      file:
        path: /tmp/lock
        state: absent
```

## Tags、Check mode、Diff

**Tags**：給 task 貼標籤，執行時可以只跑特定區塊。

```yaml
- name: Install nginx
  apt: name=nginx state=present
  tags: [install, nginx]

- name: Deploy config
  template: src=nginx.conf.j2 dest=/etc/nginx/conf.d/site.conf
  tags: [config, nginx]
```

```bash
# 只跑 config 相關的 task
ansible-playbook site.yml --tags config

# 跳過某些 tag
ansible-playbook site.yml --skip-tags install
```

**Check mode（`--check`）**：dry run，預演不會真的改變。
**Diff mode（`--diff`）**：顯示檔案內容的差異。

```bash
ansible-playbook site.yml --check --diff
```

正式 apply 前先 `--check --diff` 是個好習慣。

## Roles 結構化

Playbook 寫久了會變很長，**Role** 是把相關的 tasks、templates、handlers、variables 包成可重用模組的標準結構：

```
roles/
└── nginx/
    ├── defaults/main.yml      # 預設變數（最低優先）
    ├── vars/main.yml          # role 內部變數（高優先）
    ├── tasks/main.yml         # 主要任務
    ├── handlers/main.yml      # handlers
    ├── templates/             # jinja2 模板
    ├── files/                 # 靜態檔案
    ├── meta/main.yml          # role 依賴、metadata
    └── README.md
```

Playbook 改成這樣引用：

```yaml
- hosts: web
  become: true
  roles:
    - role: nginx
      vars:
        nginx_port: 8080
```

或用 `import_role` / `include_role` 動態載入。

**Ansible Galaxy** 是 role 的中央庫：

```bash
# 從 Galaxy 安裝 role
ansible-galaxy install geerlingguy.nginx

# 建立 role 骨架
ansible-galaxy init my_role
```

## Ansible Vault（敏感資料）

密碼、API key、TLS private key 這類敏感資料不該明文放在 git。**Ansible Vault** 用對稱加密把整個檔案或單一變數加密。

```bash
# 建立加密檔
ansible-vault create secrets.yml

# 編輯
ansible-vault edit secrets.yml

# 把現有檔案加密
ansible-vault encrypt vars/prod.yml

# 解密為明文（謹慎使用）
ansible-vault decrypt vars/prod.yml

# 變更密碼
ansible-vault rekey secrets.yml
```

跑 Playbook 時提供密碼：

```bash
ansible-playbook site.yml --ask-vault-pass
# 或從檔案讀
ansible-playbook site.yml --vault-password-file ~/.vault_pass
```

也可以只加密 YAML 內的單一字串：

```bash
ansible-vault encrypt_string 'super-secret' --name 'db_password'
```

## ansible.cfg 與常見調校

專案根目錄放 `ansible.cfg` 集中設定，避免每次 CLI 都加參數：

```ini
[defaults]
inventory = ./inventory.ini
host_key_checking = False
forks = 20
stdout_callback = yaml
retry_files_enabled = False
gathering = smart
fact_caching = jsonfile
fact_caching_connection = /tmp/ansible_facts
fact_caching_timeout = 7200

[ssh_connection]
pipelining = True
control_path = /tmp/ansible-ssh-%%h-%%p-%%r
```

幾個常見效能調校：

- **`pipelining = True`**：減少 SSH 操作次數，能有明顯加速（要求 sudoers 沒設 `requiretty`）。
- **`forks`**：同時連線的主機數。預設 5，量大的話可以拉到 20–50。
- **`gathering = smart` + fact cache**：跨 play 共用 facts，不用每次重撈。
- **`strategy: free`**：讓快的主機先跑完，不必等慢的（預設是 linear）。

## Dynamic Inventory

固定主機用 ini/yaml 寫死沒問題，但雲端 AutoScaling 環境 IP 會變，這時用 **Dynamic Inventory** 從 AWS、GCP、Azure 等動態抓主機清單。

AWS 範例（`aws_ec2.yml`）：

```yaml
plugin: amazon.aws.aws_ec2
regions:
  - ap-northeast-1
filters:
  tag:Environment: prod
keyed_groups:
  - key: tags.Role
    prefix: role
hostnames:
  - private-ip-address
```

用法：

```bash
ansible-inventory -i aws_ec2.yml --graph
ansible -i aws_ec2.yml role_web -m ping
```

## Ansible 與其他工具比較

| 工具 | 架構 | 語言 | 特性 |
|------|------|------|------|
| **Ansible** | Push (agentless, SSH) | YAML | 學習曲線低，無 agent |
| **Puppet** | Pull (agent) | Puppet DSL | 大規模成熟，需 agent |
| **Chef** | Pull (agent) | Ruby DSL | 程式化能力強 |
| **SaltStack** | Push/Pull (agent, ZeroMQ) | YAML | 速度快，事件驅動 |

**Push vs Pull**：Ansible 屬於 push（從控制節點主動連到目標），而 Puppet/Chef 屬於 pull（agent 定期回去拉設定）。Push 設定簡單但大規模會有連線數壓力，Pull 適合上萬台、不穩定網路環境。

## 面試常考重點

**1. Ansible 是 push 還是 pull？為什麼是 agentless？**  
Push，控制節點透過 SSH（Linux）或 WinRM（Windows）連線目標執行。Agentless 是因為只需要目標有 Python 跟 SSH，不用裝 agent，部署門檻低。

**2. Idempotency 怎麼保證？哪些 module 不保證？**  
大多數 module 內建狀態判斷（`apt`, `service`, `file`, `template`）— 已經符合就回 `ok`，有差異才 `changed`。**`shell` 和 `command` 不保證** idempotent，因為 Ansible 不知道你的指令會做什麼，所以每次都會跑（顯示 `changed`）。若必須用，搭配 `creates` / `removes` 參數，或用 `changed_when` / `failed_when` 控制狀態回報。

**3. `shell` 跟 `command` 的差異？什麼時候用？**  
`command` 不會經過 shell 解析，不支援 `|`、`>`、`$VAR` 等 shell 語法，比較安全。`shell` 會經過 shell，可以用管線跟變數展開。**優先用專屬 module**（`apt`、`copy`、`file`…），module 都沒有才考慮 `command`，最後才用 `shell`。

**4. Handler 跟 Task 差在哪？**  
Handler 是事件驅動，只在被 `notify` 而且 task 真的 `changed` 時觸發；多次 notify 同個 handler 只會跑一次；預設整個 play 結束才執行。最常拿來「設定變更後重啟服務」。

**5. Variable 優先序？**  
記憶口訣（高 → 低）：**extra-vars > set_fact/register > task vars > block vars > role vars (vars/) > play vars > host facts > host_vars > group_vars > role defaults**。CLI `-e` 永遠最高。常見坑：`set_fact` 設過的值會覆蓋 task/block/role vars，debug 變數衝突時要先想到這條。

**6. 如何只跑 Playbook 的某一部分？**  
- `--tags` / `--skip-tags`
- `--start-at-task "task name"`
- `--limit <host pattern>` 限制目標主機
- `--check` dry-run，`--diff` 看檔案差異

**7. Ansible 處理敏感資料的方式？**  
Ansible Vault 加密整個檔案或單一字串。實務上 vault password 不應 commit，可以放外部 secret manager（Vault, AWS Secrets Manager）或用 `--vault-password-file` 指到本機路徑。

**8. Ansible 跑得慢，可以怎麼調校？**  
- 開 `pipelining`、提高 `forks`
- 不需要 facts 時設 `gather_facts: false`
- 開 fact caching 跨 play 共用
- `strategy: free` 讓主機獨立進度
- `serial: N` 批次部署（也用於滾動更新避免全掛）
- SSH `ControlMaster` 重用連線

**9. Ansible 適合做基礎設施佈建嗎？**  
不太適合。Ansible 強項是「進入主機後做設定」，雖然有 `ec2`、`gcp_*` 等雲端 module 可以建資源，但缺乏 Terraform 那種 state、dependency graph、drift detection，大規模基礎設施還是 Terraform 比較合適。實務上常見組合：**Terraform 建基礎設施，Ansible 上去做設定**。

**10. Playbook 失敗一半，怎麼處理？**  
- `ignore_errors: yes` 忽略單一 task 錯誤繼續跑
- `block / rescue / always` 做結構化錯誤處理
- `failed_when` 自訂失敗條件
- `--start-at-task` 從失敗點重跑
- 預設 Ansible 會把失敗主機從後續 play 排除，可以用 `any_errors_fatal: true` 改成只要有任何主機失敗就整批中止

## 小結

這篇從基礎一路寫到面試會被問的細節，重點脈絡：

- **核心觀念**：agentless / push / idempotent / 描述目標狀態
- **基本流程**：Inventory → Ad-Hoc 驗證 → Playbook 正式化
- **結構化**：Variables、Template、Handler、Role 是專案長大必經的演進
- **正式環境**：Vault 處理敏感資料、ansible.cfg 調校效能、Dynamic Inventory 對應雲端
- **定位**：Ansible 偏「設定管理」，跟 Terraform 的「基礎設施佈建」互補

下一篇進入 Terraform，會做相同深度的整理，最後比較兩者怎麼搭配使用。
