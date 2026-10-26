# T2 canteen 中间件内部收敛

## 1. Where this task sits

- **Phase 5 后端与共享层收拢**，目标：可选鉴权在审计点名的三条路由只剩一份实现，点评不再可能编造评分。
- 本任务把 **R-8 后端可选鉴权收拢一处** 收尾：`canteen.js` 的 `optionalAuth` 中间件保留签名，内部改调共享函数（同步化，删回调式手写）。
- **Starts after**: T1 posts 与 clubs 换用共享鉴权。**Waits on it**: T4 全量回归。

## 2. What the developer needs to know

**Read first**

- `routes/canteen.js:216-229` — 回调式 `jwt.verify` 手写；调用点全是路由链上的 `optionalAuth` 中间件位。
- `utils/parseOptionalUser.js` — 共享函数返回 user 或 null，中间件包一层即等价（verify 失败 → null → `req.user = null`）。
- `__tests__/routes/` 的 canteen 专项测试（canteenPermissions/canteenWriteGuards 等）— 本任务缝。

**Settled**

- 中间件对外行为与签名不变（公开读接口零感知）；内部删掉对 `jsonwebtoken` 的直接 require。
- 其余 7 处局部副本仍不碰（同 T1 口径）。

**Edges and seam**

- 只改 `routes/canteen.js` 一处函数体；缝：canteen 路由专项测试。

**Run**

- 根目录：`npm test -- __tests__/routes/canteenPermissions.test.js __tests__/routes/canteenWriteGuards.test.js`

**Unknowns**

- 若专项测试未覆盖 optionalAuth 路径（公开读接口），以 grep 门 + 行为等价论证收口，并记入小结。

## 3. The workflow

1. 读上述文件，一句话复述任务。
2. `optionalAuth` 内部改为 `req.user = parseOptionalUser(req); next();`，删回调实现。
3. 专项测试跑绿；grep 门：文件内不再直接 `jwt.verify` 于该函数。
4. 提交。

## 4. The test cases

| Case | Input | Expected | Seam |
|---|---|---|---|
| 1 | canteen 专项测试 | 原样全绿 | jest |
| 2 | grep canteen.js | `optionalAuth` 函数体内 0 处 `jwt.verify` | grep 门 |
