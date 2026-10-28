# Implementation Plan: 通用 OIDC 自托管登录

> 实施范围修订（2026-10-27）：用户明确要求“不需要构建桌面端，支撑 web 使用场景就行了”。本次交付及完成门槛以 Web、管理端、multiport/subpath AIO 为准。下文原生 Desktop 构建/实机验收要求不再适用于本次；现有 device-login 行为保留，已完成的浏览器恢复及真实 loopback 证据单独记录。FR-009、SC-005 按此 Web 范围验收。


**Branch**: `feature/oidc` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-generic-oidc/spec.md`，包含 2026-10-27 的澄清 A（FR-015 / SC-006）。最终范围：有邮箱资料，不要求验证邮件，无 SMTP、无公网仍可运行；IdP 禁用只阻止后续 OIDC 登录，已有会话沿用本地机制。完全无邮箱首次建号不在范围内。

## Summary

在自托管后端增加一个通用 OIDC provider，使用 `openid-client` 6、issuer discovery、Authorization Code + PKCE S256 + state + nonce，并显式验证 RS256 签名。优先按 `(issuer, sub)` 绑定本地账号，允许 `email_verified=false` 或缺失，不发送验证邮件，不按邮箱自动合并账号。

复用 InfraConfig、管理端 onboarding/settings、现有本地 JWT/权限、共享登录扩展和桌面 device-login。authentik 默认应用级 issuer、global issuer、私有 CA 和显式 HTTP 内网模式均进入验收。GitHub PR 只作为参考，取舍见 [research.md](research.md)。

本轮将用户已确认的会话边界同步到研究、数据模型、配置/认证契约和验收指南：本地刷新不查询 IdP，及时刷新可持续延长会话；IdP 禁用不触发已有本地会话的主动撤销。

## Technical Context

**Language/Version**: TypeScript 5.9.3；backend CommonJS / ES2023；沿用现有 CI Node 22 和生产镜像 Node 24，记录并验证实际运行版本；pnpm 10.34.5。用户对 Node 版本无额外诉求，本功能不升级 Node、不扩大全仓 CI 矩阵。直接 require(esm) 的 adapter 路径须满足库兼容要求（Node 22.12+ 或当前生产 Node 24），通过真实库加载验证。

**Primary Dependencies**: NestJS 11.2.1、Express 5.2.1、Prisma 7.9.1、Vue 3.5 / Vite 7；新增精确锁定 `openid-client@6.8.8`。

**Storage**: PostgreSQL；复用 InfraConfig、User、Account；新增一次性 OIDCLoginTransaction 表和 User.emailVerified 字段。

**Testing**: Jest 30 / ts-jest 29 单元和 REST 集成；common Vitest 4；新增 Node 原生真实库/本地 OIDC fixture harness 与本地会话 REST e2e；authentik 浏览器实机验收。

**Target Platform**: 自托管 AIO/分服务容器、浏览器、已有自托管 desktop 登录桥接；内网域名/私有 CA，默认 HTTPS，可显式允许单配置 HTTP。

**Project Type**: pnpm monorepo 的 web-service + admin/web/desktop clients。

**Performance Goals**: 事务 TTL 600 秒，清理滞后不超过十五分钟；IdP 单请求五秒、callback 总预算十五秒；成功 discovery 缓存十五分钟并合并并发加载；失败五秒后可重试。数值为本功能设计预算，不是现有基准成绩。

**Constraints**: 无 SMTP 和公网依赖；email 首次建号必需但验证状态不影响准入；verifier 不进 URL；IdP token 不长期保存；只用既有数据库，不引入 Redis；配置按现有重启机制生效；本地刷新不查询 IdP，IdP 禁用不主动撤销已有会话。

**Scale/Scope**: 每实例一个活动 provider；支持多后端副本和并发标签页；覆盖 backend、admin、selfhost-web、common，保留云端行为。不扩展为角色同步、账号合并或完整离线构建系统。

## Constitution Check

`.specify/memory/constitution.md` 仍含项目/原则占位符，没有已批准的实际原则。按本次授权继续规划，不将模板示例当作规范，不擅自修改 constitution。该项为 N/A，不冒称通过尚不存在的项目治理规则。

| 检查 | Phase 0 前 | Phase 1 后 |
|---|---|---|
| 输入与范围可确定 | PASS：已有 spec 和用户确认的澄清 A | PASS：“有邮箱、无验证邮件/SMTP”和 FR-015 / SC-006 已统一 |
| 技术与集成问题 | 已列库/模块、邮箱、state、authentik、网络研究项 | PASS：research 已给出全部决策 |
| 最小依赖与复用 | PASS：沿用 monorepo 和既有认证边界 | PASS：一项协议库；事务仅用 PostgreSQL |
| 身份与秘密边界 | 必须评估邮箱自动关联、verifier/state 风险 | PASS：身份先查、双向阻止自动关联、私密单次事务、严格 token 验证 |
| 内网无邮件要求 | 必须纳入验收 | PASS：OIDC-only、false/缺失 verified、私有 CA、断网和无 SMTP 验收均有明确结果 |
| IdP 禁用与本地会话 | PASS：用户选择 A，按源码复核已有本地规则 | PASS：明确本地刷新可续期、零 IdP 请求、logout 范围；SC-006 有独立验收 |
| 验收证据 | 不以 PR 宣称替代实测 | PASS：定义可运行验证；结果待实现阶段，不宣称已通过 |

无已知 gate violation 或未决澄清项。

## Project Structure

### Documentation (this feature)

```text
specs/001-generic-oidc/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── configuration.md
    └── oidc.md
```

`tasks.md` 留待 `$speckit-tasks`，本命令在 Phase 1 结束。

### Source Code (repository root)

以下为实现落点；标注“新增”的文件在实现阶段创建。

```text
packages/hoppscotch-backend/
├── prisma/schema.prisma + migrations/                 # User 标记、短期事务表
├── src/auth/
│   ├── auth.controller.ts / auth.module.ts / helper.ts
│   ├── auth.service.ts / strategies/                  # 本地会话、关联边界
│   └── oidc/                                         # 新增 adapter/service/transaction/provisioning
├── src/user/user.model.ts + user.service.ts           # emailVerified 数据和 GraphQL
├── src/infra-config/helper.ts + infra-config.service.ts + dto/onboarding.dto.ts
├── src/types/InfraConfig.ts + errors.ts
└── test/oidc/                                        # 新增 fixture、两套 Node suites、各 OIDC e2e
    └── fixtures/authentik-tls.compose.yml + authentik-tls.Caddyfile  # 新增隔离实机 CA/HTTP 测试入口
packages/hoppscotch-sh-admin/
├── src/helpers/{configs,auth}.ts
├── src/helpers/backend/rest/authQuery.ts              # 手写 Me 查询需读取 emailVerified
├── src/composables/{useConfigHandler,useOnboardingConfigHandler}.ts
├── src/components/{settings,onboarding,app}/
└── locales/
packages/hoppscotch-selfhost-web/
├── src/platform/auth/{web,desktop}/index.ts
├── src/pages/device-login.vue + src/main.ts           # 固定 device-login 返回恢复
├── src/components/Login.vue                          # 保留既有桌面入口
└── src/api/generated/                                # 由 codegen 更新
packages/hoppscotch-common/
├── src/platform/auth.ts                              # 可选邮件验证能力
├── src/components/firebase/Login.vue                 # OIDC 去重
├── src/pages/profile.vue                             # 无验证服务不显示验证动作
└── locales/
gql-gen/                                             # 生成的后端 schema
.env.example + .github/workflows/tests.yml + pnpm-lock.yaml
```

**Structure Decision**: 在既有 auth 内聚合 OIDC 小型服务，不新建独立认证应用；旧策略只增加防反向自动关联和资料标记维护。图像、远程头像、公共代理不加入登录流程。

## Phase 0: Research Results

[research.md](research.md) 已记录 PR 状态、6.x 模块加载、显式签名验证、authentik issuer/signing/email 特性、事务存储、邮件与网络边界。本轮追加当前 AuthService、JWT/refresh 策略和 logout 的源码复核，将澄清 A 固化为本地会话决策；既有技术选择保持有效，所有技术未知项已有决策。

特别保留两项约束：openid-client 的授权码默认行为不能代替 JWS 验证；独立 discovery URL 不能代替 expected issuer。library adapter 隔离这两处强制检查和 Node/Jest 差异。

## Phase 1: Design

### 后端协议与事务

复用公开 providers 接口，新增 begin/callback 路由。discovery 按需，不阻塞 backend 启动。固定 client authentication，不静默尝试其它方式。短期表保存 state/cookie 哈希及加密 verifier/nonce；独立 cookie 支持多标签页，条件原子删除提供跨副本单次消费。

完整验证后按 Account 编码身份查找。新身份与 User 在一个事务中创建；邮箱冲突返回 409，无按邮箱兜底或部分写入。旧策略和 magic-link 增加反向关联限制，防止新 OIDC 未验证邮箱被旧的邮箱关联逻辑混入。User.emailVerified 仅用于资料展示，不作为登录或权限条件。

### 本地会话与 IdP 禁用

按 FR-015 / SC-006，新的 OIDC 登录依赖 IdP 在授权/token 阶段执行禁用策略；客户端对其拒绝按现有认证失败契约处理，不签发本地 token。已有 Hoppscotch 会话继续使用本地 JWT、User 存在性和当前 refresh 哈希；IdP 禁用/不可达均不进入本地 access 或 refresh 判断。

按用户最新要求完整复用 AuthService.generateAuthTokens / refreshAuthTokens：登录及刷新签发本地 access/refresh，刷新先验证 JWT 与用户，再核对 User.refreshToken 中的 Argon2 哈希，成功后以现有方式签发并覆盖该用户哈希。签发载荷、有效期和现有校验/更新步骤保持一致，不为 OIDC 添加 jti、每次签发唯一性或并发单次刷新保证。验收条件为“与当前数据库哈希不匹配的 refresh 被拒绝”，不要求每次签发后旧 token 都立即成为不同值。

现有机制没有绝对会话最长时限，及时刷新可延长会话。清理短期授权事务、修改/停用 OIDC 配置也不撤销已有本地会话。logout 清除当前客户端凭据，保留数据库 refresh 哈希；本轮不增加逐用户或跨客户端撤销接口。删除本地 User 后沿用既有用户查找拒绝行为。OIDC 授权事务的 state 仍须按 FR-004 原子单次消费。

实现阶段新增 `packages/hoppscotch-backend/test/oidc/session-lifecycle.e2e-spec.ts`，验证本地 access/refresh、与当前哈希不匹配的 refresh 拒绝、删除 User 后拒绝、logout cookie 清理和本地请求对 IdP 的零调用。可控 IdP 与 authentik 分别验证“新授权被拒绝、已有会话继续工作”；协议 fixture 的拒绝状态是测试驱动，不新增厂商专用 active claim 或后台轮询。

### 配置和部署

契约见 [configuration.md](contracts/configuration.md)。默认 scope 含 email，但验证非必需。OIDC-only onboarding 关闭 SMTP/EMAIL，所有发信路径不参与登录。

私有 CA 经启动环境挂载；HTTP 仅按该配置显式允许，不关闭全局 TLS 检查。构建环境准备依赖和镜像，离线环境 load 后禁止 pull/build；启动、首次 discovery/JWKS 和登录不依赖公网缓存。

SC-002 的私有 CA 是真实 authentik 验收门槛。优先复用 `https://auth.ihxq.fun:9999` 的独立测试 Application；若其当前入口使用公共 CA，则为测试应用准备隔离私有 CA 入口，采用独立反向代理或同版本 authentik 测试实例，不替换正常业务入口的证书。测试域名、证书 SAN、IdP issuer 和所有 discovery/token/JWKS/UserInfo URL 必须一致指向该测试入口。CA 私钥、生成证书和运行配置仅保存在受忽略的本机目录，模板记录可复现操作。使用独立浏览器测试配置和 Node 启动信任，分别验证信任成功、未信任/移除后的失败；改变信任后重启后端并清理连接及 discovery/JWKS 缓存，避免缓存掩盖结果。显式 HTTP 测试也使用隔离端点。

### 客户端和资料状态

共享 UI 复用 additionalLoginItems 并修复裸 OIDC 两次 push。admin 处理独立入口及表单。客户端读取真实 emailVerified；管理端须同时修改 `src/helpers/backend/rest/authQuery.ts` 的手写 Me 查询和 `src/helpers/auth.ts` 的结果转换，确认 false/true 均正确传递。自托管设置可选 supportsEmailVerification=false，隐藏无实现的验证按钮，云端默认行为不变。

desktop 保留内网 device-login 和本机 loopback 协议。在 OIDC 跳转前保存固定、已验证的 device-login 上下文，返回 app 后恢复；不为此放宽 backend 任意回跳权限。无邮箱用户的详情/团队 UI 清理不是本次工作。

### 生成文件与兼容迁移

后端 schema/enum 和 User 标记变动后，先 prisma generate，再用根 gen-gql、admin 与 selfhost gql-codegen 更新生成文件，禁止手改；同步修改手写 me 查询以读取 emailVerified。migration 补充 emailVerified 和登录事务，InfraConfig 缺失键通过既有初始化机制补齐。兼容已有登录和加密密钥加载；停用 OIDC 后不删除身份数据。

## Verification Strategy

命令及 authentik 设置见 [quickstart.md](quickstart.md)。实施拆分至少落实：

| 层次 | 必须证明 |
|---|---|
| 单元/接口 | 配置启禁、issuer 精确匹配、scope/auth-method/HTTP 校验、错误参数、state 绑定/TTL/原子消费、verified false/缺失可建号 |
| 真实库/本地 IdP | CommonJS 加载、PKCE/nonce、RS256、错误签名/iss/aud/过期/subject、UserInfo、JWKS 轮换、超时恢复 |
| 数据与权限 | 同身份并发不重复、邮箱冲突无写入、双向不自动关联、verified 不影响准入、首 admin 与第二用户权限 |
| 本地会话（FR-010 / FR-015 / SC-006） | 签发/刷新与现有机制一致、IdP 禁用后新登录拒绝、原有效 access/refresh 继续工作、刷新对 IdP 请求为零、哈希不匹配 refresh/已删除 User 拒绝、logout 清当前凭据 |
| 客户端 | 单 OIDC 按钮、配置/初始化映射、未验证邮箱不出现验证动作、admin/web/desktop 和子路径 |
| authentik | 默认及 global issuer、basic/post、合法未验证 email、缺失 verified、ID token 外 profile；独立私有 CA 实机入口准备、完整信任登录和未信任/移除失败；显式 HTTP 独立端点 |
| 离线 | 公网全阻断、冷 discovery/JWKS 缓存、无 SMTP 时完成初始化/登录/刷新/退出；镜像启动不 pull/build |
| 既有回归 | Google/GitHub/Microsoft/EMAIL 已有关联、local JWT/权限/刷新及 desktop loopback 校验 |

Node 协议入口运行 `test/oidc/integration.test.mjs` 和 `test/oidc/provider-compatibility.test.mjs` 两套 suites，从编译产物加载真实 adapter，不把协议验证全交给 Jest mocks。已有 test:e2e 配置使用 `oidc/` 路径筛选运行全部 OIDC e2e，覆盖 auth-baseline、onboarding、session-lifecycle、transaction-concurrency、identity-concurrency 和 upgrade，补充 `src/auth/auth.service.spec.ts` 的既有刷新单测；quickstart 与任务采用同一完整命令。沿现有 Node 环境验证，不扩大为历史全仓 Node 24 测试故障修复。UI 去重/验证能力用 common 现有 Vitest；admin 没有 test script，使用 build/typecheck 及浏览器验收。

## Complexity Tracking

无 constitution 违规需要豁免。短期表用于保密、并发和单次消费，emailVerified 用于诚实表示未验证邮箱；均复用既有 PostgreSQL，未引入新基础服务。澄清 A 复用本地会话机制，验收增加覆盖，不新增存储或撤销服务。账号合并、无邮箱功能和桌面握手协议重构不进入实现范围。
