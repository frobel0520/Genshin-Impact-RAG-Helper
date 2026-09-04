# Genshin-Impact-RAG-Helper 系統設計文件

| 文件項目 | 內容 |
|---|---|
| 文件版本 | 0.1 SD Baseline Draft |
| 文件日期 | 2026-08-20 |
| 文件狀態 | Approved — SD Review passed 2026-08-20 |
| 上游文件 | [`docs/02-system-analysis.md`](02-system-analysis.md) |
| 適用分支 | `dev` |
| 設計方向 | 固定技術基線、Local-first、fixture-first |

## 1. 設計範圍與已確認限制

本文件把 SA 的需求基線轉成可實作的架構邊界、資料契約、API 契約、ADR 與細粒度 Task DAG。設計只涵蓋 MVP 的本機可執行核心，不建立公開服務營運架構。

已確認限制：

- 核心功能採 Local-first，月度預算為 NT$0。
- `main` 是穩定分支，`dev` 是開發主線。
- 技術基線視為固定前提；本專案不規劃替換模型、Embedding、Vector DB、後端或 UI 的備援路線。
- 本階段不做效能 benchmark、容量測試或模型替換評估；效能不列為本次 SD Review Gate。
- 資料來源的實際擷取介面、授權與保存量仍需依 SA 的 OPEN-01～OPEN-07 完成確認。
- 需求與輸出契約先用 fixture 固定，讓不同 Task 可平行開發；真實資料不作為上游 Task 的必要前置條件。

本文件不捏造尚未提供的模型名稱、版本或框架版本。`T00` 已將實際固定基線補入決策紀錄；後續 Task 依本文件的契約與 fixture 進行，不比較替代方案。

## 2. 固定基線與邊界

### 2.1 固定基線登錄

| 項目 | 固定內容 | 狀態／責任 |
|---|---|---|
| 作業環境 | Windows 10、Intel i7-12700KF、31.8 GB RAM、RTX 3060 12 GB VRAM | 已確認 |
| 語言與資料格式 | 繁體中文；來源、版本、時間與權利欄位必須可追溯 | 已確認 |
| LLM／推論器 | Ollama 0.32.14；`qwen2.5-coder:14b`；digest `9ec8897f747e246e970bc5cfdda85d22f1123dc2e3d34978a010a75968716849`；Q4_K_M、14.8B、32K context | 已驗證；不做替代比較 |
| Embedding | Ollama 0.32.14；`bge-m3:latest`；digest `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab`；1024 dimensions | 已下載並完成 API smoke test；不做替代比較 |
| Structured Store | Node `node:sqlite` `DatabaseSync` | 固定；Node 顯示 experimental warning |
| Vector DB／索引 | SQLite BLOB 儲存向量 + Node `Float32Array` cosine scorer；不引入外部 Vector DB | 固定；不做替代比較 |
| 後端／UI | Node built-in `node:http` + 靜態 HTML／CSS／ES modules | 固定；不引入替代框架 |
| 測試 | Node built-in `node:test` | 固定 |
| 外部部署 | 不屬 MVP 核心相依 | 排除 |

### 2.2 元件責任邊界

```mermaid
flowchart LR
    S1[HoYoLAB] --> ING[Source Ingest]
    S2[genshin-db] --> ING
    S3[Fandom Wiki] --> ING
    ING --> VAL[Validate and Normalize]
    VAL --> STRUCT[(Structured Store)]
    VAL --> DOC[(Document Store)]
    DOC --> IDX[(Fixed Vector Index)]
    Q[繁中問題] --> API[Query API]
    API --> CLS[Query Classifier]
    CLS --> RET[Retrieval Orchestrator]
    STRUCT --> RET
    IDX --> RET
    RET --> POL[Evidence and Answer Policy]
    POL --> OUT[Answer Contract]
    OUT --> UI[Local UI]
    OUT --> LOG[(Query and Evaluation Logs)]
```

| 元件 | 責任 | 不負責 |
|---|---|---|
| Source Ingest | 取得或載入來源快照，保留來源識別與擷取資訊 | 生成答案、決定 UI 呈現 |
| Validate／Normalize | 欄位驗證、名稱／別名正規化、版本與權利欄位檢查 | 自行修補缺失事實 |
| Structured Store | 保存可精確查詢的實體、欄位、主張與版本 | 長篇敘述切 chunk |
| Document Store／Vector Index | 保存文件單位、chunk 與固定索引 | 決定來源權威性 |
| Query Classifier | 辨識類別、實體、別名、版本／時間與劇透要求 | 產生沒有證據的答案 |
| Retrieval Orchestrator | 依分類讀取結構化資料／檢索證據並產出 Evidence Bundle | 修改來源內容 |
| Evidence and Answer Policy | 執行來源優先級、版本、衝突、拒答與引用規則 | 自行調高證據不足的信心 |
| Answer Contract | 固定回答、拒答、引用與錯誤的輸出格式 | 保存秘密或個人資料 |
| Query／Evaluation Logs | 保存可診斷的查詢、證據、引用與評估結果 | 保存 API 金鑰、帳號或密碼 |

### 2.3 依賴方向規則

依賴只能由上游契約流向下游實作：

```text
Domain Contracts → Data Contracts → Query Contracts → API/UI Integration
                 ↘ Evaluation Contracts → Test/Release Gate
```

禁止下列耦合：

- UI 直接讀取 Structured Store 或 Vector Index。
- Answer Policy 直接呼叫來源網站。
- Evaluator 依賴 UI DOM 或真實外部來源才能執行。
- Ingest Task 以模型輸出作為資料正確性的唯一依據。
- 任一資料來源的專用欄位滲透到通用 Query／Answer Contract。

### 2.4 T00 固定基線紀錄（2026-08-21）

T00 已完成本機基線盤點與固定值登錄：

- Node.js `24.14.1`、npm `11.12.1`。
- Ollama `0.32.14`；`qwen2.5-coder:14b` 可用於固定本機生成基線。
- Ollama `bge-m3:latest` 已下載約 1.2 GB；`/api/embed` 對繁中 smoke input 回傳 1 個 1024 維向量。
- GPU 為 NVIDIA GeForce RTX 3060、12,288 MiB；只作硬體記錄，不執行效能驗證。
- Node `node:sqlite` 可載入 `DatabaseSync`；experimental warning 接受為固定基線的一部分。
- Python Windows Store alias 無法執行，不列入基線；Docker 可用但不列入核心啟動路徑。

### 2.5 本機啟動命令契約

T01 建立程式骨架後，預期使用下列命令啟動；T00 只先固定命令與環境變數名稱，不宣稱 `src/server.js` 已存在：

```powershell
# 1. 確認 Ollama 服務可用（若桌面服務尚未啟動，再執行 ollama serve）
Invoke-RestMethod http://127.0.0.1:11434/api/tags
ollama list

# 2. 啟動本機應用（T01 建立 src/server.js 後）
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
node --env-file=.env src/server.js
```

必要模型固定為 `qwen2.5-coder:14b` 與 `bge-m3:latest`；啟動前若缺少任一模型，應直接失敗並指出模型名稱，不下載替代模型。

## 3. 領域與資料模型

以下是邏輯模型；實際資料庫語法、索引型別與欄位命名在實作 Task 中依固定基線落地，不在此提前綁定特定 ORM。

### 3.1 核心實體

| 實體 | 主要欄位 | 用途 |
|---|---|---|
| `SourceDocument` | `source_id`, `source_kind`, `source_url`, `title`, `published_at`, `retrieved_at`, `game_version`, `locale`, `rights_note`, `content_hash` | 來源文件與快照追溯 |
| `CanonicalEntity` | `entity_id`, `entity_type`, `canonical_name`, `aliases`, `locale` | 角色、武器、素材、任務、地區等正規化實體 |
| `StructuredFact` | `fact_id`, `entity_id`, `field_key`, `value`, `unit`, `game_version`, `source_id`, `validity` | 可精確查詢的欄位／數值 |
| `Claim` | `claim_id`, `claim_key`, `entity_id`, `claim_text`, `game_version`, `source_id`, `authority_rank`, `conflict_group_id` | 敘述性主張與衝突比對 |
| `DocumentChunk` | `chunk_id`, `source_id`, `document_locator`, `text`, `token_hint`, `game_version`, `entity_ids` | 可檢索文件單位 |
| `QueryRun` | `query_id`, `question`, `query_category`, `parsed_constraints`, `created_at` | 查詢與分類紀錄 |
| `EvidenceItem` | `evidence_id`, `query_id`, `source_id`, `chunk_id?`, `fact_id?`, `rank`, `score?`, `support_type` | 回答使用的證據集合 |
| `AnswerRun` | `answer_id`, `query_id`, `answer_status`, `answer_text`, `version_scope`, `uncertainty_reason`, `spoiler_level` | 最終回答或拒答 |
| `Citation` | `answer_id`, `evidence_id`, `source_url`, `title`, `published_at`, `retrieved_at`, `game_version` | 對外引用 |
| `EvalCase` | `case_id`, `question_zh_tw`, `category`, `query_type`, `answerability`, `expected_answer`, `required_facts`, `expected_sources`, `game_version`, `refusal_reason` | 版本化驗收題庫 |
| `EvalResult` | `case_id`, `run_id`, `retrieved_evidence`, `answer`, `citations`, `metric_labels`, `human_review` | 評估結果與人工複核 |

### 3.2 識別與版本規則

- `entity_id`、`source_id`、`fact_id`、`claim_id`、`query_id`、`answer_id` 與 `case_id` 必須穩定且可在日志中關聯。
- `canonical_name` 不取代來源原文；別名與原文均需保留。
- `game_version` 可為明確版本、版本範圍或 `unknown`；`unknown` 不得被當成目前版本。
- `validity` 至少能表達 active、superseded、unknown 或 conflict；不同版本的事實不可互相覆蓋。
- `authority_rank` 固定對應 HoYoLAB=1、genshin-db=2、Fandom=3；時間只能在同等可適用性下作為排序因素。
- `content_hash` 用於偵測同一來源內容的重複匯入，不作為事實正確性的判定。

### 3.3 衝突模型

同一 `claim_key`、實體與適用版本可有多筆 `Claim`。系統依下列順序處理：

1. 先過濾版本與 locale 不適用的主張。
2. 依 `authority_rank` 排序，再比較來源發布／擷取時間。
3. 若一筆主張可明確支配其他主張，輸出支配主張並保留必要引用。
4. 若無法支配，建立 `conflict_group_id`，輸出衝突或拒答，不產生單一肯定答案。

## 4. 資料流程與不變條件

### 4.1 匯入流程

```text
Source Snapshot
  → Source Metadata Validation
  → Content/Schema Validation
  → Name and Alias Normalization
  → Version and Rights Annotation
  → Structured Fact / Claim Extraction
  → Document Chunking
  → Fixed Index Build
  → Fixture / Integrity Report
```

每一階段必須產出可被下一階段讀取的檔案或資料契約；失敗項目停止進入下一階段，不以模型補值。

### 4.2 匯入不變條件

- 沒有 `source_url` 與 `retrieved_at` 的資料不可進入可回答索引。
- 沒有 `game_version` 的資料可以保存，但回答必須標示版本未知。
- 無法辨識實體的文字可保留為未分類文件，但不得被當成精確結構化事實。
- 驗證失敗的批次不得部分覆蓋既有有效資料；採批次版本或可回復的發布邊界。
- 任何可回答的 `StructuredFact` 或 `Claim` 都必須能反查到 `SourceDocument`。

### 4.3 查詢流程

```text
Question
  → Parse constraints / aliases / spoiler
  → Classify query type
  → Structured lookup and/or fixed index retrieval
  → Build EvidenceBundle
  → Apply version / authority / conflict policy
  → Answer, uncertainty, refusal, or error
  → Attach citations and write QueryRun/AnswerRun
```

## 5. 契約設計

### 5.1 QueryRequest

```json
{
  "question": "雷電將軍的元素爆發是什麼？",
  "locale": "zh-TW",
  "game_version": null,
  "spoiler_level": "notice",
  "request_id": "client-generated-or-server-generated"
}
```

規則：`question` 必填且不得為空；`locale` 預設 `zh-TW`；`game_version=null` 表示由系統嘗試判定，但不能默認為最新版本；`spoiler_level` 只影響輸出提示，不得改變證據優先級。

### 5.2 QueryPlan

```text
query_category: structured | narrative | version | composite | out_of_scope
normalized_entities: [{ entity_id?, text, entity_type?, resolution_status, aliases_used[] }]
version_constraint: exact | range | current-unspecified | unknown
retrieval_mode: structured | document | hybrid | none
spoiler_level: none | notice | explicit
```

`normalized_entities` 另需帶 `resolution_status: resolved | unrecognized`。`resolved` 必須同時帶有 typed `entity_id` 與 `entity_type`；`unrecognized` 不得帶任何 entity identity（欄位可省略或為 `null`）。`QueryPlan` 是 Query Classifier 與 Retrieval Orchestrator 之間的固定契約；下游不得重新猜測已解析的限制。

### 5.3 EvidenceBundle

```text
query_id: string
items:
  - evidence_id: string
    source_id: string
    source_kind: hoyolab | genshin-db | fandom
    source_url: string
    source_title: string
    source_published_at?: datetime
    source_retrieved_at: datetime
    game_version?: string
    fact_id?: string
    claim_id?: string
    chunk_id?: string
    rank: integer
    support_type: direct | contextual | conflicting
conflict_groups: [{ conflict_group_id, claim_ids[] }]
```

`EvidenceBundle` 可以由 fixture 建立；Answer Policy 不應依賴真實 Vector DB 才能測試。

### 5.4 AnswerResponse

```text
answer_status: answered | uncertain | refused | error
answer_text: string
query_category: structured | narrative | version | composite | out_of_scope
citations: [{ source_url, title, source_kind, published_at?, retrieved_at?, game_version? }]
version_scope: string | unknown
uncertainty_reason?: insufficient_evidence | source_conflict | version_unknown | out_of_scope | entity_unknown
spoiler_notice?: string
trace_id: string
```

不變條件：

- `answered` 的 `citations` 不得為空。
- `uncertain`／`refused` 必須有原因或可理解的限制說明。
- `error` 只表示系統故障，不可把故障包裝成資料拒答。
- `trace_id` 必須能反查 QueryRun、EvidenceBundle 與 AnswerRun。
- `EvidenceItem.source_id` 是內部穩定來源關聯欄位，必填；公開 `Citation` 是來源 metadata projection，不暴露 `source_id`、`evidence_id` 或 `answer_id`。
- Answer Formatter 必須以內部 `evidence_id`／`answer_id` 建立追溯映射，並以 `trace_id` 對外關聯 AnswerRun；純契約 validator 不負責驗證跨物件 membership。

### 5.5 Maintainer／Evaluator 契約

T10 將 `IngestRequest` 的來源批次驗證固定為以下最小 envelope：

```json
{
  "schema_version": 1,
  "documents": ["SourceDocument"]
}
```

- `documents` 必須是非空陣列；單筆欄位沿用 T03 `SourceDocument` validator。
- 同一批次的 `source_id` 與 `content_hash` 必須唯一；重複值需回傳可分類錯誤。
- 缺欄位、格式、版本與 `rights_note` 錯誤保留巢狀路徑，供維護者定位批次項目。
- T10 只做輸入邊界驗證，不執行來源抓取、名稱正規化、法律權利判定或索引建立。

T11 名稱／別名 normalizer 固定以下輸出邊界：

```json
{
  "schema_version": 1,
  "ruleset_version": 1,
  "source_text": "來源原文",
  "normalized_text": "CanonicalEntity.canonical_name 或整理後未知名稱",
  "normalized_key": "穩定比較鍵",
  "locale": "zh-TW",
  "resolution": "EntityResolution"
}
```

- `source_text` 必須原樣保留；`normalized_text` 使用 NFKC、去除首尾空白並將連續空白折疊為一格。
- `normalized_key` 在上述整理後再以小寫建立；已辨識名稱統一使用 canonical name 的 key。
- 繁簡差異、常見拼寫與其他語言名稱只透過 `CanonicalEntity.aliases` 的明確字典匹配；T11 不做模糊、音近或外部翻譯猜測。
- 未知名稱保留其原文與整理結果，`resolution.resolution_status` 為 `unrecognized`，不得產生 entity identity。
- 不同實體產生相同 normalized key 時，字典建立失敗；不可用陣列順序猜測唯一實體。

維護與評估命令共用下列最小輸出：

```text
run_id: string
input_version: string
started_at: datetime
finished_at: datetime
status: passed | failed | partial
errors: [{ code, message, source_id?, case_id? }]
artifacts: [{ path, content_hash, kind }]
```

命令失敗時必須回傳非零狀態或等價失敗結果；不可產生看似成功的空索引或空評估報告。

## 6. API 邊界

以下是邏輯 API；路由前綴與序列化方式由固定基線的 T00 登錄，不在此假設特定框架。

| Endpoint | 用途 | 主要契約 | 依賴 |
|---|---|---|---|
| `GET /health` | 本機啟動／資料版本健康檢查 | `HealthResponse` | T00、資料狀態 |
| `POST /api/v1/query` | 玩家問答 | `QueryRequest` → `AnswerResponse` | QueryPlan、EvidenceBundle、Answer Policy |
| `POST /api/v1/ingest/validate` | 維護者驗證輸入批次 | `IngestRequest` → `RunResponse` | SourceDocument、Validator |
| `POST /api/v1/ingest/build` | 維護者建立結構化資料／固定索引 | `IngestRequest` → `RunResponse` | Normalize、Store、Index |
| `POST /api/v1/evals/run` | 執行固定題庫評估 | `EvalRunRequest` → `EvalRunResponse` | EvalCase、Query API、Metrics |
| `GET /api/v1/runs/{run_id}` | 讀取維護／評估結果 | `RunResponse` | Logs／Artifacts |

API 邊界規則：

- Query API 不直接暴露來源抓取或索引內部欄位。
- Ingest／Eval 是本機維護路徑，不收集玩家帳號或登入資訊。
- 所有 endpoint 的錯誤需使用可分類的 error code；不得將 stack trace 直接輸出給玩家。
- UI 只能依 `AnswerResponse` 呈現回答、引用、版本與拒答，不自行重建來源連結。

## 7. ADR（Architecture Decision Records）

### ADR-001：Local-first 與零月費核心

**狀態**：Accepted（承接計畫書）

**決策**：核心推論、Embedding、資料儲存、索引與評估均以本機可重現流程為基準；外部服務不得成為持續運作的必要條件。

**理由**：符合 NT$0 預算、隱私與可重現性目標。

**影響**：安裝與硬體限制由 README／T00 明確記錄；不承諾 24/7 公開服務。

### ADR-002：結構化優先，敘述性問題走檢索

**狀態**：Accepted（承接 SA）

**決策**：精確數值／欄位先走 Structured Store；任務、故事與世界觀走 Document／Vector Index；複合問題拆分後分別處理。

**理由**：減少模型自行計算與幻覺，讓不同資料型態可獨立驗收。

**影響**：需要維護實體／別名字典與兩條證據管線。

### ADR-003：來源權威性與版本共同決定主張

**狀態**：Accepted（承接 SA）

**決策**：HoYoLAB > genshin-db > Fandom；先過濾適用版本，再以權威性與時間處理；無法定案時輸出衝突／拒答。

**理由**：避免新舊版本與不同來源被無提示混合。

**影響**：所有 Claim／Fact 必須保留來源、版本、發布／擷取時間與 conflict group。

### ADR-004：Evidence-carrying Answer Contract

**狀態**：Accepted（承接 SA）

**決策**：所有回答先形成 EvidenceBundle，再由 Answer Policy 產生 `AnswerResponse`；非拒答答案必須有引用。

**理由**：把檢索品質與生成品質分開驗收，並支援拒答與人工追溯。

**影響**：UI、API、評估與日誌共用同一輸出契約。

### ADR-005：固定技術基線，不建立替換路線

**狀態**：Accepted（本次方向）

**決策**：MVP 固定採 Ollama `qwen2.5-coder:14b`、Ollama `bge-m3:latest`、Node `node:sqlite`、SQLite BLOB cosine index、Node built-in HTTP／靜態 UI 與 `node:test`；不做效能 benchmark、不比較替代方案、不保留第二套實作路線。

**理由**：專案資源有限，優先完成可跑且正確的端到端契約；使用者明確要求不做效能驗證與替換規劃。

**影響**：若固定基線日後不可用，需另開 Change Request；本 SD 不承諾替換成本或效能門檻。

### ADR-006：Fixture-first 與任務契約解耦

**狀態**：Accepted（本次方向）

**決策**：先固定 Domain、Data、Query、Evidence、Answer、Eval 契約，再以 fixture 驗證各 Task；真實來源與 UI 不作為所有下游工作的必要依賴。

**理由**：讓資料、檢索、回答、評估與 UI 可平行開發，減少互相等待。

**影響**：fixture 必須標示為測試資料，不得誤發布成真實來源；整合 Gate 最後再接真實資料。

### ADR-007：明確的 Entity Resolution 與公開引用脫敏

**狀態**：Accepted（2026-08-22）

**決策**：T07 `normalized_entities` 使用必填 `resolution_status`；`resolved` 必須同時具備 `entity_id`／`entity_type`，`unrecognized` 不得攜帶 entity identity。T08 EvidenceItem 強制保存 typed `source_id`；公開 Citation 維持 metadata projection，內部 `evidence_id`／`answer_id` 由 Answer Formatter 與 `trace_id` 建立映射，不直接暴露給玩家。

**理由**：避免 partial entity identity 進入結構化檢索，並在不暴露索引／執行內部 ID 的前提下保留可追溯性。

**影響**：T07 與 T08 fixture schema version 升為 `2`；T15、T16、T20、T26 必須遵守狀態與 traceability mapping。

## 8. 細粒度 Task Breakdown

### 8.1 Task 定義規則

每個 Task 只允許一個主要交付物與一個驗收邊界；Task 不跨越多個 owner 邊界。每個 Task 必須能單獨在分支中完成、測試或文件驗證，並列出硬依賴。`depends_on` 不得形成循環。

Task 狀態：`Planned → In Progress → Review → Done`。若等待的是最終真實來源、模型輸出或 E2E Gate，仍可先以 fixture 開發，不標記為 blocked。

T00 狀態：**Done**。固定基線、模型 digest、embedding smoke test 與本機啟動命令契約已記錄；T01 接續建立程式骨架。

### 8.2 Task 清單

| ID | Task／單一交付物 | 完成條件 | depends_on | 可平行線 |
|---|---|---|---|---|
| T00 | 登錄固定技術基線與本機啟動命令 | ADR-005 的實際名稱／版本、啟動／停止方式與必要環境變數已記錄 | — | Foundation |
| T01 | 建立專案目錄與模組邊界 | 目錄骨架、命名規則、最小啟動入口與禁止跨層依賴檢查 | T00 | Foundation |
| T02 | 建立 Domain enum／ID 契約 | 實體類型、來源類型、回答狀態、版本狀態與錯誤碼 fixture | — | Contract |
| T03 | 建立 SourceDocument／權利 metadata 契約 | 欄位 schema、必填規則、content hash 與範例 fixture | T02 | Data |
| T04 | 建立 CanonicalEntity／Alias 契約 | 正規化名稱、別名、locale 與未辨識狀態 fixture | T02 | Data |
| T05 | 建立 StructuredFact／Claim／Conflict 契約 | 主張鍵、版本、權威級別、衝突群組與排序規則測試 | T02、T03 | Data |
| T06 | 建立 DocumentChunk 契約 | 文件 locator、chunk metadata、版本與實體關聯 fixture | T03 | Data |
| T07 | 建立 QueryRequest／QueryPlan 契約 | 查詢分類、版本限制、劇透與 retrieval mode 的 schema 測試 | T02 | Query |
| T08 | 建立 EvidenceBundle／AnswerResponse 契約 | `answered`／`uncertain`／`refused`／`error` 不變條件測試 | T02、T03、T07 | Query |
| T09 | 建立 EvalCase／EvalResult 契約 | 50 題欄位模板、指標 label、人工複核欄位與範例 | T02、T08 | Evaluation |
| T10 | 建立來源匯入 validator | 缺欄位、格式、重複、版本與權利欄位錯誤可被分類 | T03 | Data |
| T11 | 建立名稱／別名 normalizer | 來源原文保留、正規化結果穩定、未知名稱可追蹤 | T04、T10 | Data |
| T12 | 建立 fixture source pack | 三來源的最小測試快照、版本、衝突與拒答資料 | T03、T05、T06 | Data |
| T13 | 建立 Structured Store 存取層 | `StructuredFact`／`Claim` 可依實體、欄位與版本查詢 | T05、T12 | Data |
| T14 | 建立 Document Store／固定索引建立命令 | `DocumentChunk` fixture 可建索引、清單與 hash 可驗證 | T06、T12 | Retrieval |
| T15 | 建立 Query Classifier | T07 fixture 可分類 structured／narrative／version／out_of_scope | T04、T07 | Query |
| T16 | 建立 Structured Retrieval | 依 QueryPlan 查欄位並輸出 EvidenceBundle | T08、T13、T15 | Retrieval |
| T17 | 建立 Document Retrieval | 依 QueryPlan 從固定索引輸出 EvidenceBundle | T08、T14、T15 | Retrieval |
| T18 | 建立 Conflict／Version Policy | 以 T05 fixture 驗證權威級別、版本與衝突拒答 | T05、T08 | Policy |
| T19 | 建立 Refusal／Scope Policy | out_of_scope、insufficient、unknown entity、version unknown 可分類 | T07、T08 | Policy |
| T20 | 建立 Answer Formatter | EvidenceBundle 轉 AnswerResponse，引用與原因欄位完整 | T08、T18、T19 | Policy |
| T21 | 建立 Query Orchestrator | 依 QueryPlan 合併 structured／document EvidenceBundle | T15、T16、T17、T18 | Query |
| T22 | 建立 Query API | `POST /api/v1/query` 可用 fixture 完成 answered／refused／error | T20、T21、T00 | API |
| T23 | 建立 Health API | `GET /health` 回報固定基線與資料版本狀態 | T00、T13、T14 | API |
| T24 | 建立 Ingest validate／build CLI | validator、normalizer、store、index 可依順序執行並產出 RunResponse | T10、T11、T13、T14 | Ingest |
| T25 | 建立 Evaluation Runner | 讀取 EvalCase、呼叫 Query contract、輸出 EvalResult 與指標 | T09、T21、T22 | Evaluation |
| T26 | 建立查詢／評估 log adapter | QueryRun、AnswerRun、Evidence、EvalResult 可關聯且無秘密 | T08、T09、T22、T25 | Observability |
| T27 | 建立 UI 查詢頁 | UI 只依 AnswerResponse 顯示回答、引用、版本、拒答與劇透提示 | T22、T23 | UI |
| T28 | 建立 CI mock／contract tests | 無真實模型／來源時可跑 schema、policy、API、eval contract tests | T08、T09、T22、T25 | Quality |
| T29 | 建立真實來源匯入設定 | 已確認的來源介面、授權、保存量與更新程序形成可執行設定 | T10、T11、T12、T24、OPEN-01、OPEN-06 | Integration |
| T30 | 建立 50 題正式題庫 | 40 可回答／10 拒答完成人工標註、來源、版本與 fixture mapping | T09、T12、T24、OPEN-01、OPEN-06 | Evaluation |
| T31 | 執行 MVP E2E Release Gate | 真實資料匯入、UI 查詢、引用、拒答、評估報告與 DoD evidence 齊全 | T27、T28、T29、T30 | Release |

### 8.3 依賴 DAG

```mermaid
flowchart TD
    T00[T00 固定基線] --> T01[T01 骨架]
    T02[T02 Domain 契約] --> T03[T03 Source metadata]
    T02 --> T04[T04 Entity/Alias]
    T02 --> T07[T07 QueryPlan]
    T02 --> T09[T09 Eval 契約]
    T03 --> T05[T05 Fact/Claim/Conflict]
    T03 --> T06[T06 Chunk 契約]
    T03 --> T10[T10 Validator]
    T04 --> T11[T11 Normalizer]
    T05 --> T13[T13 Structured Store]
    T06 --> T14[T14 Fixed Index]
    T03 --> T12[T12 Fixture pack]
    T05 --> T12
    T06 --> T12
    T07 --> T15[T15 Classifier]
    T08[T08 Evidence/Answer 契約] --> T16[T16 Structured retrieval]
    T08 --> T17[T17 Document retrieval]
    T05 --> T18[T18 Conflict/version policy]
    T07 --> T19[T19 Refusal/scope policy]
    T08 --> T20[T20 Formatter]
    T15 --> T16
    T15 --> T17
    T18 --> T20
    T19 --> T20
    T16 --> T21[T21 Orchestrator]
    T17 --> T21
    T20 --> T22[T22 Query API]
    T21 --> T22
    T00 --> T22
    T00 --> T23[T23 Health API]
    T13 --> T24[T24 Ingest CLI]
    T14 --> T24
    T10 --> T24
    T11 --> T24
    T09 --> T25[T25 Eval runner]
    T21 --> T25
    T22 --> T25
    T22 --> T26[T26 Logs]
    T25 --> T26
    T22 --> T27[T27 UI]
    T09 --> T28[T28 CI contracts]
    T22 --> T28
    T25 --> T28
    T24 --> T29[T29 Real source config]
    T24 --> T30[T30 50-case dataset]
    T09 --> T30
    T27 --> T31[T31 E2E gate]
    T28 --> T31
    T29 --> T31
    T30 --> T31
```

### 8.4 可平行化分組

在 T02、T03、T07、T08、T09 契約完成後，可採以下平行線：

| 平行線 | 可工作的 Task | 不應直接依賴 |
|---|---|---|
| Data | T10～T14、T24 | UI、真實 LLM 回答 |
| Query／Policy | T15～T23 | 真實來源網站、UI DOM |
| Evaluation | T09、T25、T28、T30 | UI 完成、正式來源全量匯入 |
| UI | T27 | 真實模型品質；使用 AnswerResponse fixture |
| Integration | T29、T31 | 未完成的契約變更 |

### 8.5 Task 完成條件模板

每個實際 issue／分支應填寫：

```text
Task ID:
Goal:
Input contract:
Output artifact:
depends_on:
Out of scope:
Acceptance checks:
Fixture or test data:
Evidence path:
```

若 Task 需要修改上游契約，必須先提出 Change Request；不得在下游實作中偷偷改 schema。

## 9. 測試與 Release 邊界

### 9.1 測試層級

| 層級 | 內容 | 是否依賴真實來源／模型 |
|---|---|---:|
| Contract | schema、enum、錯誤碼、回答不變條件 | 否 |
| Unit | normalizer、validator、排序、版本／衝突／拒答 policy | 否 |
| Component | store、index、retrieval、formatter | fixture 即可 |
| API | Query、Health、Ingest、Eval endpoint | fixture 即可 |
| Integration | 真實來源匯入、固定基線、本機 UI | 是 |
| Release Gate | 50 題、引用、拒答、DoD evidence | 是 |

本次 SD 不加入效能測試層級，不設定延遲、吞吐、VRAM 或容量門檻。

### 9.2 Release Gate 輸入

Release Gate 只檢查 SA 已核准的功能／品質項目：回答正確率、Recall@5、Groundedness、正確拒答率與非拒答來源率。效能不在本次 Gate；若未來新增，須以 Change Request 加入新的驗收條件。

### 9.3 文件檢索的相似度門檻（T33）

文件檢索原本只做「取相似度前 topK」，沒有下限。排序回答的是「哪些切塊最近」，從來不是「有沒有任何一塊在回答這個問題」，所以語料答不出來的問題仍會拿到最近的鄰居，並且附上引用。這在答案還是模板時無害；T32 讓模型接手寫答案之後就不是無害的——模型會用不相關的證據寫出通順的句子，底下掛著看起來可信的來源。

現在的作法：

- `DOCUMENT_MIN_SCORE` 設定一個 cosine 下限，預設 **0.42**。低於門檻的切塊不進結果。
- 門檻在 topK **之前**套用。答不出來時回傳空 bundle，交由既有的 `insufficient_evidence` 拒答路徑處理，不是產生錯誤。
- 門檻擋掉東西時寫一筆 `retrieval_filtered` 記錄，含考慮數、保留數、最高分與門檻值，掛在該次查詢的 trace 底下。這是正常運作而不是失敗，所以獨立成一個事件，且不計入 failure 計數——否則一個運作正確的系統會在日誌裡看起來是壞的。

**這個值必須跟著語料重量。** 兩個版本的實測紀錄：

| 語料 | 選定值 | 依據 |
|---|---:|---|
| 兩篇手抄公告（T33，50 題） | 0.47 | 走文件檢索的 4 題可回答案例落在 0.532–0.795，語料答不出來的「納塔的火神是誰？」是 0.410，0.47 落在間隙中間 |
| 加入逐字公告與 6 篇 Fandom 條目（T36，59 題） | **0.42** | 掃描 0.47／0.42／0.40／0.35，0.47 會漏掉一題（Recall@5 48/49），其餘三個值都是 49/49。取仍為 100% 的最高值 |

T36 的掃描結果：

| minScore | Recall@5 | 正確拒答率 | 非拒答附來源率 | 引用到 Fandom 的題數 |
|---:|---:|---:|---:|---:|
| 0.47 | 97.96% (48/49) | 100% (10/10) | 100% | 8 |
| **0.42** | **100% (49/49)** | 100% (10/10) | 100% | 9 |
| 0.40 | 100% (49/49) | 100% (10/10) | 100% | 9 |
| 0.35 | 100% (49/49) | 100% (10/10) | 100% | 9 |

⚠️ **同一次掃描暴露了一個回歸：這道門檻不再擋得住「納塔的火神是誰？」。** 在 0.47、0.42、0.40、0.35 四個值下，這題都變成「已回答＋1 筆引用」，而 T33 的驗收條件是它必須拒答、0 筆引用。原因不是門檻值選錯，是語料變大——Fandom 的角色條目提到納塔，相似度因此跨過任何合理的下限。

減輕但沒有解決的部分：模型現在自己說「證據中沒有提到納塔的火神是誰。」，讀者不會被誤導。但 `answer_status` 仍然是 `answered` 並附上引用，系統對自己狀態的宣稱仍然是錯的。

這正是 [#65](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/65)（證據涵蓋度檢查）要處理的問題。 **結果見 §9.5：檢查做出來了，但量到的準確度只夠記錄，不夠當閘門。**

### 9.3.1 模型自述答不出來時，就當作拒答

上面那個訊號現在被接起來了。模型讀過問題也讀過證據，有時會直接說「證據中沒有提到⋯」——把那句話當成答案並附上引用，是對系統狀態的錯誤宣稱，即使讀者不會被文字誤導。

現在的作法：回覆若**整句都是**「答不出來」的陳述，該次查詢改判為 `insufficient_evidence` 拒答、引用歸零，並在 trace 記一筆 `model_reports_no_evidence`，附上模型原話。

判定刻意收得很窄，因為**把真答案誤判成拒答比反過來更糟**：

- 超過 60 字 → 不算。長回覆是散文，這個檢查不去猜哪半重要。
- 有第二個句子 → 不算。模型接著說了別的，那是內容。
- 出現「但／不過／然而／惟」→ 不算。「證據中沒有提到她的生日，但她是水元素角色」先點出缺口再回答，那是答案。

實測：「納塔的火神是誰？」從「已回答＋1 筆引用」變回 `insufficient_evidence` 拒答、0 筆引用，T33 的驗收條件重新成立。59 題重跑，Recall@5、正確拒答率、非拒答附來源率都維持 100%。

這**不等於** #65。它只處理模型自己講出來的那一種。模型沒察覺的那一種現在有 §9.5 的檢查會問，但只記錄不執行。

### 9.4 版本總覽類問題取整份公告（T34）

「5.0版本更新了哪些內容？」問的是整份公告，不是公告裡最像這個問題的幾段。相似度排序在這裡回答錯了問題：它交出前 topK 段，模型照著寫出一個正確但不完整的答案，而沒有任何階段注意到證據不足。

現在的作法：**QueryPlan 的 `query_category` 是 `version`、版本約束為 exact、且沒有解析出任何實體**時，取該版本文件的所有切塊，跳過 topK 與相似度門檻。

三個條件缺一不可。「5.0版本神里綾華的更新內容是什麼？」同樣是 version 類別、同樣是 exact，但它解析出了實體——實體過濾正是重點，把整個版本的段落全部推給模型會埋掉讀者要的那一段。**沒有解析出實體，才代表版本本身就是主題。**

上限由 `versionDocumentMaxChunks` 控制，預設 24。目前兩篇公告是 6 與 7 個切塊，全取很便宜；但語料擴充後若有更長的公告，超過上限就回到排序路徑，答案會是部分的，並由引用如實反映。

實測（T34 後）：`case:version-5-0-changes` 的回答涵蓋三名新角色、秘境、劇情、納塔與四個子區域、武器與更新時間；`case:version-2-1-changes` 涵蓋四名新角色、兩座島嶼、劇情、釣魚系統、武器與更新時間。兩題答案中的每個專有名詞都逐字出現在該版本的切塊裡。

### 9.5 證據涵蓋度檢查：只記錄，不執行（T35）

§9.3 的相似度門檻已經到頂（[`07-scale-test.md` §3.1](07-scale-test.md)），§9.3.1 只接得住模型自己講出來的那一種。剩下的缺口是：**沒有任何階段問過「這批證據回答得了這個問題嗎」。**

現在的作法：在寫答案之前，把問題與**政策階段核可後的證據**交給同一個模型，只要 YES 或 NO。

- 位置在 policy 之後、`composeAnswerText` 之前。判的是答案將要據以書寫的同一份文字——判別的對象不同，結論就是關於別的東西。
- **fail open。** 逾時、錯誤、或回覆不是 YES／NO 一律當 `unknown`，照常回答，並記一筆 `coverage_check_unavailable`。檢查壞掉的代價必須是少一道檢查，不能是讀者莫名其妙被拒絕。
- 成本：每個非拒答查詢多一次模型呼叫。

判定不是行為。`enforceCoverage` 預設 **false**：判 NO 時記一筆 `evidence_may_not_cover_question`，答案照發；打開時記 `evidence_does_not_cover_question`，改判 `insufficient_evidence` 拒答、引用歸零。

#### 為什麼預設不執行

打開執行跑完整 58 題題庫（18 切塊語料，2026-09-04）：

| 準則 | 關閉（預設） | 打開 |
|---|---:|---:|
| Retrieval Recall@5 | 100% (58/58) | **98.28% (57/58)** |
| 無資料正確拒答率 | 100% (10/10) | 100% (10/10) |
| 非拒答答案附來源率 | 100% (58/58) | 100% (57/57) |
| 非拒答題數 | 58 | **57** |

掉的是 `case:kujou-sara-role`。證據裡逐字寫著「天領奉行的將領」，檢查仍判 NO。那是誤判，而且方向最糟——讀者失去一個本來拿得到的答案，拒答看起來卻像系統很謹慎。

換 prompt 與換 seed 都沒有改變任何一格：兩個 system prompt（極簡版，以及明寫「預設 YES、用詞不同不算沒提到」的版本）在四個案例上都是 2/4，seed 1 與 seed 20260902 跑出相同結果。失敗有固定形狀——**問「擔任什麼職務／是做什麼的」，證據用自己的話描述了那個身分但沒有重複問題的用詞，就判 NO**。逐題結果見 [`07-scale-test.md` §5.3](07-scale-test.md)。

結論：這個檢查對的地方是門檻已經接不住的那一題，錯的地方是大約每五十題可回答的問題誤殺一題，而且是可重現的系統性錯誤，不是雜訊。**所以判定寫進 log，答案照發。** 開關留著是為了讓人自己量這個取捨，不是為了隨手打開。

#### 兩個跟 #65 原始構想不同的地方

1. **不抽取「問題有哪些面向」。** [#65](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/65) 列的三條路都要先能表示面向。這裡改成直接問模型一個是非題——便宜、不需要新欄位，而上面的數字說明它目前的準確度撐不起一道閘門。面向抽取沒有被否定，只是成本高一個量級，還沒做。
2. **判 NO 時是拒答，不是 `uncertain`。** #65 原本寫「有證據但不完整 → 降級為 uncertain」。實際做出來的檢查問的是「足不足以回答」，NO 代表答不出來，沒有值得保留的散文；而 `uncertain` 在本系統的語意是版本範圍未知，答案與引用都還在。兩者不是同一件事。要做「不完整」那一層，仍然得先有面向抽取。

## 10. SD Review Gate

**Review 結果**：2026-08-20，專案擁有者確認 SD 通過。固定基線、契約、Task DAG 與「不做效能驗證／不規劃替換路線」方向依本文件執行。

SD 通過前需確認：

- T00 已完成固定基線登錄與 smoke test；不包含替換方案或 benchmark 承諾。
- 元件邊界、依賴方向與契約符合 SA FR／NFR。
- Domain、Source、Query、Evidence、Answer、Eval 契約可由 fixture 驗證。
- Task DAG 無循環；每個 Task 有單一交付物、完成條件與明確硬依賴。
- 可平行化分組不依賴 UI、真實來源或真實模型才能開始。
- API、資料模型、衝突／版本／拒答政策與測試層級一致。
- T29／T30 之前的開發可以 fixture-first；真實來源與授權不會阻塞契約與 policy Task。
- 未決事項與 Change Request 入口已明確，沒有把未確認內容寫成已核准事實。

## 11. 下一步

1. 執行 T01，建立專案目錄、模組邊界與最小啟動入口。
2. 將 T00～T31 轉成 GitHub Issues／Milestone，保持 `depends_on` 與平行線欄位。
3. 先完成 T02、T03、T07、T08、T09 等契約 Task，再平行展開 Data、Query、Evaluation、UI 線。
4. 依 Task DAG 開始第一批可獨立驗收的工作。
