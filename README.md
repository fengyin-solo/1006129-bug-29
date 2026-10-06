# 盾构隧道掘进施工管理平台

面向盾构机台账、掘进环次、管片拼装、同步注浆、渣土外运、地表沉降监测与轴线纠偏的一体化盾构隧道施工管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 盾构机台账 | `shield` | 盾构机 | 盾构机编号、盾构机型号、开挖直径 |
| 掘进环次 | `ring` | 掘进环 | 环号、起始里程、掘进速度 |
| 管片拼装 | `segment` | 管片环 | 管片环号、管片型号、拼装点位 |
| 同步注浆 | `grouting` | 注浆记录 | 注浆编号、对应环号、浆液配比 |
| 渣土外运 | `muck` | 渣土运输单 | 运输单号、对应环号、渣土方量 |
| 地表沉降 | `settlement` | 沉降测点 | 测点编号、测点位置、初始高程 |
| 轴线偏差 | `axis` | 轴线测量 | 测量编号、对应环号、设计轴线 |
| 刀具磨损 | `cutter` | 刀具 | 刀具编号、刀盘位置、刀具类型 |
| 管片生产 | `segmentprod` | 管片 | 管片编号、管片型号、生产模具 |
| 浆液拌制 | `mortar` | 浆液批次 | 批次编号、浆液类型、水泥用量 |
| 洞内通风 | `ventilation` | 通风机组 | 机组编号、风筒长度、送风量 |
| 建筑监测 | `building` | 监测对象 | 对象编号、建筑物名称、结构类型 |
| 管线探查 | `utility` | 地下管线 | 管线编号、管线类型、埋设深度 |
| 进度节点 | `progress` | 进度节点 | 节点编号、节点名称、计划完成日 |
| 试验检测 | `testing` | 试验委托 | 委托编号、试样类型、检测项目 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练科目、演练日期 |
| 班组进场 | `crew` | 施工班组 | 班组编号、班组名称、主要工种 |
| 安全巡检 | `safety` | 巡检记录 | 巡检编号、巡检区域、巡检项目 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `shield-tunnel-construction:entries` 这一项，或调用 `resetModule(模块)`。

## 地表沉降 / 建筑监测：归属、阈值权限与报警

这两个页面是**同一份监测数据的两个入口**，领域逻辑集中在 `frontend/src/data/monitor/`，
任何写操作都经 `service.ts` 统一校验，页面不做第二套判断：

- **测点归属**：每个测点写明归属监测单位，顶栏可切换单位账号。只有归属单位能改本单位测点；
  非归属单位（含监理）当场拒绝、仅可查看。测点划转立即移交归属与权限并留痕。
- **阈值留痕**：调整阈值必须填原因，每次调整写入留痕；历史报警按发布当时的阈值快照留档，
  改口径后只对在效报警按新阈值重算（仍超限保持在效，不再超限则解除，旧记录不动）。
- **已解除只读**：测点解除后整段转只读，任何单位（含归属单位）都只能查看。
- **报警唯一来源**：报警结论只落在「建筑监测报警清单」，两页读同一数据源，
  在效报警测点数天然一致；同一测点重复发布只保留最早一条；超限幅度一律以地表沉降测点侧为准。
- **可靠性**：每次操作整体落盘并写前/写后核对，失败重试 3 次，仍失败整条抽回，绝不拿老数据兜底。
- **老数据兼容**：首次进入时从泛型表按监测日期补录存量测点（带单位字符串如 `-33.6mm` 可解析），
  占位样例行跳过；运营概览等其他页面的统计也随领域数据重算，两侧只留一份。

验证脚本（仅开发期使用，不写入 package.json）：

```bash
cd frontend
npm install --no-save esbuild playwright @rollup/rollup-linux-arm64-gnu  # 按平台补齐
node scripts/verify-monitor.mjs   # 领域行为：越权/幂等/重算/回滚
node scripts/verify-legacy.mjs    # 存量补录与老数据兼容
node scripts/verify-ui.mjs        # 无头浏览器两页渲染与刷新核对（需 Chromium）
```
