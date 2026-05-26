---
title: "Ansible Role 開發實戰 - 從零寫一個 production-grade nginx role"
excerpt: "Role 目錄結構、defaults vs vars 怎麼用、Handler 設計、Idempotency 測試（Molecule）、Galaxy 發佈、整合 CI、面試常考題。"
date: 2026-08-28
category: "學習"
tags:
  - Ansible
  - IaC
  - DevOps
series: "IaC Lab"
seriesOrder: 7
featured: false
---

## Agenda

- 為什麼要寫 Role
- Role 目錄結構（完整版）
- 設計原則：介面小、可測試、可重用
- 從零實作 nginx role
- defaults vs vars vs role_vars 優先序
- Handler 設計：notify / listen
- Tags 設計
- Idempotency 測試與 Molecule
- 整合 CI（GitHub Actions）
- 上 Ansible Galaxy
- Collections 是什麼？跟 Role 差別
- 反模式
- 面試常考重點
- 小結

## 為什麼要寫 Role

Playbook 寫久了會發現：

- 同一段「裝 nginx + 寫 config + 起服務」反覆出現
- Playbook 內 task 很多、難 review
- Variable 散落各處、變更難追蹤
- 想分享給別的 team 用，但糾結在某個專案的 inventory

**Role** 是 Ansible 的可重用包：把 tasks / templates / handlers / variables 打包成標準結構，跟 inventory 解耦，可以給多個 playbook / 多個專案重複使用。

**最佳實踐：playbook 不寫 tasks，只 include roles**：

```yaml
- hosts: web
  roles:
    - common
    - { role: nginx, nginx_port: 8080 }
    - app
```

## Role 目錄結構（完整版）

```
roles/nginx/
├── defaults/main.yml       # 預設變數（最低優先，可被覆寫）
├── vars/main.yml           # 內部變數（高優先，不該被外面動）
├── tasks/main.yml          # 主要 tasks
├── tasks/install.yml       # 拆分的子 tasks
├── tasks/configure.yml
├── tasks/service.yml
├── handlers/main.yml       # event handlers
├── templates/              # Jinja2 模板（.j2）
│   ├── nginx.conf.j2
│   └── site.conf.j2
├── files/                  # 靜態檔案
│   └── 50x.html
├── meta/main.yml           # role metadata（依賴、Galaxy 資訊）
├── molecule/               # 測試
│   └── default/
│       ├── molecule.yml
│       ├── converge.yml
│       └── verify.yml
└── README.md
```

**用 `ansible-galaxy init` 自動建：**

```bash
ansible-galaxy init nginx
# 自動產生標準骨架
```

## 設計原則

### 1. 介面小

Role 對外應該只暴露**少數核心 variables**：

```yaml
# defaults/main.yml — role 的「API」
nginx_port: 80
nginx_user: www-data
nginx_worker_processes: auto
nginx_sites: []                # 給使用者放 site config
```

使用者要設的越少越好。複雜內部邏輯放 `vars/main.yml` 或 `tasks/`。

### 2. Idempotent

- 用 `apt` / `yum` / `service` / `template` 等 idempotent module
- 避免 `shell` / `command`，必要時加 `creates` / `removes` / `changed_when`
- 不寫絕對路徑（用 variable）

### 3. 一個 Role 做一件事

- ✅ `nginx` role：裝 nginx + config + service
- ❌ `webserver` role：裝 nginx + 防火牆 + cert + 監控 agent + log shipping

太大就拆。組合用 `meta/main.yml` 的 dependencies 串：

```yaml
# nginx role 的 meta/main.yml
dependencies:
  - role: firewall
  - role: ssl-cert
```

### 4. 預設值合理

`defaults/main.yml` 內的值應該**直接套用都跑得起來**。不要寫一堆 `# please override this`，工程師會直接複製貼上忘了改。

### 5. 跨 OS 友善

寫好的 role 應該支援 Ubuntu / RHEL / Amazon Linux：

```yaml
# tasks/install.yml
- name: Install nginx (Debian)
  apt:
    name: nginx
    state: present
    update_cache: yes
  when: ansible_os_family == "Debian"

- name: Install nginx (RedHat)
  yum:
    name: nginx
    state: present
  when: ansible_os_family == "RedHat"
```

或用 `include_tasks` 按 OS 切：

```yaml
# tasks/main.yml
- include_tasks: install-{{ ansible_os_family | lower }}.yml
- include_tasks: configure.yml
- include_tasks: service.yml
```

## 從零實作 nginx role

完整跑一遍。

### Step 1：建骨架

```bash
mkdir -p ansible/roles
cd ansible/roles
ansible-galaxy init nginx
```

### Step 2：defaults

`roles/nginx/defaults/main.yml`：

```yaml
---
# 對外的 role API
nginx_user: www-data
nginx_worker_processes: auto
nginx_worker_connections: 1024
nginx_port: 80
nginx_ssl_port: 443
nginx_root: /var/www/html
nginx_enable_gzip: true
nginx_log_level: warn

# 站台清單 (使用者 override)
nginx_sites: []
# 範例:
# nginx_sites:
#   - name: example.com
#     port: 80
#     root: /var/www/example
```

### Step 3：vars（內部不可動的）

`roles/nginx/vars/main.yml`：

```yaml
---
# 內部常數
nginx_conf_dir: /etc/nginx
nginx_sites_dir: /etc/nginx/sites-available
nginx_sites_enabled_dir: /etc/nginx/sites-enabled
nginx_package_name: nginx
nginx_service_name: nginx
```

### Step 4：tasks

`roles/nginx/tasks/main.yml`：

```yaml
---
- include_tasks: install.yml
  tags: [install, nginx]

- include_tasks: configure.yml
  tags: [config, nginx]

- include_tasks: sites.yml
  tags: [sites, nginx]

- include_tasks: service.yml
  tags: [service, nginx]
```

**`tasks/install.yml`**：

```yaml
---
- name: Install nginx package
  apt:
    name: "{{ nginx_package_name }}"
    state: present
    update_cache: yes
    cache_valid_time: 3600
  when: ansible_os_family == "Debian"
  notify: nginx restart
```

**`tasks/configure.yml`**：

```yaml
---
- name: Deploy nginx.conf
  template:
    src: nginx.conf.j2
    dest: "{{ nginx_conf_dir }}/nginx.conf"
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"      # 驗證 config 才寫入
  notify: nginx reload

- name: Ensure document root exists
  file:
    path: "{{ nginx_root }}"
    state: directory
    owner: "{{ nginx_user }}"
    group: "{{ nginx_user }}"
    mode: "0755"
```

**`tasks/sites.yml`**：

```yaml
---
- name: Deploy site configs
  template:
    src: site.conf.j2
    dest: "{{ nginx_sites_dir }}/{{ item.name }}.conf"
    owner: root
    group: root
    mode: "0644"
  loop: "{{ nginx_sites }}"
  notify: nginx reload

- name: Enable sites
  file:
    src: "{{ nginx_sites_dir }}/{{ item.name }}.conf"
    dest: "{{ nginx_sites_enabled_dir }}/{{ item.name }}.conf"
    state: link
  loop: "{{ nginx_sites }}"
  notify: nginx reload
```

**`tasks/service.yml`**：

```yaml
---
- name: Ensure nginx is enabled and started
  service:
    name: "{{ nginx_service_name }}"
    state: started
    enabled: yes
```

### Step 5：handlers

`roles/nginx/handlers/main.yml`：

```yaml
---
- name: nginx restart
  service:
    name: "{{ nginx_service_name }}"
    state: restarted
  listen: nginx restart

- name: nginx reload
  service:
    name: "{{ nginx_service_name }}"
    state: reloaded
  listen: nginx reload
```

**重點：** `listen` 讓多個 handler 可以共享同一個 event name。

### Step 6：templates

`roles/nginx/templates/nginx.conf.j2`：

```jinja
user {{ nginx_user }};
worker_processes {{ nginx_worker_processes }};

events {
    worker_connections {{ nginx_worker_connections }};
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" "$http_user_agent"';

    access_log /var/log/nginx/access.log main;
    error_log  /var/log/nginx/error.log {{ nginx_log_level }};

    sendfile        on;
    keepalive_timeout 65;

    {% if nginx_enable_gzip %}
    gzip on;
    gzip_types text/plain application/json application/javascript text/css;
    {% endif %}

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

`roles/nginx/templates/site.conf.j2`：

```jinja
server {
    listen {{ item.port | default(nginx_port) }};
    server_name {{ item.name }};
    root {{ item.root | default(nginx_root) }};

    location / {
        try_files $uri $uri/ =404;
    }

    {% if item.locations is defined %}
    {% for loc in item.locations %}
    location {{ loc.path }} {
        {{ loc.config }}
    }
    {% endfor %}
    {% endif %}
}
```

### Step 7：meta

`roles/nginx/meta/main.yml`：

```yaml
---
galaxy_info:
  role_name: nginx
  author: Ian Hsu
  description: Install and configure nginx
  license: MIT
  min_ansible_version: "2.14"
  platforms:
    - name: Ubuntu
      versions: [jammy, focal]
    - name: EL
      versions: ['8', '9']
  galaxy_tags:
    - nginx
    - webserver

dependencies: []
```

### Step 8：使用

`playbooks/site.yml`：

```yaml
- hosts: web
  become: yes
  roles:
    - role: nginx
      vars:
        nginx_port: 8080
        nginx_sites:
          - name: example.com
            root: /var/www/example
          - name: api.example.com
            port: 8081
            root: /var/www/api
```

跑：

```bash
ansible-playbook -i inventory.ini playbooks/site.yml
```

## defaults vs vars vs role_vars 優先序

從低到高：

1. `defaults/main.yml`（**最低**，最常用）
2. `vars/main.yml`（高，role 內部）
3. `host_vars` / `group_vars`（高，可覆寫 defaults 但不覆寫 vars/main）
4. Playbook `vars:` 直接傳給 role（最高，能 override 所有）
5. CLI `-e`（**最高**）

**規則：**

- `defaults/main.yml` 放預設值，使用者改這個
- `vars/main.yml` 放內部常數（路徑、套件名），使用者**不該動**
- 不要混用，把可調的都放 defaults

## Handler 設計：notify / listen

**Notify 規則：**

- handler 只在被 notify 而且 task 真的 `changed` 時跑
- 整個 play 跑完才執行（除非 `meta: flush_handlers`）
- 同 handler 多次 notify 只跑一次

**listen 模式（推薦）：**

讓多個 handler 共用同一個 event：

```yaml
# handlers/main.yml
- name: restart nginx
  service:
    name: nginx
    state: restarted
  listen: restart web
  
- name: clear cache
  file:
    path: /tmp/cache
    state: absent
  listen: restart web
```

```yaml
# tasks/main.yml
- name: deploy
  template:
    src: app.conf.j2
    dest: /etc/app.conf
  notify: restart web      # 觸發兩個 handler
```

**為什麼用 listen 比 name 好：**

- 解耦 task 跟 handler 細節
- 多 handler 可共用一個 event
- handler 改名不影響 task

## Tags 設計

讓使用者可以只跑特定區塊：

```yaml
- include_tasks: install.yml
  tags: [install, nginx]

- include_tasks: configure.yml
  tags: [config, nginx]
```

跑：

```bash
ansible-playbook site.yml --tags config       # 只跑 config
ansible-playbook site.yml --skip-tags install # 跳過 install
```

**Tag 慣例：**

- 每個 role 加 role 名稱 tag（`nginx`）
- 階段性 tag（`install` / `config` / `service`）
- 用法 tag（`firewall` / `cert`）

## Idempotency 測試與 Molecule

Idempotency 是 Ansible 核心，但開發時容易破壞。**Molecule** 自動化測試 role。

### 安裝

```bash
pip install molecule molecule-plugins[docker] ansible
```

### 初始化

```bash
cd roles/nginx
molecule init scenario default
```

產生 `molecule/default/` 結構：

```
molecule/default/
├── molecule.yml         # 測試環境定義
├── converge.yml         # 跑 role 的 playbook
└── verify.yml           # 驗證結果
```

### `molecule.yml`

```yaml
---
dependency:
  name: galaxy
driver:
  name: docker
platforms:
  - name: ubuntu-22
    image: geerlingguy/docker-ubuntu2204-ansible:latest
    pre_build_image: true
provisioner:
  name: ansible
verifier:
  name: ansible
```

### `converge.yml`

```yaml
---
- hosts: all
  become: yes
  roles:
    - role: nginx
      vars:
        nginx_sites:
          - name: test.local
            root: /var/www/test
```

### `verify.yml`

```yaml
---
- hosts: all
  tasks:
    - name: nginx is running
      service:
        name: nginx
        state: started
      check_mode: yes
      register: result
      failed_when: result.changed

    - name: site config exists
      stat:
        path: /etc/nginx/sites-enabled/test.local.conf
      register: site
      failed_when: not site.stat.exists

    - name: nginx responds
      uri:
        url: http://localhost
        status_code: [200, 404]
```

### 跑測試

```bash
# 完整跑：create → converge → idempotence → verify → destroy
molecule test

# 只 converge 然後保留 container debug
molecule converge
molecule login                    # 進入容器
molecule destroy
```

**Idempotence test 怎麼跑：**

`molecule test` 會跑 role 兩次，第二次**不該有任何 `changed`**。有的話就是 role 內某個 task 不 idempotent。

## 整合 CI（GitHub Actions）

`.github/workflows/molecule.yml`：

```yaml
name: molecule

on:
  push:
    paths: [roles/**]
  pull_request:
    paths: [roles/**]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        distro: [ubuntu2204, rockylinux9]

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install molecule molecule-plugins[docker] ansible ansible-lint

      - name: ansible-lint
        run: ansible-lint roles/

      - name: molecule test
        run: molecule test
        env:
          MOLECULE_DISTRO: ${{ matrix.distro }}
        working-directory: roles/nginx
```

每次 PR / push 自動測 idempotency + 多 OS。

## 上 Ansible Galaxy

把 role 公開分享：

```bash
# 1. 註冊 https://galaxy.ansible.com
# 2. 連 GitHub
# 3. 在 Galaxy import 你的 repo
# 4. 別人裝你的 role
ansible-galaxy install your_user.nginx
```

**Galaxy 內常見好用 role：**
- `geerlingguy.nginx`
- `geerlingguy.docker`
- `geerlingguy.postgresql`
- `community.general`（collection）

## Collections 是什麼？跟 Role 差別

**Collections** 是 Ansible 新一代封裝（2.10+）：

- 一個 collection 可以包多個 role + module + plugin
- 命名空間：`namespace.collection_name`（例 `amazon.aws`、`community.general`）
- 從 Galaxy 或 Automation Hub 安裝
- 比 role 更現代、更完整

```bash
ansible-galaxy collection install amazon.aws
ansible-galaxy collection install community.kubernetes
```

寫 playbook 時引用 collection 內的東西：

```yaml
- hosts: localhost
  tasks:
    - name: Create S3 bucket
      amazon.aws.s3_bucket:
        name: my-bucket
        state: present
```

**何時用 Role vs Collection：**

- 一個小元件、配置管理 → Role
- 一整套工具（含 module + plugin + role） → Collection

新專案可以直接用 collection 結構，舊 role 漸進遷移。

## 反模式

**1. Role 太大**
- 一個 role 做太多事 → 拆成幾個 + dependencies

**2. defaults 沒設預設值**
- 寫 `nginx_port: ""` 強迫使用者改 → 預設值該直接可用

**3. shell module 滿天飛**
- 失去 idempotency → 改用專屬 module 或加 `creates` / `changed_when`

**4. 沒有 README**
- 別人不知道怎麼用、有哪些 variable
- 至少寫：用途、必要 variable、範例 playbook

**5. Hardcode 路徑**
- 例：`/var/log/myapp.log` 寫死 → 變數化

**6. 沒測試**
- Role 改了破壞 idempotency 沒人發現 → Molecule + CI

**7. 直接 hardcode OS**
- 假設只有 Ubuntu → 用 `when: ansible_os_family == "Debian"` 兼容

## 面試常考重點

**1. Role 跟 Playbook 差在哪？**  
Playbook 是「執行入口」（hosts + roles + tasks），Role 是「可重用模組」（標準目錄結構 + 解耦於 inventory）。Playbook 應該瘦（只 include roles），複雜邏輯放 Role。

**2. defaults 跟 vars 怎麼分？**  
`defaults/main.yml`：預設值（最低優先），使用者可以 override 的「API」。`vars/main.yml`：內部常數（高優先），使用者不該動。規則：可調的放 defaults，內部實作放 vars。

**3. 怎麼確保 Role 是 idempotent？**  
- 用內建 idempotent module（apt / service / file / template）
- 避免 shell / command；要用就加 `creates` / `removes` / `changed_when`
- 用 Molecule 自動跑 idempotence test（跑兩次第二次不該 changed）
- CI 跑

**4. Handler 跟 Task 差在哪？**  
Handler 只在被 notify 且 task `changed` 時觸發；同 play 內多次 notify 只跑一次；預設整個 play 結束才執行。最常用「config 變更後重啟服務」場景，避免重複重啟。

**5. listen vs notify by name 差在哪？**  
`notify: <handler name>` 直接指名。`listen: <event>` 讓多個 handler 共用一個 event，task notify event 名稱即可。**listen 解耦 task 跟 handler 細節**，更彈性。

**6. Role 依賴怎麼處理？**  
`meta/main.yml` 內 `dependencies` 列其他 role。例如 nginx role 依賴 firewall + ssl-cert。**注意：dependencies 是隱性依賴**，使用者引用 nginx 時兩個依賴 role 自動先跑。實務上要明示，避免依賴鏈太深。

**7. Molecule 解決什麼問題？**  
自動化 role 測試：建容器 / VM → 跑 role → 驗證結果 → 跑 idempotency test → 銷毀。沒 Molecule 開發 role 等於沒測試，PR 上會破壞 idempotency 沒人發現。

**8. Role 怎麼支援多 OS？**  
- `when: ansible_os_family == "Debian"` 條件套用 apt task
- 把 OS-specific 拆成 `tasks/install-ubuntu.yml`、`tasks/install-rhel.yml`
- 用 `include_tasks` 動態 include
- vars 內放跨 OS 的差異（package name、service name）

**9. Ansible Collections 跟 Role 差在哪？**  
Collection 是更大的封裝單位，包含 role + module + plugin。Galaxy 上現在主推 collection（amazon.aws、community.general）。新專案可以直接寫 collection，舊 role 可以包進 collection 內。

**10. role 太大不好維護怎麼辦？**  
- 拆成小 role + dependencies
- 一個 role 一件事
- 變數介面 < 10 個
- 把 OS-specific 拆 include_tasks
- 用 Molecule 各別測試

**11. Ansible Vault 怎麼跟 role 用？**  
敏感 variables 放在 vault-encrypted file：

```bash
ansible-vault encrypt group_vars/prod/secrets.yml
```

role 內引用 vault variable 就跟一般 variable 一樣，跑 playbook 時提供 vault password。

**12. role 上 production 前該做什麼 QA？**  
- ansible-lint 跑過
- Molecule 在多 OS 跑過 idempotency
- README 完整（用途 / variables / 範例）
- 版本 tag（git tag）
- changelog 記錄變更
- CI 自動跑測試

## 小結

Ansible Role 是工程化 Ansible 的關鍵：

| 元素 | 角色 |
|------|------|
| `defaults/` | 對外 API（可被覆寫） |
| `vars/` | 內部常數 |
| `tasks/` | 主要邏輯，拆成小檔 |
| `handlers/` | event-driven，用 listen 解耦 |
| `templates/` | Jinja2 模板 |
| `meta/` | 依賴 / Galaxy info |
| `molecule/` | 自動化測試 |

**面試心法：**
- 講出 Playbook 該瘦、Role 該胖（但專注）
- 知道 defaults vs vars 的分工
- 強調 Molecule idempotence test
- 能畫出 handler notify / listen 流程
- 提到 Collections 是新方向

跟你旺宏經驗對照：你做 Workflow 自動化 + Helpdesk 平台，這些都可以包成 Role 上 Galaxy 內部用，**履歷講「我把內部自動化包成可重用 role 給多個團隊使用」**比「我寫過 Ansible playbook」更有故事性。
