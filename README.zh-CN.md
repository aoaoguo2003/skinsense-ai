# SkinSense AI

> 结合实时面部扫描、天气环境、用户限制与真实商品检索的多模态 AI 护肤决策系统。

**中文** | [English](README.md)

[![AI Evaluation Gate](https://github.com/aoaoguo2003/skinsense-ai/actions/workflows/evaluation.yml/badge.svg)](https://github.com/aoaoguo2003/skinsense-ai/actions/workflows/evaluation.yml)

SkinSense AI 是一个端到端 AI 护肤应用。浏览器端负责实时多角度面部引导和图像质量判断；后端使用 LangGraph 编排天气上下文、产品 RAG、多模态分析、确定性校验、定向重试和报告生成。

系统重点解决通用模型在护肤建议中的可靠性问题：模型可能忽略过敏成分、预算、香味偏好、当地气候和商品可购买性，也可能推荐不存在的商品。SkinSense AI 将概率型模型能力放入可约束、可观测、可降级的工程流程中。

## 项目亮点

- **实时面部扫描**：MediaPipe Face Landmarker 检查人脸位置、尺寸、清晰度和转头角度，自动采集正脸、左脸和右脸。
- **多图综合分析**：从扫描序列中选择质量更高的画面和面部区域高清裁剪，最多提交 6 张带语义标签的图片。
- **环境感知**：根据定位加入温度、湿度、天气和 UV 信息。
- **真实商品 RAG**：PostgreSQL 与 pgvector 结合确定性过滤和 Open Beauty Facts 语义检索。
- **商品幻觉控制**：推荐结果必须通过 Catalog ID 校验，并由数据库字段覆盖模型生成的商品信息。
- **有状态工作流**：LangGraph 将天气、检索、模型和校验拆分为节点，失败时仅重跑相关节点。
- **节点级可观测性**：每次分析返回 `trace_id`、模型调用次数、校验结果和节点耗时。
- **自动化评测**：使用版本化案例量化结构正确率、召回覆盖、商品落地、限制条件和延迟。
- **隐私意识**：原始面部图片仅保存在请求级临时内存，不进入 LangGraph state 和 LangSmith trace。
- **云端部署**：前端部署于 Vercel，FastAPI 与 PostgreSQL 部署于 Render。

## 系统架构

```mermaid
flowchart TB
    subgraph A["1. 感知与输入"]
        U["用户偏好<br/>过敏 / 预算 / 质地"]
        S["多角度面部扫描"]
        M["MediaPipe 质量门控<br/>正脸 / 左脸 / 右脸"]
        S --> M
    end

    subgraph B["2. LangGraph 编排"]
        W["天气上下文"]
        R["商品 RAG"]
        L["多模态肤质分析"]
        G["商品落地与结果校验"]
        W --> R --> L --> G
        G -. "校验反馈" .-> L
    end

    subgraph C["3. 知识与输出"]
        DB["PostgreSQL + pgvector<br/>Open Beauty Facts"]
        O["个性化报告<br/>皮肤分析 / 真实商品推荐"]
    end

    U --> W
    M --> L
    DB <--> R
    G --> O
```

架构将概率型能力与确定性逻辑分开：

| 层级 | 主要职责 |
| --- | --- |
| 模型 | 视觉理解、推理、解释和个性化表达 |
| 检索 | 从真实商品库中寻找候选 |
| 规则 | 市场、预算、香味和避用成分过滤 |
| 校验 | JSON 结构、Catalog ID、数据库字段归一和重试路由 |
| 评测 | 质量指标、失败归因、延迟分析和版本回归 |

## LangGraph 工作流

每次 `/api/analyze` 请求都会生成唯一 `trace_id`：

```text
weather_context
→ product_retrieval
→ model_analysis
→ result_validation
   ├─ 通过：返回报告
   └─ 失败：携带校验原因重跑 model_analysis，最多 2 次
```

商品校验失败时不会重复天气查询和商品检索。RAG 已启用但没有商品满足限制条件时，校验器会返回空推荐列表，不允许模型自由编造商品。

原始面部图片保存在请求级临时内存，不进入图状态。跨请求图片 checkpoint 暂未启用，后续需要先定义加密、留存、删除和授权策略。

## Product RAG

当前使用 Open Beauty Facts 作为原型商品数据源：

1. 清洗商品 ID、品牌、名称、分类、成分、市场和来源链接。
2. 构建检索文档，生成 1536 维 `text-embedding-3-small` 向量。
3. 写入 PostgreSQL，并通过 pgvector HNSW cosine 索引召回。
4. 执行市场、预算、无香偏好和避用成分过滤。
5. 返回最多 12 个语义相关候选。
6. 将商品内容标记为不可信数据，降低 Prompt Injection 风险。
7. 按 `catalog_id` 校验模型输出，并用数据库字段完成归一化。

Render 会自动初始化数据库结构。空商品库会触发最多 300 条商品的后台导入，并支持失败重试。

```http
GET /api/catalog/status
GET /health
```

数据库和导入说明见 [backend/RAG.md](backend/RAG.md)。

## 面部采集

扫描过程是带质量门控的视觉状态机：

- 正脸阶段检查构图和最小人脸尺寸。
- 左右脸阶段通过 landmarks 估算 yaw，并等待清晰侧脸。
- 每个阶段连续采样并选择质量更高的画面。
- 面部区域高清裁剪用于保留毛孔、纹理、泛红和干燥等细节。
- 扫描完成后自动进入偏好收集页面。
- 后端不持久化上传的面部图片。

## 自动化评测

评测系统包含 12 个版本化文本案例，覆盖：

- 低预算；
- 多种避用成分；
- 无香偏好；
- 产品质地偏好；
- 不同气候；
- 无定位降级。

质量指标包括：

- 必需 JSON 结构正确率；
- RAG 候选召回率；
- 推荐商品存在性；
- Catalog grounding；
- 避用成分合规率；
- 数据可用时的香味、预算和质地合规率；
- 用户问题覆盖率。

性能指标包括：

- 平均、P50 和 P95 端到端延迟；
- LangGraph 节点级耗时；
- 模型重试率；
- RAG 异常率；
- 与历史基线的指标差异。

真实评测会在每次请求完成后写入 checkpoint，可在中断后继续运行，避免重复产生付费调用。

```powershell
cd backend

# 不调用付费 API，仅校验评测集
python -m evaluation.runner --mode validate

# 运行 3 次线上 smoke test
python -m evaluation.runner --mode live --runs 3 `
  --base-url https://your-service.onrender.com

# 从 checkpoint 继续
python -m evaluation.runner --mode live --runs 10 `
  --base-url https://your-service.onrender.com --resume
```

### 已审阅评测基线

**首轮 30 次线上评测**

- 共尝试 30 次；
- Anthropic 额度耗尽前完成 7 次；
- 上游错误推动了安全错误归因机制；
- 评测发现零候选商品幻觉，并推动确定性保护。

**Claude 充值恢复后的 10 次 Smoke Evaluation**

- 工作流可用率：**10/10**；
- 必需结构正确率：**100%**；
- 可测量 Catalog grounding：**100%**；
- 用户问题覆盖率：**100%**；
- RAG 检索异常：**0**；
- 端到端质量门通过：**4/10**；
- 模型节点平均耗时：**105.1 秒**；
- 检索节点平均耗时：**0.66 秒**。

4 个不要求无香的案例全部召回候选并通过；6 个要求无香的案例全部零召回。原因是 Open Beauty Facts 中经过确认的无香字段覆盖不足。因此，40% 表示商品数据覆盖问题，不代表模型准确率只有 40%。

**检索修复（基线之后，尚未重新测量）：** 根因分析将这 6 个零候选案例定位到无香检索过滤条件——它要求 `fragrance_free IS TRUE`，从而把该字段为 `NULL`（未标注）的商品也排除了。这等于把"未知"当成"含香精"，而且与评测指标不一致（评测把未标注的候选视为可接受）。现已改为 `fragrance_free IS NOT FALSE`——保留"确认无香"和"未标注"的商品，只排除"确认含香"的，同时避用成分过滤仍会拦截明确含香精的商品。上方 4/10 的质量门反映的是修复前状态；在修订此处数字之前会重新跑一次基线验证。

评测文档：

- [首轮线上评测基线](backend/evaluation/baselines/2026-06-11-live-baseline.md)
- [Claude 10 次 Smoke 基线](backend/evaluation/baselines/2026-06-11-claude-10-smoke.md)
- [评测系统说明](backend/evaluation/README.md)

## 可靠性与安全

- 最多处理 6 张图片，单张最大 10 MB，总量最大 20 MB。
- 模型输出使用结构化 JSON、重试和 `json-repair`。
- RAG 异常时允许皮肤分析降级运行。
- 零候选时禁止输出未落库商品。
- 上游异常返回安全的 `503` 错误类型，不暴露密钥和内部数据。
- 商品内容在 Prompt 中被标记为不可信上下文。
- 商品推荐保留来源链接。
- 原始面部图片不持久化，也不发送到 LangSmith。

## 技术栈

**前端**

- Next.js 16、React 19、TypeScript、Tailwind CSS 4
- MediaPipe Tasks Vision
- Radix UI、Lucide Icons
- html2canvas 与浏览器打印导出

**后端与 AI**

- Python、FastAPI、Pydantic、HTTPX
- Anthropic Claude，可选 OpenAI GPT-4o
- LangChain、LangGraph、可选 LangSmith tracing
- OpenAI `text-embedding-3-small`
- PostgreSQL、pgvector、asyncpg
- OpenWeather、Open Beauty Facts、Serper

**部署**

- Vercel 前端
- Render FastAPI 与 PostgreSQL
- GitHub Actions 自动评测质量门

## 本地运行

### 后端

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

核心环境变量：

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
OPENWEATHER_API_KEY=...

RAG_ENABLED=true
DATABASE_URL=postgresql://user:password@host:5432/database
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
RAG_CANDIDATE_LIMIT=12
RAG_BOOTSTRAP_LIMIT=300
```

可选 LangSmith tracing：

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=skinsense-ai
```

初始化商品库：

```powershell
python -m scripts.init_rag_db
python -m scripts.import_open_beauty_facts --limit 300
```

### 前端

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL="http://localhost:8000"
npm run dev
```

访问 `http://localhost:3000`。

## 验证

```powershell
cd backend
python -m unittest discover -s tests -v
```

当前验证结果：

- **21 项后端单元和接口测试通过**
- Next.js production build 通过
- GitHub Actions `AI Evaluation Gate` 已启用

## 项目结构

```text
.
├── frontend/
│   ├── app/                  # 首页、扫描、偏好、结果、登录
│   ├── components/           # UI 组件
│   ├── lib/                  # API 客户端与类型
│   └── public/               # 视觉资源
├── backend/
│   ├── routers/              # 分析与商品 API
│   ├── services/             # LLM、天气、Embedding、Product RAG
│   ├── workflows/            # LangGraph 状态、节点、路由和重试
│   ├── evaluation/           # 数据集、指标、报告和基线
│   ├── scripts/              # 数据库与商品导入
│   ├── sql/                  # pgvector schema 与索引
│   └── tests/                # RAG、工作流、API 和评测测试
└── render.yaml
```

## 数据与医疗说明

Open Beauty Facts 是社区维护的原型数据源。商业化需要接入经过审核和授权的商品数据，以提高价格、库存、香味和成分信息的覆盖率。

SkinSense AI 提供 AI 辅助护肤信息，不替代专业皮肤科医生的诊断或治疗。
