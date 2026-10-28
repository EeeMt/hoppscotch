# Phase 0 Research: 通用 OIDC / authentik

调研日期：2026-10-27。研究覆盖上游 PR、当前仓库、协议和依赖。未运行 authentik 实机测试；本文给出设计依据，验收由 [quickstart.md](quickstart.md) 定义。用户最终要求为**有邮箱资料即可，不要求邮件验证、不依赖 SMTP，运行可无互联网**。

## 1. 上游实现参考

| 来源 | 查询时状态 | 吸收内容 | 不直接沿用的部分 |
|---|---|---|---|
| [PR #3266](https://github.com/hoppscotch/hoppscotch/pull/3266) | closed / unmerged | 通用 OIDC 标识、配置及登录入口 | 旧 passport-openidconnect、手填多个 endpoint、先按邮箱查找并关联、默认 scope 不保证 email |
| [PR #6718](https://github.com/hoppscotch/hoppscotch/pull/6718) | closed / unmerged | lazy discovery、失败重试、PKCE、nonce、UserInfo subject 检查 | Keycloak 专用命名、openid-client 5.7.1 API、邮箱自动关联、单 cookie 覆盖并发事务 |
| [PR #6702](https://github.com/hoppscotch/hoppscotch/pull/6702) | closed / unmerged | 通用 issuer 配置及独立失败处理 | 152 文件混入品牌/GraphQL 升级、issuer 校验与恢复不足，不能整体移植 |
| [PR #3914](https://github.com/hoppscotch/hoppscotch/pull/3914) | merged | `additionalLoginItems` 和 OIDC 按钮扩展机制 | 只作为共享 UI 接入依据 |

**Decision**: 以当前代码为基础重新集成，不 cherry-pick 整个 PR。

**Rationale**: #3266 的关闭与当时企业版路线有关，[维护者说明](https://github.com/hoppscotch/hoppscotch/pull/3266#issuecomment-1984106576) 不代表社区后端已实现。未找到 authentik 的实测证据。#6718 的 [review](https://github.com/hoppscotch/hoppscotch/pull/6718#discussion_r4268581934) 也指出回调测试不足。

**Alternatives considered**: 原样采用厂商专用 strategy；整体移植带无关架构变化的 PR。均拒绝。

## 2. 客户端库与运行时

**Decision**: 新增 `openid-client` 6.8.8 并精确锁定依赖，使用窄的 client adapter；后端继续 CommonJS。用户对 Node 版本无额外诉求，沿用现有 CI Node 22 和生产 Docker Node 24，不新增版本升级或全仓 CI 矩阵目标；记录实际运行版本并验证真实库加载。直接 require(esm) 互操作路径采用满足库要求的现有运行时（Node 22.12+ 或当前生产 Node 24）。

**Rationale**: 当前后端 TS 5.9.3、NestJS 11.2.1、Prisma 7.9.1，`tsconfig.json` 为 CommonJS；官方 v6 支持在相应 Node 版本中 `require(esm)`，无需迁移整个后端。来源：[README](https://github.com/panva/openid-client#supported-versions)、[package.json](https://github.com/panva/openid-client/blob/main/package.json)。

**Alternatives considered**: v5 的 `Issuer.discover` / `Client.callback` 虽接近 #6718，但不作为新实现基础；自行验证 JWT 或全仓迁移 ESM 均不必要。

单元测试 mock adapter，另用 Node 原生集成 harness 加载编译后的真实 adapter 和本地 OIDC fixture，验证 CommonJS + ESM 加载及完整协议。Jest mock 通过不能代替运行时验证；若选 ESM Jest 集成，必须独立配置并按 [Jest 官方要求](https://jestjs.io/docs/ecmascript-modules) 启动。

## 3. Discovery、签名与 claims

**Decision**: `OIDC_ISSUER` 是 expected issuer，保留尾斜杠；默认标准 discovery，可选 `OIDC_DISCOVERY_URL`。两种路径均精确检查 metadata issuer。显式启用 `enableNonRepudiationChecks`，首版仅接受 RS256 和 JWKS，拒绝 HS256 / JWE。

**Rationale**: v6 授权码处理可依赖 TLS，不应假设已经验证 JWS；独立 well-known URL 又会关闭自动 expected issuer 检查，必须补上。来源：[签名验证开关](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md)、[discovery API](https://github.com/panva/openid-client/blob/main/docs/functions/discovery.md)。

**Alternatives considered**: 手填所有 endpoint；仅 decode token；接受任意 metadata issuer。均不满足可信身份要求。

授权码流程明确传入 expected state、nonce、PKCE verifier，要求 ID token；标准 claims 按 [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html) 检查。UserInfo 通过 [fetchUserInfo](https://github.com/panva/openid-client/blob/main/docs/functions/fetchUserInfo.md) 校验 subject；邮箱和它的 verified 标记必须取自同一份 claims，不能把另一地址的标记拼接过来。仅缺邮箱验证状态不会触发额外 UserInfo 请求；需要补足建号邮箱或请求的 profile 时才读取。

## 4. authentik 互操作

**Decision**: 默认应用级 issuer 是主验收；global issuer 通过独立 discovery URL 通用配置支持。confidential client，显式 basic 或 post，注册准确 callback，选择 RSA Signing Key，不选择 Encryption Key。

**Rationale**: 应用级 issuer 形如 `https://sso.internal/application/o/hoppscotch/`；global issuer 改成站点根 URL，但 discovery 仍在应用路径下。未选 signing key 会使用对称签名。来源：[authentik OAuth2 provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)、[client authentication](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/dynamic-client-registration/#client-authentication-methods)。

**Alternatives considered**: 硬编码 authentik 路径/厂商判断；只支持 root issuer；把厂商名称当 provider key。均拒绝。

authentik 默认 `email_verified=false`，有合法 email 的本地用户仍可建号和登录，**无需配置验证邮件流，也无需写死 true 的 scope mapping**。若运营方已有真实验证状态，可按 [邮箱属性指南](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/verify-email-address/) 提供；它仅影响资料状态，不影响 OIDC 准入。

## 5. 邮箱、账号边界与旧登录方式

**Decision**: 优先查 `(issuer, sub)`；首次建号要求合法邮箱，但允许 false/缺失 verified。邮箱被占用即返回冲突，不自动关联，也不退化为无邮箱建号。重复身份按原 userId 登录，不自动修改邮箱。

**Rationale**: 满足用户最终收窄的范围；当前 User.email 唯一，现有 SSO 以邮箱查人后自动关联，直接沿用会把未验证邮箱当成接管凭据。

**Alternatives considered**: 要求 verified=true（不满足无验证邮件要求）；无邮箱/占位邮箱建号（用户明确不要求）；按 verified email 自动关联（增加账号合并信任边界）。均不采用。

还需防止**反向关联**：旧 Google/GitHub/Microsoft 或 magic-link 不能因邮箱相同而首次挂到 OIDC 创建的账号；共用受控检查，保留纯既有账号之间原行为。否则“OIDC 不自动关联”仍会被旧登录入口绕过。first-admin bootstrap 沿用 `verifyAdmin`，不消费 IdP roles/groups。

新增本地 `User.emailVerified` 布尔资料状态；旧行迁移保留原有前端“已验证”的展示假设，新 OIDC 用户严格记录 claim 的布尔 true，否则 false。自托管不提供邮件验证动作，未验证状态不限制请求、团队权限或管理员身份；新增可选平台能力关闭验证按钮，云端维持原行为。

## 6. 私密、一次性的登录事务

**Decision**: PostgreSQL 新增短期 `OIDCLoginTransaction`，state 和浏览器绑定只存哈希，verifier/nonce/返回上下文使用既有加密工具保存；十分钟 TTL、原子消费、按事务区分 HttpOnly cookie、定时清理。

**Rationale**: 现有 `StatelessStateStore` 把 ctx 放入签名但未加密的 URL；不能放 PKCE verifier。共享数据库满足多副本且不新增 Redis 依赖。

**Alternatives considered**: 内存 session（多副本失败）；签名 state（泄漏 verifier）；单 context cookie（并发覆盖）；仅加密 cookie（难提供服务端原子消费）。

## 7. 内网、无 SMTP 与 HTTP

**Decision**: OIDC-only onboarding 可关闭 EMAIL 和 MAILER；运行只依赖内网服务；保留 `ALLOW_ANALYTICS_COLLECTION=false`，忽略 OIDC 的远程 picture 以使用本地头像。镜像/依赖在构建环境准备，离线导入。

**Rationale**: 现有 SMTP 模块和 onboarding 已按 mailer 开关分支，web/admin 使用本地 fontsource。公共代理与外链不作为登录依赖。

**Alternatives considered**: 强制 SMTP；运行时下载依赖；用公网 OAuth 作为初始化入口。均不采用。

私有 CA 通过进程启动前的 `NODE_EXTRA_CA_CERTS` 注入并挂载 PEM，浏览器另行信任；不是在 Nest 运行后设置变量。来源：[Node 官方 CLI](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)。纯 HTTP 内网由 `OIDC_ALLOW_INSECURE_HTTP=false` 的显式配置控制，仅向该 OIDC configuration 的 discovery `execute` 添加 [allowInsecureRequests](https://github.com/panva/openid-client/blob/main/docs/functions/allowInsecureRequests.md)，不关闭 HTTPS 证书验证。

用户明确 SC-002 必须覆盖私有 CA。验收优先使用 `.13` 上的 `https://auth.ihxq.fun:9999`；其证书若为公共 CA，则给独立测试应用准备私有 CA 反向代理入口，或使用同版本隔离 authentik 实例，避免更改正常业务入口。测试必须确认实际 issuer 和所有 IdP 端点使用私有 CA 域名，并完成受信任全链路登录以及未信任/移除 CA 后的失败。fixture TLS 结果单独记录，不能代替 authentik 实机证据；证书/私钥及运行配置不入库。HTTP 也通过独立测试入口覆盖。

## 8. UI、桌面与配置生命周期

**Decision**: web 使用现有 `additionalLoginItems`，公开列表固定 `OIDC`，修复裸 OIDC 的重复按钮。desktop 使用已有 customLoginSelectorUI → 内网 `/device-login` → loopback 握手，重点保证 OIDC 外跳后恢复该页面。

**Rationale**: 不需要新增必需的 `AuthPlatformDef.signInUserWithOIDC`；当前 desktop 主入口不是旧的 `redirect_uri=desktop` 字符串。web 在 sessionStorage 保存经过验证的 device-login 本地返回上下文，OIDC 回到 app base 后只恢复固定 device-login 路由，不扩展 backend 的任意 redirect 权限。

**Alternatives considered**: 自建公网中转；将回调任意路径加入 allowlist；替换桌面协议。均拒绝。

配置复用 InfraConfig、受保护的 admin GraphQL 和 onboarding，保存后沿现有 stopApp/restart 生效。discovery 按需加载并缓存，失败五秒后可重试，不保留永久 rejected promise，不阻塞 backend 启动。配置指纹变化使未完成事务失效。

## 9. IdP 禁用与本地会话生命周期（澄清 A）

**Decision**: 按 [spec.md](spec.md) FR-015 / SC-006，IdP 禁用用户只阻止后续 OIDC 登录；已有访问令牌、本地刷新和退出继续沿用 Hoppscotch 规则，刷新时对 IdP 的请求数为零。

**Rationale**: 用户已选择 A。源码中 `packages/hoppscotch-backend/src/auth/auth.service.ts` 的 generateAuthTokens / refreshAuthTokens 签发本地 JWT，校验并轮换 `User.refreshToken` 哈希；`src/auth/strategies/jwt.strategy.ts` 和 `rt-jwt.strategy.ts` 检查本地用户存在性，不查询外部身份状态。IdP 故障与禁用事件均不进入本地刷新路径，符合内网独立运行要求。

**Alternatives considered**: 访问令牌到期后强制重新 OIDC 登录；禁用后五分钟内主动撤销。用户未选择这两种策略，本轮沿用已有本地机制。

当前实现没有绝对会话最长时限，持续及时刷新可以继续延长本地会话；原 IdP token 或最初本地 refresh token 的过期时间均不是会话必然终止时间。`src/auth/auth.controller.ts` 的 logout 只清当前响应中的 access/refresh cookie，保留数据库 refresh 哈希；它不提供跨客户端撤销。删除本地用户后，JWT / refresh 的用户查找会拒绝后续请求。上述均为源码复核结论，不新增逐用户会话撤销服务或 IdP 轮询。

用户随后明确要求 token 轮换保持现有设计一致（FR-010）。因此 OIDC 完整复用当前签发载荷、JWT/用户/Argon2 哈希校验和每用户单一哈希覆盖流程；本次不添加 jti、token 值每次唯一性或并发单次刷新保证。分析中关于“旧 refresh 必定立即失效”的问题以修订过强的验收措辞解决，不作为 OIDC 基础认证重构任务；验证与当前哈希不匹配时拒绝、有效时按既有规则刷新即可。

新的 OIDC 登录由 IdP 在授权或 token 阶段执行用户禁用策略；客户端正确处理其拒绝响应，不读取厂商专用的 active 属性。自动化测试用可控 IdP 显式拒绝新授权，同时验证已有 access、既有本地刷新和零 IdP 网络请求；实机再用 authentik 禁用本地用户验证。同账号已有会话测试期间不发起另一次成功登录，以免现有单一 refresh 哈希被替换而混淆结果。

## 10. 研究结论

协议、库/运行时、邮箱策略、内网部署、事务、配置和本地会话生命周期均已有决策，无未决澄清项。本轮复用此前上游调研，追加当前代码的会话生命周期复核和用户已确认的澄清 A；没有新增技术选型。constitution 仍为模板，无可执行的已批准项目原则；未将示例视为规则。实现阶段须完成真实库集成、authentik 实测、断网/无 SMTP 和 SC-006 验收后才能声明兼容。
