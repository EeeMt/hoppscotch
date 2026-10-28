# Quickstart: authentik + 内网 / 无 SMTP 验收

本次用户已明确只需要 Web；不构建或验收原生 Desktop，浏览器 device-login/loopback 证据独立保留。这是实现与验收指南；已运行结果和未完成的实机门槛见 [validation.md](validation.md)。新建协议 harness 和 session-lifecycle e2e 路径已由 [plan.md](plan.md) 规定，实施时一并交付；其余命令使用仓库现有脚本。数据和错误契约分别见 [data-model.md](data-model.md)、[OIDC 接口](contracts/oidc.md)、[配置](contracts/configuration.md)。

## 1. 前置条件

本次用户指定复用 `.13` 上的既有 authentik，入口为 `https://auth.ihxq.fun:9999`。下面 `sso.internal` 为通用示例，实际验收须使用该实例的独立测试 Application 和真实 discovery/issuer，并保留 `:9999`（若 metadata 的规范地址不同，以核实后的配置为准）。入口不等于应用级 issuer，不能直接推断。沙箱匿名 HEAD 最初无法解析该域名；随后主机和 Node 24 容器在正常 TLS 校验下已确认可达，实机详情见 validation。新的部署仍须分别确认主机/浏览器和 backend 容器的内网 DNS、路由及 TLS；不得用跳过证书验证来代替连通性处理。

- 沿用仓库现有 Node 环境（CI Node 22、生产镜像 Node 24），记录实际 `node --version`；直接 require(esm) 路径须满足库兼容要求（Node 22.12+ 或当前生产 Node 24）。本功能不要求升级 Node 或扩大 CI 矩阵。pnpm 10.34.5、PostgreSQL 和完整 workspace 依赖已在联网构建机或内网依赖镜像准备好。
- 浏览器和 backend 可访问同一个内网 authentik；记录版本、镜像 digest、issuer、scope 和 client authentication。不要以 latest 作为验收版本记录。
- authentik 本地用户具有合法邮箱字符串，但无需可收信、无需验证流；准备用户 A（verified=false）、B（缺失 verified）、C（另一个身份，邮箱与已有用户冲突）。
- 防火墙仅允许测试客户端/backend 访问内网 app、admin、IdP、PostgreSQL、DNS/时间服务及 desktop loopback，禁止公网出口；有拒绝日志/浏览器网络记录作为证据。规则在首次启动前生效，不能用已缓存 JWKS 掩盖公网依赖。
- 私有 CA 同时导入浏览器和 backend 信任链；容器只读挂载 PEM，Node 进程启动前设置 NODE_EXTRA_CA_CERTS，不关闭证书验证。

## 2. 构建、迁移与源码验证

在依赖已准备好的开发环境、仓库根目录运行：

```bash
pnpm --filter hoppscotch-backend exec prisma generate
pnpm run gen-gql
pnpm --filter hoppscotch-sh-admin run gql-codegen
pnpm --filter @hoppscotch/selfhost-web run gql-codegen
pnpm --filter hoppscotch-backend exec prisma migrate deploy
pnpm --filter hoppscotch-backend run build
pnpm --filter hoppscotch-backend run test --runInBand --coverage=false oidc
pnpm --filter hoppscotch-backend run test --runInBand --coverage=false infra-config.service.spec.ts auth.service.spec.ts redirect-uri.validator.spec.ts
pnpm --filter hoppscotch-backend exec node --test test/oidc/integration.test.mjs test/oidc/provider-compatibility.test.mjs
pnpm --filter hoppscotch-backend run test:e2e --runInBand oidc/
pnpm --filter @hoppscotch/common run test -- Login
pnpm --filter hoppscotch-sh-admin run build
pnpm --filter hoppscotch-sh-admin exec vue-tsc --noEmit
pnpm --filter @hoppscotch/selfhost-web run build
pnpm --filter @hoppscotch/selfhost-web run lint:ts
```

本地 OIDC e2e 必须使用独立数据库。预先导入或在联网开发机准备 `postgres:16-alpine` 后，从根目录执行：

```bash
node packages/hoppscotch-backend/test/oidc/support/prepare-local.mjs
set -a
source packages/hoppscotch-backend/test/oidc/.local/test.env
set +a
pnpm --filter hoppscotch-backend exec prisma migrate deploy
pnpm --filter hoppscotch-backend run build
pnpm --filter hoppscotch-backend run test:e2e --runInBand oidc/
```

harness 只接受 `127.0.0.1:54329/oidc_test` 的测试数据库，会清空其 User/Account/InfraConfig/授权事务；不要将业务连接写入该文件。每个 suite 使用真实 Nest auth/onboarding 路由、真实 PostgreSQL 和 Node 子进程内的真实 openid-client；只有发信及保存后停止进程被测试替身替代。UI 的实际浏览器登录与断网验收仍需单独执行，不能以 REST suite 代替。运行结束可用 `docker stop hoppscotch-oidc-test-db` 停止测试容器。workspace 首次准备还需运行 common gql-codegen 与 kernel build，二者不改变生产代码。

数据库连接和 DATA_ENCRYPTION_KEY 应已配置。代码生成只读本地 schema，不应要求 IdP 连通。新 tests 命名含 oidc；common 去重与验证能力 tests 命名含 Login，便于定向运行。真实库 harness 须启动本地可控 IdP，覆盖错误签名/claims、事务、client auth、UserInfo、密钥轮换及 IdP 禁用后的本地会话边界（FR-015 / SC-006）。记录已有无关 typecheck/build 问题，不将未通过结果写成通过。

上面的 Node 命令覆盖 integration 和 provider-compatibility 两套 suites；`test:e2e ... oidc/` 使用现有 Jest 配置运行该目录下全部 e2e，包含 auth-baseline、onboarding、session-lifecycle、transaction-concurrency、identity-concurrency、upgrade。完整验收不能只运行 session-lifecycle。环境验证使用已有 Node 版本，不把全仓 Node 24 已知失败修复纳入本次范围。

源码调试可分别运行 backend start:dev、selfhost-web dev、sh-admin dev；离线环境使用下节镜像，避免启动安装或生成监听器。

## 3. 离线镜像交付与启动

在构建环境准备包含本次实现的 AIO 和数据库镜像；authentik 的 server/worker/database 等镜像也需按其部署清单预先打包，或使用已存在的内网实例。

```bash
docker build -f prod.Dockerfile --target aio --build-arg HOPP_BUILD_NODE_HEAP_MB=6656 -t hoppscotch-oidc:aio .
docker pull postgres:16-alpine
docker image save -o /tmp/hoppscotch-oidc-images.tar hoppscotch-oidc:aio postgres:16-alpine
```

把镜像包和配置送入内网。离线机执行，HOPP_ROOT 指向该机工作目录：

```bash
export HOPP_ROOT="$PWD"
docker image load -i /tmp/hoppscotch-oidc-images.tar
cat > /tmp/hoppscotch-oidc-offline.yml <<'YAML'
services:
  db:
    image: postgres:16-alpine
    pull_policy: never
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: oidc-local-test
      POSTGRES_DB: hoppscotch
    volumes:
      - oidc-db:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U postgres -d hoppscotch']
      interval: 5s
      retries: 12
  aio:
    image: hoppscotch-oidc:aio
    pull_policy: never
    restart: unless-stopped
    env_file:
      - ${HOPP_ROOT}/.env
    environment:
      DATABASE_URL: postgresql://postgres:oidc-local-test@db:5432/hoppscotch
    ports:
      - '3000:3000'
      - '3100:3100'
      - '3170:3170'
      - '3200:3200'
    depends_on:
      db:
        condition: service_healthy
volumes:
  oidc-db:
YAML
docker compose -f /tmp/hoppscotch-oidc-offline.yml up -d --wait --pull never db
docker compose -f /tmp/hoppscotch-oidc-offline.yml run --rm --no-deps aio pnpm exec prisma migrate deploy
docker compose -f /tmp/hoppscotch-oidc-offline.yml up -d --pull never aio
```

这是测试部署，使用独立新数据库。`.env` 从仓库示例准备，base/backend/admin URL 改为浏览器和容器均可解析的真实内网地址，设置有效的 32 字符 DATA_ENCRYPTION_KEY。示例为 multiport；HTTPS 通过已有内网反向代理终止，保留 X-Forwarded 配置。私有 CA 时给 aio 增加只读证书 volume 和启动环境 NODE_EXTRA_CA_CERTS；公网封禁由测试网络实施。

在 onboarding 中仅选 OIDC；MAILER_SMTP_ENABLE=false、不填写 SMTP、关闭 EMAIL、保持 ALLOW_ANALYTICS_COLLECTION=false。也可按配置契约通过既有受保护配置入口设置。AIO 必须有重启策略，使配置保存后的既有 stopApp 生效。不在离线机运行 npm install、docker build 或 docker pull。

## 4. 配置 authentik

按 [authentik 官方 provider 指南](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/) 创建 Application + OAuth2/OpenID Provider：

1. slug 为 hoppscotch；confidential client，记录 client ID/secret。
2. 默认 per-provider issuer：`https://sso.internal/application/o/hoppscotch/`。保持尾斜杠，注册 Hoppscotch 界面显示的精确 callback。
3. 选择 RSA Signing Key，使 ID token 为 RS256；不选 Encryption Key。
4. scopes 使用 openid/profile/email；email mapping 返回合法内网邮箱。保留默认 false，或测试缺失 verified；不需要为登录设置 SMTP、验证邮件流程或强制 true mapping。
5. 允许 PKCE S256，显式选择/核对 client_secret_basic；再用 post 重跑一次。

从 backend 所在网络确认 metadata；使用信任的 CA，不加跳过验证参数：

```bash
curl -fsS 'https://sso.internal/application/o/hoppscotch/.well-known/openid-configuration' |
  jq '{issuer,authorization_endpoint,token_endpoint,userinfo_endpoint,jwks_uri,id_token_signing_alg_values_supported,token_endpoint_auth_methods_supported,code_challenge_methods_supported}'
curl -fsS 'http://hoppscotch.internal:3170/v1/auth/providers'
```

配置 OIDC_ISSUER、client 凭据、scope 和认证方式；默认 OIDC_DISCOVERY_URL 为空。第二个请求应返回 providers 含且只含一个 OIDC，不能泄漏秘密。

### 4.1 私有 CA 实机端点准备（SC-002）

这一步由 T036 准备、T038 验收，必须针对真实 authentik 完成；本地协议 fixture 的 TLS 结果另行记录。

1. 先记录 `https://auth.ihxq.fun:9999` 的证书链和实际版本。现有入口已使用私有 CA 时可复用；使用公共 CA 时，为独立测试应用准备隔离代理入口，必要时用同版本隔离 authentik 实例。业务入口证书和正常应用配置保持原状。
2. 已提供 `packages/hoppscotch-backend/test/oidc/fixtures/authentik-tls.compose.yml` 和 `authentik-tls.Caddyfile`。准备受 `.gitignore` 保护的 `test/oidc/.local/tls.env`、`ca-root.pem`、私钥和服务端证书，选择内网可解析的测试域名与空闲端口；证书 SAN 必须覆盖该域名。模板应说明 upstream、测试域名/端口及证书挂载值；私钥和真实凭据不入库。
在 `.local/tls.env` 设置以下运行参数（值仅为占位说明，不是已验证部署）：

```dotenv
OIDC_TLS_PROXY_IMAGE=caddy@sha256:<preloaded-pinned-image-digest>
OIDC_TLS_BIND=127.0.0.1:9444
OIDC_HTTP_BIND=127.0.0.1:9080
OIDC_TLS_HOST=oidc-test.internal
OIDC_HTTP_HOST=oidc-test.internal
AUTHENTIK_TEST_UPSTREAM=https://<reachable-authentik-test-entry>
```

另在 `.local/` 放置 `server.pem`、`server-key.pem`、`ca-root.pem`，证书 SAN 必须匹配 OIDC_TLS_HOST 的域名。测试客户端不在本机时使用专用内网绑定地址和相应网络规则；容器 upstream 不能使用指向容器自身的 localhost。代理不配置 access log，不记录 callback query。不要替换业务入口或在证书错误时关闭校验。

3. 验证测试 metadata 中 issuer、authorization/token/JWKS/UserInfo endpoint 全部实际使用该私有 CA 入口，签发 ID token 的 issuer 与配置精确一致。必须真正让 IdP backchannel 经私有 CA 连接，不能只更换 Hoppscotch 自身证书。为 HTTP 测试另准备隔离入口及实际匹配的 issuer，不更改业务端口。
4. 按模板准备 `.local/tls.env` 后，从仓库根目录启动测试入口；代理镜像预先导入内网，禁止运行时 pull：

```bash
docker compose --env-file packages/hoppscotch-backend/test/oidc/.local/tls.env -f packages/hoppscotch-backend/test/oidc/fixtures/authentik-tls.compose.yml up -d --pull never
```

5. 在 backend 启动前只读挂载 `ca-root.pem` 并设置 NODE_EXTRA_CA_CERTS；浏览器用独立测试配置正确导入该 CA。使用新进程和冷 discovery/JWKS 缓存，强制 profile/email 通过 UserInfo 返回，完成完整 admin/app 登录，使所有 IdP 通道均被实际访问。
6. 对照下表执行负面验证，每项从全新的未登录 Hoppscotch 浏览器上下文发起 OIDC，避免已有本地会话被误记为新登录成功。每次改变 Node 信任配置都重启后端并清理连接/发现/密钥缓存；每个 issuer 变体使用独立测试用户或干净测试数据库，避免邮箱冲突干扰 TLS 结果。把版本、入口、CA 指纹/证书有效期、条件与结果写入 validation，不记录私钥/token。

| backend 信任 | 浏览器信任 | 预期 |
|---|---|---|
| 正确私有 CA，主机名匹配 | 正确信任 | discovery、授权、token、JWKS、UserInfo 和本地登录成功 |
| 未配置/移除 CA | 正确信任 | backend TLS 连接失败，无新本地会话 |
| 正确信任 | 未信任 | 浏览器拒绝授权页证书，不能跳过错误继续登录 |
| 正确 CA，但主机名不匹配 | 正确信任 | 主机名校验失败，不能自动关闭证书验证 |

HTTP 隔离入口另测 OIDC_ALLOW_INSECURE_HTTP=false 的拒绝和显式 true 的成功。私有 CA 的上述实机矩阵是 SC-002 必需条件，缺少入口、凭据或证据时任务保持未完成，不将 fixture 成功记成实机通过。

## 5. 浏览器与部署场景

| 场景 | 步骤 | 预期 |
|---|---|---|
| 全新 OIDC-only | 无 SMTP 配置完成 onboarding，用 A 首次登录 admin，再登录 app | 正常会话；首管理员沿现有机制提升；没有验证邮件请求 |
| 邮箱未验证 | A 为 false，B 缺失 verified，分别首次/重复登录 | 均正常；资料不显示已验证，不出现不可用的验证动作；第二用户不自动成为 admin |
| 管理端 Me 字段 | 检查实际 Me 请求及用户状态转换 | 请求含 emailVerified，后端 false/true 原样进入管理端状态，不以硬编码 true 替代 |
| 首次缺邮箱 | 使用测试 IdP 去掉所有来源 email | 401 受控错误，无部分 User/Account；不要求支持无邮箱建号 |
| 冲突/账号边界 | C 用 A/现有 Google 用户的邮箱登录；再尝试旧 provider/magic 自动关联到 OIDC 用户 | 409/受控拒绝；不合并数据或权限；原登录关系仍可用 |
| UserInfo | 关闭 authentik 的 ID token profile claims 包含选项，保留 UserInfo email | 正常建号；email/verified 同源且 subject 匹配 |
| Global issuer | 改 root issuer，OIDC_DISCOVERY_URL 填应用完整 well-known URL | 精确 issuer 匹配时成功；错误 expected issuer 失败 |
| 私有 CA | 完成 4.1 的真实 authentik 测试入口和信任矩阵 | 正确信任全链路成功；未信任/移除/主机名错误失败，实机结果完整记录 |
| 内网 HTTP | HTTP issuer 配置先保持 allow=false，再显式 true | 默认拒绝；显式模式成功，仍验证签名、state、nonce、PKCE |
| 桌面 | 桌面入口打开内网 device-login，选 OIDC，回到 device-login 后确认 | loopback 握手成功，无公网中转，无新的 token URL |
| 子路径 | 用实际 subpath AIO 部署重复 app/admin/desktop | callback 和返回路径保留前缀，allowlist 不放宽 |
| 断网和恢复 | 首次启动即阻断公网，无 JWKS 缓存；再断开/恢复内网 IdP | 内网登录成功；断 IdP 仅 OIDC 失败，恢复后重新发起可成功 |
| 刷新/退出 | 登录后关 IdP，执行已有本地 refresh/logout | 无 SMTP/IdP 请求；本地刷新和清 cookie 正常 |
| IdP 禁用用户 | 保留 A 已有会话，在 authentik 禁用 A，再用独立浏览器上下文发起新 OIDC 登录 | 新登录由 IdP 拒绝；原有效 access 和本地 refresh 继续工作，刷新对 IdP 请求数为零（SC-006） |

抓取浏览器/backend 网络证据，确认无公共代理、头像、CDN 或邮件请求；本地头像和静态资源正常。UI 中可选外部帮助链接不属于登录依赖，不必点击。

### 5.1 IdP 禁用和本地会话验收

1. 用 A 完成一次成功登录，保留浏览器上下文 A；先确认本地受保护请求和 refresh 正常，建立 IdP 请求计数基线。同一用户在测试期间只保留这一组有效 refresh，避免另一次成功登录覆盖现有单一 refresh 哈希。
2. 在 authentik 管理端禁用 A，保持 IdP 可达。在无 Hoppscotch 会话的独立上下文 B 发起新 OIDC 登录，确认 IdP 在授权或 token 阶段实际拒绝，Hoppscotch 不签发新的本地 token。
3. 回到上下文 A，未过期的 access 继续可用；执行已有 `/auth/refresh` 后继续访问。用 backend 网络记录确认 refresh 对 IdP 的请求数为零；此步骤应在 IdP 禁用后重复刷新仍成功。
4. 使用自动化场景提交一份签名/有效期合法但与数据库当前哈希不匹配的 refresh，确认按既有规则拒绝；模拟 access 过期后拒绝旧 access，未过期且哈希匹配的当前 refresh 仍可刷新。按 FR-010 保持现有签发载荷和更新方式，不要求每次签发产生不同 token 值或新增并发单次刷新保证。再断开 IdP，确认该本地路径仍不依赖 IdP。
5. 调用本地 logout 后，确认当前客户端凭据已清除；该接口不清数据库 refresh 哈希，验收不要求其它客户端或复制令牌同时失效。
6. 用隔离的测试用户验证删除本地 User 后，后续受保护请求及刷新按既有规则被拒绝。不要删除唯一管理员。

该策略没有固定的 IdP 禁用后失效窗口，及时刷新可以继续延长本地会话。authentik 实机记录、`test/oidc/integration.test.mjs` 的可控新授权拒绝，以及 `test/oidc/session-lifecycle.e2e-spec.ts` 的本地接口/网络计数共同覆盖 FR-015 / SC-006，不通过等待最初 refresh 到期来推断整体会话一定终止。

## 6. 负面测试与验收记录

本地可控 IdP/harness 必须验证 state 缺失/重复/错误、cookie 缺失或跨浏览器、十分钟过期、并发消费和重放、nonce/PKCE、错误签名/issuer/audience/过期 token、UserInfo subject 不一致、不同邮箱的 claims 交叉拼接、JWKS 轮换、basic/post、不支持的算法及超时；新增 IdP 拒绝新登录但不影响本地会话、零 IdP 刷新请求、当前哈希不匹配的 refresh 拒绝和本地用户删除场景。authentik 实测另覆盖取消授权、多标签页和两副本非粘性回调。

实施完成后将结果记录到 `specs/001-generic-oidc/validation.md`，包含 commit、各镜像版本/digest、命令退出码、网络隔离规则/日志、每场景通过或失败和限制；不记录 secret/cookie/token。该记录属于实现验收产物，本次计划不预填成功结果。


## 配置和恢复补充

OIDC scope 默认 `openid,profile,email`，必须含 `openid`；`email` scope 并非保存前提。认证方式显式选择 `client_secret_basic` 或 `client_secret_post`，不做自动回退。issuer 保留原始尾斜杠；独立 discovery URL 仍须返回完全匹配的 issuer。callback 从 VITE_BACKEND_API_URL 派生并保留子路径，以管理端显示值注册。

OIDC-only 不启用 EMAIL 或 SMTP；合法目录邮箱无需收信或邮件验证。保持 ALLOW_ANALYTICS_COLLECTION=false。私有 CA 通过只读 PEM 和 Node 启动前的 NODE_EXTRA_CA_CERTS 注入；HTTP IdP 只有 OIDC_ALLOW_INSECURE_HTTP=true 才放行。不要设置 NODE_TLS_REJECT_UNAUTHORIZED=0。保存配置沿既有重启机制生效，配置切换拒绝未完成授权事务；已签发本地会话仍按原规则刷新/退出。IdP 退出和跨客户端撤销不属于本地 logout 保证。

JWKS 使用库缓存及 unknown-kid 更新机制；当前锁定 oauth4webapi 3.8.8 的未知 key 刷新受 60 秒冷却约束，测试通过推进测试时钟覆盖，生产不改动库的冷却策略。


## 7. 已执行的 Web 实机验收入口

默认独立应用和 global/post/UserInfo 应用已创建，并限定专用测试组；使用 `.local/live-authentik.json` / `.local/live-authentik-global.json`（0600），不要把 secret 或密码复制进聊天、命令行参数或 Git。应用级 issuer/discovery、版本和实际结果见 [validation.md](validation.md)。测试 JSON 由本地安全配置提供 `issuer`、`discoveryUrl`、`useDiscoveryUrl`、`authMethod`、`clientId`、`clientSecret`、`username`、`password`；可选 `appUrl` / `adminUrl` / `apiUrl` 选择实际 AIO 入口。

已构建 app/admin 后，可运行完整 fixture 浏览器验收：

```bash
export OIDC_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
OIDC_TEST_SECOND_USER=1 pnpm --filter hoppscotch-backend run test:e2e --runInBand oidc/
```

端口 3000/3100/3170 必须空闲；该 harness 会清理专用 oidc_test 数据库。与实际 AIO 并行时，应只暂停测试 ingress，结束后恢复。`OIDC_TEST_SECOND_USER=1` 用真实签名协议和浏览器验证 false/true 状态及第二用户非管理员权限。

对已部署 AIO 运行真实进程/静态资源验收，不启动 Nest 替身：

```bash
export OIDC_LIVE_AUTHENTIK_FILE="$PWD/packages/hoppscotch-backend/test/oidc/.local/live-authentik-subpath.json"
node packages/hoppscotch-backend/test/oidc/support/external-browser.mjs
# 已完成 onboarding 的实例：重跑 Web 登录和管理端设置/实际重启验收
OIDC_SKIP_ONBOARDING=1 OIDC_TEST_SETTINGS=1 node packages/hoppscotch-backend/test/oidc/support/external-browser.mjs
```

该命令只用于独立测试部署。设置测试临时启用一个从不登录的 dummy Google 配置以满足既有“至少一个 provider”规则，随后恢复为仅 OIDC；不修改共享 authentik 业务配置。首次管理端 setup 须关闭 analytics 和 newsletter，再继续至 dashboard。

严格出口隔离拓扑见 `packages/hoppscotch-backend/test/oidc/fixtures/offline.compose.yml`。准备独立随机密码的 `.local/aio-postgres.env`、从 `.env.example` 修改而来的 `.local/aio.env`；其数据库地址应为网络别名 `oidc-db`，数据库 `oidc_aio`，32 字符 DATA_ENCRYPTION_KEY，SMTP/analytics=false。将 Node 24 gateway 镜像也加入导出包；AIO/数据库只接入 internal 网络。IdP relay 的 OIDC_RELAY_ADDRESS 必须是预先核实的 authentik IP，仅固定转发 9999，不接受任意目标。入站 gateway 仅转发 app/admin/API 端口。

```bash
docker image save -o /tmp/hoppscotch-oidc-images.tar hoppscotch-oidc:validation postgres:16-alpine node:24-bookworm
docker image load -i /tmp/hoppscotch-oidc-images.tar
# 事先设置 OIDC_RELAY_ADDRESS；该值不是 secret
export OIDC_OFFLINE_COMPOSE=packages/hoppscotch-backend/test/oidc/fixtures/offline.compose.yml
docker compose -p oidc-offline -f "$OIDC_OFFLINE_COMPOSE" up -d --pull never db idp-relay ingress
docker compose -p oidc-offline -f "$OIDC_OFFLINE_COMPOSE" run --rm --no-deps aio pnpm exec prisma migrate deploy
docker compose -p oidc-offline -f "$OIDC_OFFLINE_COMPOSE" up -d --pull never aio
```

multiport 使用 app:3000/admin:3100/API:3170；子路径模式设置 ENABLE_SUBPATH_BASED_ACCESS=true、HOPP_ALTERNATE_PORT=3000，admin URL 为 `http://localhost:3000/admin`，API 为 `http://localhost:3000/backend/v1`，GraphQL/WS 相应使用 `/backend/graphql`，并将 admin 完整入口加入 WHITELISTED_ORIGINS。在独立 IdP client 注册界面派生的精确 callback，不使用 wildcard。

构建参数 HOPP_BUILD_NODE_HEAP_MB 默认仍为 8192；本机 Docker VM 验收用 6656 成功。运行时不依赖该参数，也不在离线机安装依赖。测试辅助入口/控制接口只存在于 test/oidc，生产 backend 不增加控制 API。
