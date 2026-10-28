# OIDC Authentication Contract

API base 使用部署的 `VITE_BACKEND_API_URL`。默认 `/v1`，AIO 子路径场景必须保留实际前缀。配置见 [configuration.md](configuration.md)，身份和事务见 [data-model.md](../data-model.md)。

## 公开 provider 列表

`GET {API_BASE}/auth/providers` 保持既有响应：

```json
{ "providers": ["OIDC"] }
```

可与既有 provider 混合。未启用/本地配置不完整时不宣告 OIDC；IdP 暂不可达时保留配置好的按钮，并在点击时给出可重试错误。不要让 provider 列表依赖公网或同步 discovery。只返回标识，不返回 issuer、凭据或 claims。

## 发起登录

`GET {API_BASE}/auth/oidc?redirect_uri={可选固定返回入口}`

1. 检查启用状态、限流和活动配置。
2. redirect_uri 仅接受配置的 app/admin base 且位于既有 allowlist；未提供使用 app，非法目标拒绝或回退 app，禁止任意 host/path、协议相对 URL 和 userinfo。
3. 按需 discovery，校验 metadata，创建十分钟私密事务及独立浏览器 cookie。
4. 返回 302 到 IdP authorization endpoint，包含固定 callback、client_id、`response_type=code`、scope、独立 state/nonce、S256 challenge。verifier 和本地返回上下文不进入授权 URL。

begin/callback 使用 `Cache-Control: no-store` 和 `Referrer-Policy: no-referrer`。请求日志不记录 callback query 或 cookie 内容。

## 授权回调

`GET {API_BASE}/auth/oidc/callback?code=...&state=...`

仅支持 query response mode。`code/state/error` 等按单值解析，拒绝重复、多值及 code/error 同时出现。

处理顺序：

1. state 定位 pending 事务，验证浏览器 cookie、TTL、配置指纹；原子单次消费并清 cookie。无浏览器绑定不能消费别人事务。
2. provider error 终止；不能把 IdP error_description 原样输出到 HTML。
3. 用原 callback、verifier 和显式 client authentication 交换授权码；必须有 ID token。
4. 使用已启用非对称签名校验的库配置检查 JWS、exact issuer、audience/clientId、azp、exp/iat/nbf 适用规则、nonce 和 expected state。缺失或不符合约束均失败。
5. 需要 UserInfo 时使用已经验证的 ID token subject 作为 expected subject；不允许 skipSubjectCheck。只缺 verified 不要求读取 UserInfo。
6. 优先以 `(iss, sub)` 读取 Account；已有身份直接使用绑定 User。新身份要求合法 email；verified false/缺失允许建号；email 已占用返回冲突，User/Account 写入原子化。
7. 更新 last login，复用本地 token 签发和 cookie 属性，302 到事务保存的可信 app/admin 入口。不在新 URL 中附带 provider 或本地 token。

IdP access token 仅用于本次 UserInfo，refresh token/ID token 不持久化。本地 refresh/logout 延续既有接口和策略，不依赖 IdP 或 SMTP；退出只保证本地退出，IdP 会话可能继续存在。

## 本地会话与 IdP 禁用（FR-015 / SC-006）

| 接口/事件 | 契约 |
|---|---|
| 新 OIDC 登录 | IdP 在授权或 token 阶段拒绝已禁用用户，客户端处理其拒绝且不签发新的本地 token；沿用 authentication failed 类别 |
| 已有 access 请求 | 按本地 JWT 有效期、签名和本地用户存在性处理；不查询 IdP 状态 |
| `GET {API_BASE}/auth/refresh` | 复用现有本地 JWT/用户/Argon2 哈希校验，成功后由 AuthService 签发 access/refresh 并覆盖 User.refreshToken 哈希；对 IdP 的请求数为零 |
| `GET {API_BASE}/auth/logout` | 清除当前客户端 cookie；数据库 refresh 哈希保留，不保证其它客户端或复制令牌被撤销，也不退出 IdP |
| 本地用户被删除 | 用户查找失败，后续本地 access 请求和 refresh 被拒绝 |

IdP 禁用事件不会改写本地 User/Account 或 refresh 哈希。已有会话可按本地规则持续刷新，原 IdP token 或最初本地 refresh 的有效期不构成绝对会话截止时间。首版不轮询 IdP、不做逐请求外部状态检查，也不提供禁用后五分钟内失效的保证。

按 FR-010 保持当前签发载荷、有效期及校验/更新语义，不为 OIDC 添加 jti、每次 token 值唯一性或并发单次刷新保证。与当前 User.refreshToken 哈希不匹配的 refresh 必须按既有错误处理；不将“每次签发都立即拒绝旧 token”作为新增接口承诺。OIDC 授权事务 state 的原子单次消费仍按 FR-004 执行。

“新登录拒绝”由 IdP 实际拒绝新授权/token 请求来验证，不依赖厂商专用 active claim；已经登录 Hoppscotch 的页面继续访问本地会话不属于新 OIDC 登录。失败的新 OIDC 请求应保留仍有效的已有本地登录凭据。

## 失败响应

| HTTP | 稳定错误类别 | 行为 |
|---|---|---|
| 404 | provider disabled | 不创建事务，不联系 IdP |
| 400 | invalid request / transaction | 错误 state、cookie、过期、重复参数、重放；不签发本地 token |
| 401 | authentication failed / email required | IdP 拒绝、错误 token/subject，或首次建号缺少合法邮箱 |
| 409 | identity email conflict | 邮箱已存在；不能自动合并，不能部分建号 |
| 429 | rate limited | 复用现有保护 |
| 503 | provider unavailable | discovery、token、JWKS、UserInfo 超时/不可达，用户可重新发起登录 |

浏览器导航显式接受 `text/html` 时，OIDC begin/callback 的失败响应保留原 HTTP 状态，提供无需外部资源或脚本的中英文错误页（按 Accept-Language 选择）。页面只显示固定说明和稳定错误码，提供返回应用、返回管理端及重新登录入口。链接只取部署配置且通过原有 allowlist 校验；重试始终使用配置中的 API base，保留已验证事务的 app/admin 目标并新建授权事务。无有效事务时回退到可信应用入口，不采用请求的 Host、Referer 或任意 redirect_uri。禁用的 provider 不提供重试按钮。默认请求、`*/*` 和优先接受 JSON 的 API 请求保留既有 JSON 错误契约。HTML 响应设置 no-store、no-referrer、nosniff 和 CSP，且不加载外部资源。

错误仅包含稳定代码和用户可理解的说明，不返回 token、secret、claims 全文、原始第三方错误或账号权限。错误不会清除其他 provider 的既有会话；无新 token cookie。已消费事务失败后不能原地重放。

## 身份和邮箱规则

- issuer/sub 始终是唯一登录依据；邮箱是首次建号所需资料，verified 是资料状态，均不是自动关联证明。
- ID token 与 UserInfo 的不同 email 不能交叉使用 verified。新身份的冲突检查包含大小写等价邮箱。
- 邮箱验证状态 false/缺失时无需邮件、补验证、验证码或管理员手动激活。
- 对既有 Google/GitHub/Microsoft/magic 登录入口增加目标账号检查：若首次关联会进入 OIDC 账号，则受控拒绝，不得按邮箱反向挂接。已存在的纯既有登录关系维持原行为。
- `me` 的 User 增加 `emailVerified`，前端读取持久资料状态；自托管关闭邮件验证 UI 能力，未验证状态不限制普通功能。
- 只有原有 `verifyAdmin` 首用户机制和已有 admin 操作能提升权限；仅创建第一个用户后仍需完成既有管理端校验，之后的用户不自动提升。

## 应用、管理端与桌面 UI

- 应用通过现有 `additionalLoginItems` 接入 `id=OIDC`，公共列表裸 OIDC 与旧 `OIDC:name` 解析必须去重且匹配准确，不能把 `OIDC_BAD` 当成有效前缀。
- 管理端独立登录组件调用同一入口，redirect_uri 使用受信任 VITE_ADMIN_URL。
- 桌面继续 customLoginSelectorUI 打开内网 `/device-login?redirect_uri=http://localhost:{port}/device-token`。在该网页选择 OIDC 前，将经过验证的**固定本地 device-login 路由**保存 sessionStorage；OIDC 返回 app base 后恢复该路由并清除暂存。
- 恢复只接受部署 app base 下的 device-login 路径与现有 loopback 校验通过的参数，不执行任意暂存 URL。用户随后确认，复用既有 `/auth/desktop` 和 loopback 握手；不新增公网桥接或 `redirect_uri=desktop` 特殊旁路。
- 不修改既有桌面 token 传递协议；新增 OIDC 回调和恢复 URL 不携带 token。该协议的后续重构不在本计划范围。
