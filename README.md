# SkinSense AI

> A multimodal AI skincare decision system that turns a real-time face scan, local weather, user constraints, and a grounded product catalog into explainable recommendations.

SkinSense AI 是一个由我独立设计并实现的端到端 AI 应用。它不只是调用一次大模型：系统会在浏览器端完成实时人脸引导与图像质量判断，在后端使用 LangGraph 编排天气工具、产品 RAG、多模态模型和确定性校验，拦截模型虚构的商品，最终生成可保存的个性化护肤报告。

这个项目重点解决一个真实问题：通用大模型可以给出听起来合理的护肤建议，但容易忽略预算、过敏成分和所在市场，也可能推荐不存在或无法购买的产品。SkinSense AI 将模型的视觉理解和语言推理能力放进一个可约束、可追溯、可降级的工程系统中。

## 项目亮点

- **实时多角度面部采集**：基于 MediaPipe Face Landmarker 判断人脸位置、距离和转头角度，自动采集正脸、左侧脸和右侧脸。
- **多图综合判断**：从扫描序列中选择质量更好的画面，并补充面部区域高清裁剪，最多向多模态模型提交 6 张带语义标签的图像。
- **环境感知**：根据定位获取实时温度、湿度、天气和 UV 信息，让建议结合用户当前环境，而不是生成通用答案。
- **混合检索 RAG**：先按市场、预算、无香偏好和避用成分进行硬过滤，再使用 OpenAI Embedding 与 pgvector 进行语义召回。
- **商品幻觉控制**：模型只能从检索到的候选商品中推荐；后处理会删除不在数据库中的商品，并用数据库字段覆盖品牌、名称、价格和来源链接。
- **LangGraph 工作流**：将天气、检索、模型和校验拆成有状态节点；校验失败时只重跑模型与校验节点，不重复天气查询和商品检索。
- **节点级可观测性**：每次分析返回 `trace_id`；配置 LangSmith 后可查看各节点输入输出、耗时、重试和错误。
- **可靠性与降级**：限制上传图片数量和体积；模型输出支持重试与 JSON 修复；天气或 RAG 暂时不可用时，核心分析仍可继续。
- **完整产品体验**：包含登录、沉浸式扫描、偏好收集、分析状态、结构化结果、商品来源和报告导出。

## 系统架构

```mermaid
flowchart LR
    U["用户浏览器"] --> S["实时面部扫描"]
    S --> M["MediaPipe<br/>人脸与姿态检测"]
    M --> Q["质量筛选<br/>正脸 / 左脸 / 右脸"]
    Q --> API["FastAPI /api/analyze"]
    API --> LG["LangGraph<br/>有状态工作流"]

    LG --> W["OpenWeather<br/>环境上下文"]
    W --> R["Product RAG"]
    R --> F["市场 / 预算 / 成分<br/>确定性过滤"]
    F --> E["OpenAI Embedding"]
    E --> V["PostgreSQL + pgvector<br/>向量召回"]

    W --> L["Claude / OpenAI<br/>多模态分析"]
    V --> L
    Q --> L
    L --> G["Grounding Validator<br/>商品校验与字段归一"]
    G -. "校验失败，定向重试" .-> L
    G --> O["个性化分析报告<br/>商品来源 / PDF / 图片"]
```

这套架构将概率型能力与确定性逻辑分开：模型负责视觉理解、归因和解释，程序负责限制条件、数据检索、结果校验和失败降级。

## 核心 AI 工作流

| 阶段 | 系统能力 | 工程实现 |
| --- | --- | --- |
| 感知 | 获取不同角度的面部证据 | MediaPipe landmarks、yaw 判断、清晰度/亮度/构图检查 |
| 上下文 | 理解用户环境与购买限制 | 定位天气、预算、质地、香味和避用成分 |
| 检索 | 从真实商品库寻找候选 | Open Beauty Facts、Embedding、pgvector HNSW cosine search |
| 编排 | 管理状态、节点顺序和定向重试 | LangChain Runnable、LangGraph StateGraph |
| 推理 | 综合多张图、天气和候选商品 | Claude Sonnet 4.6，支持切换 GPT-4o |
| 约束 | 降低幻觉和不合规推荐 | Prompt grounding、catalog ID 校验、数据库字段回填、校验反馈重试 |
| 输出 | 生成可阅读、可保存的报告 | 皮肤观察、问题归因、成分建议、产品推荐、生活建议 |

## LangGraph 分析工作流

每次 `/api/analyze` 请求会生成唯一 `trace_id`，并按以下节点执行：

```text
weather_context
→ product_retrieval
→ model_analysis
→ result_validation
   ├─ 通过：返回报告
   └─ 失败：携带校验原因重跑 model_analysis，最多 2 次
```

模型节点还配置了瞬时异常重试。天气或 RAG 已成功执行后，商品校验失败不会让前置节点重复运行。

为了保护用户隐私，原始面部图片只保存在当前请求的临时内存区，不进入 LangGraph state，也不会被发送到 LangSmith。当前版本不启用跨请求 checkpoint；后续如需断点恢复，会先设计加密图片存储、过期删除和用户授权机制。

## Product RAG

项目已接入 PostgreSQL 与 `pgvector`，当前使用 Open Beauty Facts 作为启动数据源：

1. 清洗商品名称、品牌、分类、成分、适用肤质、价格、市场和来源链接。
2. 将商品证据组织为检索文档，使用 `text-embedding-3-small` 生成 1536 维向量。
3. 写入 `catalog_products`，通过 HNSW 索引进行 cosine similarity 检索。
4. 查询时先执行市场、预算、无香和避用成分过滤，再返回最多 12 个语义相关候选。
5. 将候选作为“不可信数据而非指令”注入模型上下文，降低数据中的 Prompt Injection 风险。
6. 模型输出后再次按 `catalog_id` 校验，删除虚构商品并保留数据来源。

Render 启动时会自动初始化数据库结构；当商品表为空时，后台导入最多 300 条可用商品。若数据库、Embedding 服务或数据源异常，服务会记录错误并退回非 RAG 分析流程，避免整个请求失效。

可通过以下接口检查检索状态：

```http
GET /api/catalog/status
```

更完整的数据库结构、导入方式和数据格式见 [backend/RAG.md](backend/RAG.md)。

## 面部采集设计

扫描不是定时截图，而是一个带反馈的视觉状态机：

- 正脸阶段要求人脸位于取景框内并达到最小尺寸。
- 左右侧脸阶段使用 landmarks 估算 yaw，只有角度和画面质量同时通过才会进入下一阶段。
- 每个阶段会连续采样并选择更合适的候选，而不是使用用户按下按钮瞬间的一帧。
- 扫描完成后生成带标签的多图输入，并自动进入偏好填写流程。
- 当前后端仅在内存中读取分析图片，不将用户面部图片持久化到项目服务器。

## 可靠性与安全意识

- 单张图片最大 10 MB，总上传量最大 20 MB，最多处理 6 张图片。
- 多模态模型输出采用结构化 JSON 约束、重试和 `json-repair` 容错。
- RAG 检索失败时自动降级，不阻断皮肤分析主流程。
- 商品数据保留 `source` 与 `product_url`，结果页可查看商品来源。
- RAG 数据在 Prompt 中被明确标记为不可信数据，不能覆盖系统指令。
- 当前版本不持久化人脸图片，并计划继续补充数据留存说明与用户授权流程。

## 技术栈

**Frontend**

- Next.js 16、React 19、TypeScript、Tailwind CSS 4
- MediaPipe Tasks Vision
- Radix UI、Lucide Icons
- html2canvas 与浏览器打印报告

**Backend & AI**

- Python、FastAPI、Pydantic、HTTPX
- Anthropic Claude / OpenAI GPT-4o
- LangChain、LangGraph、LangSmith
- OpenAI `text-embedding-3-small`
- PostgreSQL、pgvector、asyncpg
- OpenWeather、Open Beauty Facts、Serper

**Deployment**

- Vercel：前端
- Render：FastAPI 服务与 PostgreSQL
- GitHub：版本管理与自动部署触发

## 本地运行

### 1. 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

最小环境变量：

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
OPENWEATHER_API_KEY=...
```

启用 Product RAG：

```env
RAG_ENABLED=true
DATABASE_URL=postgresql://user:password@host:5432/database
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
RAG_CANDIDATE_LIMIT=12
RAG_BOOTSTRAP_LIMIT=300
```

可选的 LangSmith 节点追踪：

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=skinsense-ai
```

初始化和导入数据：

```powershell
cd backend
python -m scripts.init_rag_db
python -m scripts.import_open_beauty_facts --limit 300
```

### 2. 前端

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL="http://localhost:8000"
npm run dev
```

访问 `http://localhost:3000`。

## 测试与验证

后端已覆盖以下 RAG 与工作流关键路径：

- 避用成分解析
- 多币种预算上限转换
- 无香偏好识别
- Embedding 文档构建
- 虚构商品过滤与字段归一
- Catalog grounding Prompt 约束
- LangGraph 校验失败条件路由
- 仅重跑模型节点的定向重试
- FastAPI 工作流元数据响应

```powershell
cd backend
python -m unittest discover -s tests -v
```

当前测试结果：**9 个后端单元与接口测试通过**。前端已通过 Next.js production build。

## 当前进度

### 已完成

- 实时正脸/侧脸采集和质量门控
- 多图多模态皮肤分析
- 天气工具接入
- 用户过敏信息和产品偏好收集
- Product RAG 数据库、Embedding、向量召回和硬过滤
- 商品推荐后校验与来源展示
- LangGraph 状态工作流和校验反馈重试
- `trace_id` 与可选 LangSmith 节点追踪
- Render 空库自动初始化和后台数据导入
- 分析报告与 PDF/图片导出
- 后端 RAG 核心逻辑测试

### 下一阶段

- 建立离线评测集，量化检索 Recall@K、商品合规率和回答稳定性。
- 建立 LangSmith Dashboard，持续统计节点延迟、Token 成本和降级原因。
- 将天气查询与产品检索并行化，并加入超时、缓存和更细粒度的降级策略。
- 引入经过审核的零售商或联盟商品数据，改善价格、库存与市场覆盖。
- 增加成分冲突的确定性规则层，减少完全依赖模型判断。
- 收紧 CORS、校验外部图片 URL，并完善隐私授权、数据删除和安全测试。

## 与 AI 应用 / Agent 工程岗位的对应

| 岗位关注点 | SkinSense AI 中的实践 |
| --- | --- |
| 需求理解与归因 | 从“推荐不可信、缺少上下文、容易虚构商品”拆解出视觉、环境、检索和校验问题 |
| AI 原生架构 | 使用 LangGraph 将感知、工具调用、知识检索、模型推理和确定性验证拆成有状态节点 |
| 知识与环境构建 | 接入天气 API、Open Beauty Facts、PostgreSQL 与 pgvector，为模型动态注入上下文 |
| 核心能力实现 | 多模态 Prompt、LangGraph 条件路由、校验反馈重试、JSON 修复、Catalog grounding |
| 评测与迭代 | 已覆盖关键 RAG 规则测试，下一步建设检索与回答自动化评测 |
| 性能与稳定性 | FastAPI 异步服务、连接池、节点重试、图片限制、异常降级和后台数据初始化 |
| 工程落地能力 | 从交互设计、前后端开发、AI 接入、数据库到云部署的完整闭环 |

这个项目展示的不是“会调用一个模型 API”，而是如何识别大模型的不确定性，再通过上下文工程、工具、RAG、规则和工程降级把它变成一个可以实际使用的产品。

## 项目结构

```text
.
├── frontend/
│   ├── app/                  # 首页、扫描/偏好、结果与登录页面
│   ├── components/           # UI 组件
│   ├── lib/                  # API 客户端与类型
│   └── public/               # 产品视觉素材
├── backend/
│   ├── routers/              # 分析、商品状态 API
│   ├── services/             # LLM、天气、Embedding、Product RAG
│   ├── workflows/            # LangGraph 状态、节点、条件路由与重试
│   ├── scripts/              # 数据库初始化与商品导入
│   ├── sql/                  # pgvector schema 与索引
│   └── tests/                # RAG、LangGraph 与 API 测试
└── render.yaml               # Render 部署配置
```

## 数据与使用说明

Open Beauty Facts 是社区维护的数据源，适合原型验证，但在商业化前应使用经过授权和审核的商品数据补充价格、库存和成分准确性。本项目提供的是 AI 辅助护肤信息，不替代皮肤科医生的诊断或治疗建议。
