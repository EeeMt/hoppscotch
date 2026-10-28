# Feature Specification: 通用 OIDC 自托管登录

> 实施范围修订（2026-10-27）：用户明确要求“不需要构建桌面端，支撑 web 使用场景就行了”。本次交付及完成门槛以 Web、管理端、multiport/subpath AIO 为准。下文原生 Desktop 构建/实机验收要求不再适用于本次；现有 device-login 行为保留，已完成的浏览器恢复及真实 loopback 证据单独记录。FR-009、SC-005 按此 Web 范围验收。


**Feature Branch**: `feature/oidc`

**Created**: 2026-10-27

**Status**: Implemented and validated（Web 范围；验收记录见 [validation.md](validation.md)）

**Input**: 开发通用 OIDC，参考 GitHub 相关 PR，重点验证 authentik；内网自托管兼容无互联网、无 SMTP、邮件无法验证。用户随后收窄范围：不必支持完全无邮箱，OIDC 可以要求返回邮箱。

## Clarifications

### Session 2026-10-27

- Q: 在 authentik 中禁用用户后，Hoppscotch 已建立的登录会话应如何处理? → A: 仅阻止后续 OIDC 登录；已有会话按 Hoppscotch 本地规则失效，刷新时不查询 IdP。

## User Scenarios & Testing

### User Story 1 - 内网无邮件的首次部署与登录 (Priority: P1)

管理员仅配置内网 OIDC 服务即可完成实例初始化；用户拥有 IdP 提供的邮箱资料，但无需公网账号、可收信邮箱、验证码或邮件链接即可登录。

**Independent Test**: 全新数据库，禁用 SMTP/EMAIL 登录，封禁公网出口，仅开放内网 IdP、Hoppscotch 和数据库；通过 authentik 本地用户完成 onboarding、首位管理员登录和应用登录。

**Acceptance Scenarios**:

1. **Given** 仅启用 OIDC、无 SMTP，**When** 保存合法配置并登录，**Then** 无需填写邮件设置或验证邮箱即可建立本地会话。
2. **Given** token 有合法 `email`，但 `email_verified=false` 或缺失，**When** 有效 OIDC 身份登录，**Then** 正常创建和访问账号，不触发邮件验证。
3. **Given** 内网域名使用私有 CA，**When** 后端和浏览器信任该 CA，**Then** discovery、授权、token、JWKS、UserInfo 全流程成功，无需公网服务。
4. **Given** 纯 HTTP 内网部署，**When** 管理员显式启用该 OIDC 配置的 HTTP 选项，**Then** 可登录；默认配置拒绝 HTTP IdP。

### User Story 2 - 通用协议及 authentik 兼容 (Priority: P1)

使用标准 issuer/discovery 配置接入 OIDC 服务，不以 authentik 或 Keycloak 名称绑定实现。

**Independent Test**: authentik 实机加本地可控 OIDC 测试服务，分别验证应用级 issuer、可选独立 discovery 地址、UserInfo 回退和 client authentication。

**Acceptance Scenarios**:

1. **Given** authentik 默认应用级 issuer 和 RSA signing key，**When** 从应用或管理端发起登录，**Then** 完成授权码流程并返回原入口。
2. **Given** profile 只在 UserInfo 返回，**When** ID token 验证成功且 UserInfo subject 一致，**Then** 正常登录。
3. **Given** 配置独立 discovery URL，**When** metadata issuer 不等于配置 issuer，**Then** 拒绝登录。
4. **Given** 不同 issuer 返回相同 `sub`，**When** 分别登录，**Then** 不会识别为同一身份。

### User Story 3 - 稳定身份与安全失败 (Priority: P1)

身份依据 `(issuer, sub)`；邮箱是建号所需资料，不作为自动关联账号的凭据。协议失败不产生本地登录凭证，也不合并已有账户。

**Independent Test**: 使用可控 IdP 验证未验证邮箱、邮箱冲突、并发回调以及错误 token。

**Acceptance Scenarios**:

1. **Given** 已有关联身份，**When** 邮箱缺失、改变或验证状态改变，**Then** 仍访问原账号，不覆盖本地邮箱。
2. **Given** 新身份的邮箱合法但未验证，**When** 邮箱未被占用，**Then** 正常建号；缺失或非法邮箱时给出受控错误。
3. **Given** 新身份的邮箱已被占用，**When** 登录，**Then** 明确拒绝关联，不创建部分账号，不继承原账号数据或管理员权限，不论邮箱验证状态如何。
4. **Given** state、nonce、PKCE、签名、issuer、audience、有效期或 UserInfo subject 错误，**When** 回调，**Then** 登录失败且不签发本地凭证。
5. **Given** 用户已登录且本地会话仍有效，**When** 其账号在 IdP 中被禁用，**Then** 后续 OIDC 登录被拒绝；已有会话仍可按本地规则访问和刷新，刷新不查询 IdP，不因该禁用事件自动撤销。

### User Story 4 - 现有实例增量接入 (Priority: P2)

管理员可配置、启禁 OIDC，已有 Google/GitHub/Microsoft/EMAIL 登录维持其行为；自托管桌面端复用现有登录桥接。

**Independent Test**: 旧数据库升级后新增 OIDC，验证配置、单一登录按钮、重启生效、禁用行为、既有登录回归和桌面端回跳。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供一个通用 `OIDC` provider，首版每个实例支持一份活动配置。
- **FR-002**: 系统 MUST 支持 issuer discovery、可选独立 discovery URL、confidential client、`client_secret_basic` / `client_secret_post`；scope 必须包含 `openid`，`email` 不得为必需 scope。
- **FR-003**: 系统 MUST 使用 Authorization Code + PKCE S256 + state + nonce，验证 ID token 非对称签名和标准 claims；首版支持 RS256。
- **FR-004**: 系统 MUST 绑定发起登录的浏览器，事务十分钟过期并原子单次消费，支持并行标签页及多后端副本。
- **FR-005**: 系统 MUST 以精确 `(issuer, sub)` 查找身份；禁止按 email/username 自动关联 OIDC 与其他账号。新身份事务性建号；既有登录也不得反向自动关联到 OIDC 账号。
- **FR-006**: 系统 MUST 允许有合法邮箱但 `email_verified=false` 或缺失的身份首次登录；邮箱冲突时受控拒绝。既有身份不依赖重新验证邮箱，不自动覆盖本地邮箱。
- **FR-007**: 系统 MUST 在无 SMTP、无公网、仅内网 IdP 可达时完成 onboarding、管理员/应用登录、本地 token 刷新和退出；不要求外部验证码、邮件验证、公共 discovery/JWKS 或运行时下载资源。
- **FR-008**: 系统 MUST 支持私有 CA 信任链；HTTP IdP 仅在显式开启配置后允许，证书校验不可通过全局开关绕过。
- **FR-009**: 系统 MUST 覆盖管理端配置及 onboarding、管理端和应用登录入口、共享 UI、国际化及自托管桌面端现有桥接；未验证邮箱不得阻断功能或引导用户调用不存在的验证服务，也不得显示为已验证。
- **FR-010**: 系统 MUST 复用现有本地 JWT/cookie、权限及管理员初始化机制；token 签发载荷、有效期配置、每用户单一 refresh 哈希及刷新校验/更新规则保持一致，本次不新增更强的令牌唯一性或并发轮换保证。不将 IdP roles/groups 自动映射为管理员权限。
- **FR-011**: 系统 MUST 保护 client secret、PKCE verifier 和 token；公开列表仅暴露 provider 标识，OIDC provider token 不长期保存。
- **FR-012**: 系统 MUST 保留现有登录方式；IdP 暂不可达时仅 OIDC 请求失败，恢复后允许重试，不能阻断后端启动或要求重启才能恢复。
- **FR-013**: 系统 MUST 提供 authentik 的真实端到端验收记录，以及独立可控 IdP 的负面协议测试；PR 描述的兼容性声明不算验收证据。
- **FR-014**: 系统 MUST 只返回可信固定目标；应用/管理端回跳遵守现有 allowlist，桌面端沿用既有握手，禁止将 provider token 或本地 token 放入新建的回跳 URL。
- **FR-015**: IdP 禁用用户后，系统 MUST 拒绝该用户后续的 OIDC 登录；已建立的 Hoppscotch 会话 MUST 继续遵循本地令牌有效期、刷新和撤销规则。本地刷新不查询 IdP，首版不因 IdP 禁用事件自动撤销已有会话，也不承诺其在固定时间内失效。

### Key Entities

- **OIDC 配置**: issuer、可选 discovery URL、client 凭据、scope、认证方式、派生 callback、HTTP 显式选项。
- **OIDC 登录事务**: 一次性 state、浏览器绑定、私密协议上下文、有效期。
- **OIDC 身份**: 外部 issuer 和 subject 与本地 User 的稳定关联，复用 Account。
- **User**: 带邮箱资料及验证状态的本地账号、显示资料与现有权限；数据库既有 nullable email 形状保持兼容，本次不新增无邮箱登录能力。

## Success Criteria

- **SC-001**: 全新实例在公网出口被阻断、SMTP 未配置时完成 OIDC-only 初始化、管理员与应用登录、刷新及退出；不发生必需的公网请求或邮件发送。
- **SC-002**: authentik 的 `email_verified=false` / 缺失、仅 UserInfo profile、私有 CA、显式 HTTP 测试全部通过；私有 CA 必须完成真实 authentik 端到端验证，浏览器与 backend 均正确受信任时登录成功，未信任或移除 CA 后连接失败且不能绕过证书校验。默认 HTTPS 路径和 global issuer + 独立 discovery 路径均有记录。
- **SC-003**: 所列错误协议输入、跨浏览器回调和重放全部被拒绝；并发首次登录同身份只产生一个 User/Account。
- **SC-004**: 同一身份重复登录不新增账号；不同 issuer 的相同 subject、不同 subject 的同邮箱不会互相接管。
- **SC-005**: 旧数据库升级、四种既有登录方式、管理端权限、桌面端桥接、子路径部署均有回归结果；裸 `OIDC` 只显示一个按钮。
- **SC-006**: 在 IdP 禁用已登录用户后，新的 OIDC 登录失败；仍满足本地规则的已有访问令牌和刷新请求继续成功，刷新过程中对 IdP 的请求数为零。既有本地令牌过期、退出和撤销行为保持不变。

## Assumptions & Scope

- “无互联网”指部署与运行环境不需要公网；构建在联网构建环境或内网依赖镜像完成，通过离线镜像包导入。交付指南必须包含镜像导入与禁止 pull 的启动方式，不要求断网机器从公共 npm registry 构建。
- IdP、Hoppscotch、数据库、内网 DNS 和准确时间可达；IdP 使用无需外部邮件的本地认证方式。
- 不扩展为完整的离线邮件替代系统。邮件邀请/通知不作为登录前置条件；现有可用的站内用户/团队管理沿用原接口。
- 首版不包含账号合并/迁移向导、多 provider UI、角色同步、SCIM、SAML、IdP refresh token 存储、RP-initiated logout、IdP 禁用事件触发的已有本地会话撤销、HS256 或加密 ID token。
- 不支持完全没有邮箱的首次建号；邮箱允许使用内网目录中的合法地址，不要求该地址能收信。不新增空邮箱用户的管理端/团队功能改造。
- constitution 文件仍为未填写模板，本规范不将示例条款视为已批准规则。
