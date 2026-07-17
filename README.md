# SkinSense AI

> A multimodal AI skincare decision system that combines real-time face scanning, weather context, user constraints, and grounded product retrieval.

[中文](README.zh-CN.md) | **English**

[![AI Evaluation Gate](https://github.com/aoaoguo2003/skinsense-ai/actions/workflows/evaluation.yml/badge.svg)](https://github.com/aoaoguo2003/skinsense-ai/actions/workflows/evaluation.yml)

SkinSense AI is an end-to-end AI skincare application. The browser guides a real-time multi-angle face scan and applies image-quality gates. The backend uses LangGraph to orchestrate weather context, product RAG, multimodal analysis, deterministic validation, directed retries, and report generation.

The system addresses a practical reliability problem: general-purpose models can produce convincing skincare advice while ignoring allergies, budget, fragrance preferences, local climate, or product availability. SkinSense AI places probabilistic model capabilities inside a constrained, observable, and degradable engineering workflow.

## Highlights

- **Real-time face scanning:** MediaPipe Face Landmarker verifies face position, size, clarity, and yaw before capturing front, left, and right views.
- **Multi-image reasoning:** The scan selects higher-quality frames and facial-zone crops, submitting up to six labeled images.
- **Context-aware analysis:** Location-based temperature, humidity, weather, and UV data are included in the analysis.
- **Grounded product RAG:** PostgreSQL and pgvector combine deterministic filtering with semantic retrieval over Open Beauty Facts.
- **Hallucination control:** Product recommendations are validated against retrieved catalog IDs and normalized with canonical database fields.
- **Stateful orchestration:** LangGraph separates weather, retrieval, model, and validation nodes. Validation failures rerun only the required nodes.
- **Observability:** Every analysis returns a `trace_id`, model-attempt count, validation result, and per-node timing events.
- **Automated evaluation:** Versioned cases measure schema validity, retrieval coverage, grounding, constraint compliance, retries, and latency.
- **Privacy-aware processing:** Raw face images remain in request-scoped memory and are excluded from LangGraph state and LangSmith traces.
- **Production deployment:** The frontend runs on Vercel; FastAPI and PostgreSQL run on Render with GitHub-triggered deployment.

## Architecture

```mermaid
flowchart TB
    subgraph A["1. Perception and Input"]
        U["User preferences<br/>allergies / budget / texture"]
        S["Multi-angle face scan"]
        M["MediaPipe quality gates<br/>front / left / right"]
        S --> M
    end

    subgraph B["2. LangGraph Orchestration"]
        W["Weather context"]
        R["Product RAG"]
        L["Multimodal skin analysis"]
        G["Grounding and validation"]
        W --> R --> L --> G
        G -. "validation feedback" .-> L
    end

    subgraph C["3. Knowledge and Output"]
        DB["PostgreSQL + pgvector<br/>Open Beauty Facts"]
        O["Personalized report<br/>skin insights / grounded products"]
    end

    U --> W
    M --> L
    DB <--> R
    G --> O
```

The architecture separates probabilistic and deterministic responsibilities:

| Layer | Responsibility |
| --- | --- |
| Model | Visual interpretation, reasoning, explanation, and personalized writing |
| Retrieval | Candidate discovery from a real product catalog |
| Rules | Budget, market, fragrance, and avoided-ingredient filtering |
| Validator | Schema checks, catalog ID grounding, field normalization, and retry routing |
| Evaluation | Quality metrics, failure attribution, latency tracking, and regression comparison |

## LangGraph Workflow

Each `/api/analyze` request receives a unique `trace_id` and follows this graph:

```text
weather_context
→ product_retrieval
→ model_analysis
→ result_validation
   ├─ pass: return report
   └─ fail: retry model_analysis with validation feedback, maximum 2 attempts
```

Weather and retrieval nodes are not repeated when only the model output fails validation. If RAG is enabled but no product satisfies the constraints, the validator returns an empty recommendation list instead of allowing free-form product invention.

Raw biometric images stay outside graph state in temporary request memory. Cross-request image checkpoints are intentionally disabled until encryption, retention, deletion, and consent policies are defined.

## Product RAG

The current catalog pipeline uses Open Beauty Facts as prototype data:

1. Normalize product identity, brand, category, ingredients, market, source URL, and available metadata.
2. Build retrieval documents and generate 1536-dimensional `text-embedding-3-small` vectors.
3. Store vectors in PostgreSQL with a pgvector HNSW cosine index.
4. Apply deterministic market, budget, fragrance, and avoided-ingredient filters.
5. Retrieve up to 12 semantic candidates.
6. Mark catalog content as untrusted data before prompt injection.
7. Validate every returned `catalog_id` and replace model-generated product fields with canonical database values.

Render initializes the schema automatically. An empty catalog triggers a retryable background import of up to 300 products. Status is available at:

```http
GET /api/catalog/status
GET /health
```

See [backend/RAG.md](backend/RAG.md) for schema and import details.

## Face Capture

The scanner is a quality-controlled visual state machine:

- The front-view stage verifies framing and minimum face size.
- Side-view stages estimate yaw from landmarks and wait for a clear profile.
- Each stage samples multiple frames and selects stronger candidates.
- High-resolution facial-zone crops preserve details such as pores, texture, redness, and dryness.
- Completion automatically advances to preference collection.
- Uploaded face images are not persisted by the application backend.

## Evaluation

The evaluation system contains 12 versioned text-only cases covering:

- low budgets;
- multiple avoided ingredients;
- fragrance-free preferences;
- texture preferences;
- different climates;
- missing-location fallback.

Measured quality dimensions include:

- required JSON schema validity;
- retrieval candidate availability;
- recommendation presence;
- catalog grounding;
- avoided-ingredient compliance;
- fragrance, budget, and texture compliance when catalog evidence is available;
- user-concern coverage.

Measured performance dimensions include:

- average, median, and P95 end-to-end latency;
- per-node LangGraph latency;
- model retry rate;
- retrieval error rate;
- deltas against an earlier baseline.

Live evaluation writes a checkpoint after every request and supports resume without repeating completed paid calls.

```powershell
cd backend

# Dataset validation without paid API calls
python -m evaluation.runner --mode validate

# Small live smoke test
python -m evaluation.runner --mode live --runs 3 `
  --base-url https://your-service.onrender.com

# Resume an interrupted live run
python -m evaluation.runner --mode live --runs 10 `
  --base-url https://your-service.onrender.com --resume
```

### Reviewed Baselines

**Initial 30-run baseline**

- 30 requests attempted;
- 7 workflows completed before Anthropic billing was exhausted;
- upstream failures exposed the need for safe provider-level error attribution;
- evaluation identified zero-candidate recommendation hallucination and triggered deterministic protection.

**Claude 10-run smoke baseline after billing recovery**

- workflow availability: **10/10**;
- required schema validity: **100%**;
- measurable catalog grounding: **100%**;
- user-concern coverage: **100%**;
- RAG retrieval errors: **0**;
- end-to-end quality gate: **4/10**;
- average model-node latency: **105.1 seconds**;
- average retrieval-node latency: **0.66 seconds**.

All four cases without a fragrance-free requirement retrieved candidates and passed. All six fragrance-free cases returned zero candidates because Open Beauty Facts has sparse verified fragrance metadata. The 40% quality-gate result therefore identifies a catalog coverage problem, not a 40% model-accuracy claim.

**Retrieval fix (post-baseline, not yet re-measured):** Root-cause analysis traced the six zero-candidate cases to the fragrance-free retrieval filter, which required `fragrance_free IS TRUE` and therefore excluded rows where the field is `NULL` (unlabeled). This treated "unknown" as "contains fragrance" and was inconsistent with the evaluation metric, which counts unlabeled candidates as acceptable. The filter now uses `fragrance_free IS NOT FALSE` — it keeps confirmed fragrance-free and unlabeled products and only excludes confirmed-fragranced ones, while the avoided-ingredients filter still blocks explicitly fragranced items. The quality gate above (4/10) reflects the pre-fix state; an updated baseline will be re-run before the numbers here are revised.

Reviewed reports:

- [Initial live baseline](backend/evaluation/baselines/2026-06-11-live-baseline.md)
- [Claude 10-run smoke baseline](backend/evaluation/baselines/2026-06-11-claude-10-smoke.md)
- [Evaluation documentation](backend/evaluation/README.md)

## Reliability and Safety

- Maximum six images, 10 MB each, 20 MB total.
- Structured JSON output with retries and `json-repair`.
- RAG degradation does not block skin analysis.
- Zero RAG candidates cannot produce ungrounded product recommendations.
- Upstream failures return safe `503` error metadata instead of opaque `500` responses.
- Catalog data is labeled as untrusted prompt context.
- Product source URLs remain attached to grounded recommendations.
- Raw face images are not persisted or sent to LangSmith.

## Technology

**Frontend**

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- MediaPipe Tasks Vision
- Radix UI, Lucide Icons
- html2canvas and browser print export

**Backend and AI**

- Python, FastAPI, Pydantic, HTTPX
- Anthropic Claude and optional OpenAI GPT-4o
- LangChain, LangGraph, optional LangSmith tracing
- OpenAI `text-embedding-3-small`
- PostgreSQL, pgvector, asyncpg
- OpenWeather, Open Beauty Facts, Serper

**Deployment**

- Vercel frontend
- Render FastAPI service and PostgreSQL
- GitHub Actions evaluation gate

## Local Setup

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Core environment variables:

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

Optional LangSmith tracing:

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=skinsense-ai
```

Initialize and import the catalog:

```powershell
python -m scripts.init_rag_db
python -m scripts.import_open_beauty_facts --limit 300
```

### Frontend

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL="http://localhost:8000"
npm run dev
```

Open `http://localhost:3000`.

## Verification

```powershell
cd backend
python -m unittest discover -s tests -v
```

Current verification:

- **21 backend unit and API tests passing**
- Next.js production build passing
- GitHub Actions `AI Evaluation Gate` enabled for backend pushes and pull requests


## Repository Structure

```text
.
├── frontend/
│   ├── app/                  # Home, scan, preferences, results, login
│   ├── components/           # UI components
│   ├── lib/                  # API client and types
│   └── public/               # Visual assets
├── backend/
│   ├── routers/              # Analysis and catalog APIs
│   ├── services/             # LLM, weather, embeddings, product RAG
│   ├── workflows/            # LangGraph state, nodes, routing, retries
│   ├── evaluation/           # Datasets, metrics, reports, baselines
│   ├── scripts/              # Database and catalog import
│   ├── sql/                  # pgvector schema and indexes
│   └── tests/                # RAG, workflow, API, evaluation tests
└── render.yaml
```

## Data and Medical Disclaimer

Open Beauty Facts is community-maintained prototype data. Commercial use requires reviewed and licensed catalog sources with stronger price, inventory, fragrance, and ingredient coverage.

SkinSense AI provides AI-assisted skincare information and does not replace diagnosis or treatment by a qualified dermatologist.
