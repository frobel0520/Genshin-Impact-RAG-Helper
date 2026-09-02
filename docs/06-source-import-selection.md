# genshin-db 與 Fandom 的匯入技術選型（T36 第二階段）

> 狀態：**待決策**。調查日期 2026-09-02。所有數字與 API 回應都是實際跑過取得的，
> 不是從文件抄的。

方案 A（只存指標、本機重建）已經在 HoYoLAB 上落地。這份文件決定另外兩個來源要
怎麼接進同一套模型。

## 0. 先講一個會影響架構的區別

**genshin-db 與 Fandom 不是同一種東西，不該共用同一個匯入器。**

| | 內容形態 | 應該進到哪裡 |
|---|---|---|
| HoYoLAB | 敘述性公告 | `document_chunks`（逐字切塊，供文件檢索） |
| Fandom | 敘述性條目 | `document_chunks` |
| genshin-db | **結構化欄位**（`elementText: "水"`、`rarity: 5`） | `structured_facts` / `canonical_entities` |

現行 `sources/_facts.json` 就是人工維護的結構化事實。genshin-db 要取代的是**那個
檔案**，不是 `sources/*.json` 的位置。用 locator 去切 JSON 是把結構化資料當散文
處理，會丟掉它唯一的優點。

所以第二階段實際上是**兩個匯入器**：一個抓條目文字（Fandom，沿用現有管道），
一個抓結構化欄位（genshin-db，新的一條路）。

## 1. genshin-db：npm 套件 vs 釘住 commit 的原始 JSON

實測到的事實（`registry.npmjs.org` 與 GitHub API）：

| 項目 | 值 |
|---|---|
| 最新版本 | 5.2.13（2026-08-20 更新） |
| 授權 | MIT（程式碼；資料權利見 [`05-source-licensing.md`](05-source-licensing.md)） |
| 解壓後大小 | **176.1 MB** |
| 相依套件 | `fuzzysort`、`pako` |
| 資料位置 | `src/data/<語言>/<集合>/<名稱>.json` |
| 繁中支援 | 有，`ChineseTraditional`，30 個集合 |
| 角色檔案 | 122 個，每個約 3 KB |
| 資料來源 | 套件自述「Sources from the fandom wiki and GenshinData repo」 |

`src/data/ChineseTraditional/characters/mualani.json` 實際內容開頭：

```json
{ "id": 10000102, "name": "瑪拉妮", "title": "嘩啦啦逐浪客",
  "weaponText": "法器", "rarity": 5, "elementText": "水", … }
```

**欄位就是我們要的事實**，而且已經是繁中，不需要翻譯——這正是 T32 修掉的
enum 翻譯缺陷想避免的情況。

### 選項 A1：加 npm 套件

`npm i genshin-db`，用它的查詢 API 取資料。

- 好處：有維護、有版本、離線可用（資料打包在套件裡），不需要自己寫查詢。
- 代價：**176 MB 進 `node_modules`**，而且是這個專案的**第一個相依套件**——
  目前 `dependencies` 與 `devDependencies` 都是空的。CI 每次 `npm ci` 都要付這個成本。
- 代價：套件的查詢 API 變成我們的資料介面，它改版我們就得跟。

### 選項 A2：釘住 commit 抓原始 JSON（建議）

在來源設定裡記下 commit SHA 與要抓的檔案路徑，用現有的擷取模型抓到
`artifacts/sources/`。

- 好處：**維持零相依**，CI 不變，176 MB 不存在。
- 好處：跟 HoYoLAB 同一套模型——指標在 repo、內容在本機、`content_hash` 釘住內容。
  釘 commit SHA 比釘套件版本更精確。
- 好處：只抓需要的檔案。40 個實體約 120 KB，不是 176 MB。
- 代價：要自己寫「欄位 → StructuredFact」的對應，但那本來就要寫——
  套件也不會替我們產生本專案的 fact 形狀。

**建議 A2。** 這個專案要的是 40 個實體的十幾個欄位，不是一個遊戲資料查詢引擎。

## 2. Fandom：用哪個 wiki、用哪個 API

### 用 zh wiki，不是英文 wiki

`genshin-impact.fandom.com/zh` 是「原神 Wiki」，內容為**繁體中文**。英文 wiki
的內容是英文，接進來會讓語料語言不一致，並把翻譯負擔推給生成階段——那正是
T32 第一個缺陷（模型翻譯 enum，`Claymore` 被寫成「長劍」）的來源。

實測 `瑪拉妮` 條目：`pageid 3718`、`revid 25358`、最後編輯 `2025-06-23`。

⚠️ **zh wiki 的活躍度明顯低於英文 wiki。** 這是選它的代價，要在匯入前抽樣確認
涵蓋率夠不夠，而不是假設。

### API 選擇：`action=parse`，不是 `prop=extracts`

實測結果：

| 方式 | 結果 |
|---|---|
| `prop=extracts&explaintext` | **回傳空的**——Fandom 未安裝 TextExtracts |
| `action=parse&prop=text\|revid` | **可用**，HTML 547 KB → 純文字 15,832 字元 |

`action=parse` 回的 HTML 經過現有的 `htmlToPlainText` 就是可用的純文字，
章節標題（`角色簡介`、`遊戲信息`…）保留為獨立行，**現有的 locator 機制直接適用**，
不需要為 Fandom 寫第二套切分邏輯。

MediaWiki 版本 1.43.9。`meta=siteinfo&siprop=rightsinfo` 回傳
`{"url":"https://www.fandom.com/zh/licensing-zh","text":"CC-BY-SA"}`，
與 [`05-source-licensing.md`](05-source-licensing.md) 的結論一致。

### 釘版本：用 revid，比 content_hash 更精確

`action=parse` 同時回 `revid`。把它記進來源設定後：

- 抓到的 revid 與記錄不符 → 條目被編輯過，**在比對內容之前就知道**
- `content_hash` 仍然保留，因為同一個 revid 在模板改變後仍可能渲染出不同文字

兩者一起用：revid 說「條目被改了」，`content_hash` 說「渲染結果變了」。

## 3. 建議

| 來源 | 作法 | 進到哪裡 |
|---|---|---|
| genshin-db | 釘 commit SHA 抓 `src/data/ChineseTraditional/**` 的個別 JSON | `structured_facts` / `canonical_entities` |
| Fandom | zh wiki 的 `action=parse&prop=text\|revid`，以 revid + `content_hash` 釘住 | `document_chunks` |

兩者都走「指標在 repo、內容在本機」，不需要改動方案 A 的任何前提。

## 4. 建議的執行順序

1. **先做 Fandom**：它沿用現有管道（擷取 → `htmlToPlainText` → locator → chunks），
   風險最低，而且它產生的是文件切塊，能直接檢驗 T33 門檻與 T34 上限在更大語料下
   的表現——那是 [#65](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/65)
   在等的樣本。
2. **再做 genshin-db**：它需要新的「欄位 → StructuredFact」對應層，
   而且會取代人工維護的 `sources/_facts.json`，牽動衝突處理（§5.2 的
   HoYoLAB > genshin-db > Fandom 優先序要真的被走到）。
3. **最後重跑 gate 並重新校準**：`DOCUMENT_MIN_SCORE`（目前 0.47，正例樣本 4 個）
   與 `versionDocumentMaxChunks`（目前 24）都要用新語料重量。

## 5. 這份文件沒有決定的事

- Fandom 要匯入哪些條目、多少條目：要先抽樣確認 zh wiki 的涵蓋率
- genshin-db 要匯入哪些集合：至少 `characters`、`weapons`，其餘視題庫需要
- 題庫要不要同步往 100 題擴充（計畫書 §8.2 的目標）
