# OIDC Configuration Contract

## 配置字段

| Key | 默认值 | 生效/验证规则 |
|---|---|---|
| `VITE_ALLOWED_AUTH_PROVIDERS` | 沿用既有值 | 新增 `OIDC`；允许只有 OIDC，不要求 EMAIL |
| `OIDC_ISSUER` | 空 | 启用 OIDC 时必填，绝对 URL，禁止 userinfo、query、fragment；完整保留路径和尾斜杠 |
| `OIDC_DISCOVERY_URL` | 空 | 可选完整 well-known URL；为空使用标准 issuer discovery；不改变 expected issuer |
| `OIDC_CLIENT_ID` | 空 | 启用时必填 |
| `OIDC_CLIENT_SECRET` | 空 | 启用时必填，InfraConfig 加密保存，日志及公开接口不返回 |
| `OIDC_CALLBACK_URL` | 派生 | `${VITE_BACKEND_API_URL 去末尾斜杠}/auth/oidc/callback`；界面只读，保留部署子路径 |
| `OIDC_SCOPE` | `openid,profile,email` | 逗号分隔并去空白/重复；必须含 openid；对外授权参数转换为以空格分隔 |
| `OIDC_TOKEN_ENDPOINT_AUTH_METHOD` | `client_secret_basic` | 仅 basic/post 两种，显式匹配 discovery 宣告；字段省略按协议默认 basic，不自动试探其它认证方式 |
| `OIDC_ALLOW_INSECURE_HTTP` | `false` | 严格布尔字符串；true 仅放行该 OIDC configuration 的 HTTP，不关闭 HTTPS 验证 |

开启时对**更新后的完整配置**校验，不能只检查本次提交字段。关闭状态允许凭据为空，仍校验提供的非空 URL/枚举。配置默认及升级补齐复用现有 InfraConfig 机制；后台枚举、required keys、isServiceConfigured、派生 callback、DTO 和 UI 映射必须一致。

不新增 require-verified-email 开关，也不要求 email scope 才能保存配置；但首次建号最终必须取得合法邮箱，否则返回明确错误。SMTP、MAILER、EMAIL 的开关和 OIDC 相互独立。

## 管理与初始化界面

- 复用受 admin guard 保护的 `infraConfigs`、`updateInfraConfigs`、`enableAndDisableSSO`；保持既有 onboarding 的恢复 token/权限边界，不新开匿名配置接口。
- `InfraConfigEnum` 和 onboarding DTO 增加上述字段；secret 仅走既有受保护秘密通道，不进入 provider 列表或前端构建变量。
- 保存沿既有流程重启生效；界面显示 callback URL 及需重启的结果，不承诺热更新。
- OIDC-only 初始化时，`MAILER_SMTP_ENABLE=false` 且所有 SMTP 字段可以为空；不得隐藏地启用 EMAIL 或发送欢迎/验证邮件。
- 普通用户看到一个“使用 OpenID Connect 登录”按钮；文案不写死 authentik/Keycloak。未验证邮箱用户可正常使用系统，自托管平台不显示无实现的邮件验证动作。
- 新增可选平台能力 `supportsEmailVerification?: boolean`：未设置保留现有云端表现；自托管 web/desktop 设置 false。`emailVerified` 读取后端资料状态，不作为鉴权条件。

## 本地会话策略

按 [spec.md](../spec.md) FR-015 / SC-006 复用 `ACCESS_TOKEN_VALIDITY`、`REFRESH_TOKEN_VALIDITY`、本地 JWT secret 和 refresh 轮换规则。IdP 禁用用户后，已有会话仍按这些本地规则运行；刷新不查询 IdP。持续刷新可以延长会话，首版不提供 IdP 禁用后的固定自动失效时间。

FR-010 进一步要求签发载荷、每用户单一 refresh 哈希、JWT/用户/哈希校验及成功后的哈希覆盖方式沿用现状，不新增 token 唯一性或并发轮换策略配置。

此策略没有新增配置开关；后台停用 OIDC 控制新登录入口和未完成的回调，不撤销已签发的本地会话。当前 logout 清除客户端凭据，按用户/跨客户端主动撤销仍不在本次范围。

## 网络与启动配置

| 项目 | 契约 |
|---|---|
| 内网 IdP | issuer/discovery/authorize/token/JWKS/UserInfo 全部可在内网解析和访问；允许私网地址，不做公网地址假设 |
| HTTPS | 默认要求，正常校验证书和主机名；所有已发现 endpoint 同样验证 URL scheme |
| 私有 CA | 容器只读挂载 PEM，进程启动前注入 `NODE_EXTRA_CA_CERTS`，浏览器单独信任 |
| HTTP | true 时向单个 configuration 添加 allowInsecureRequests；应用/callback HTTP cookie 沿实际部署协议处理 |
| 外部请求 | 登录不调用公共 OAuth、代理、CDN、avatar 或邮件；保持 `ALLOW_ANALYTICS_COLLECTION=false` |
| 时钟 | 内网 NTP/一致时钟；JWT 标准有效期校验仍执行 |

不接受 `NODE_TLS_REJECT_UNAUTHORIZED=0`。不从浏览器参数接受 issuer、discovery、token endpoint 或 CA 配置。metadata 中的 HTTPS endpoint 可以使用不同内网域名，不硬编码同 host；运维 egress policy 定义允许目标。禁止自动跟随向 HTTP 的降级重定向（显式 HTTP 模式除外）。

SC-002 要求真实 authentik 私有 CA 入口的端到端证据：浏览器和 backend 均信任时，discovery/授权/token/JWKS/UserInfo 及本地登录成功；backend 未信任/移除 CA 或主机名不匹配时连接失败，浏览器未信任时不得跳过证书错误继续。改变 Node 信任文件后用新进程和冷缓存验证。若既有入口使用公共 CA，须准备隔离测试入口，不能以 fixture 或仅给 Hoppscotch 自身 HTTPS 配证书代替该验收。

## 活动配置缓存

discovery 按需执行；同配置并发请求共享进行中的加载。成功缓存十五分钟，失败仅 OIDC 返回受控 503，五秒后可重试。配置变更清理缓存，并拒绝旧事务。每次 discovery 均检查 issuer、RS256/JWKS、认证方式、授权码能力和可用 S256（存在声明时）；不能忽略不支持的声明。

每个 IdP 网络操作五秒超时，callback 总预算十五秒；不因缺少可选邮箱 verified 标记产生网络请求。JWKS 缓存和 unknown-kid 刷新由库处理，测试验证密钥轮换，不自行构造 JWT 签名器。
