# 來源授權與保存策略（T36 第一階段）

> 狀態：**待決策**。這份文件整理三個來源的實際授權條款，並提出三個保存策略供
> 專案擁有者選擇。OPEN-06 在選定之後才標記為已決議。
> 調查日期：2026-09-02。

計畫書 [§5.3](01-project-plan.md) 已經定調方向，但沒有落到「repo 裡實際存什麼」
這一層。T36 要匯入 genshin-db 與 Fandom，而 **Fandom 的 CC BY-SA 有傳染性**，
決策錯了要回頭改寫 commit 歷史，所以先決策再寫程式。

## 1. 三個來源的實際條款

| 來源 | 文字授權 | 對本專案的實際限制 |
|---|---|---|
| HoYoLAB 官方公告 | 無開放授權。HoYoverse 版權所有，僅限個人非商業使用 | **不得散布原文**。可引用連結與必要的短摘要 |
| genshin-db | 套件程式碼 MIT（Copyright (c) 2020 theBowja）；**遊戲資料本身不因此改變權利** | MIT 只覆蓋程式碼。資料仍是 HoYoverse 的遊戲內容 |
| Genshin Impact Fandom Wiki | **CC BY-SA 3.0 Unported** | 可以散布，但**必須**署名、附原文連結，且衍生作品要以相同或相容授權釋出 |

三點需要特別記住：

1. **Fandom 是 3.0 不是 4.0。** Fandom 平台預設 CC BY-SA 3.0，個別 wiki 可以自行
   升級，而 Genshin Impact Wiki 沒有升級，仍是 3.0 Unported。3.0 與 4.0 的
   share-alike 相容性方向是單向的，寫授權聲明時不能寫成 4.0。
2. **genshin-db 的 MIT 是個陷阱。** 它的 README 只說「Currently using MIT License
   but I don't really care」，完全沒有提到遊戲資料的權利歸屬。MIT 授權的是
   theBowja 寫的程式碼，不是 HoYoverse 的遊戲資料。把 genshin-db 當成「資料可以
   自由散布」的依據是錯的。
3. **share-alike 的觸發點是「散布」，不是「使用」。** 本機讀取 Fandom 文字做檢索，
   不觸發任何義務；把 Fandom 文字提交進公開 repo，就是散布一份副本，那份內容必須
   帶署名與 CC BY-SA 3.0 聲明。

## 2. 現況：已經踩到一條線

`sources/hoyolab-5-0.json` 與 `sources/hoyolab-2-1.json` 各含約 500 字元的
HoYoLAB 公告**逐字原文**，已經提交在公開 repo 裡。

計畫書 §5.3 寫的是「GitHub Repo 不提交大量第三方原始內容」。500 字元稱不上
「大量」，兩篇公告的節錄也符合一般引用的範圍——**這不是緊急問題**。但它是現行
`sources/` 設計的直接後果：手抄 JSON 就是把原文存進 repo。語料一擴充，同樣的
設計會把數十倍的文字帶進來，那時就不是引用範圍了。

`rights_note` 的機制已經存在（`scripts/make-source-pack.js` 的
`DEFAULT_RIGHTS_NOTES`），HoYoLAB 那條目前寫著 "terms review pending"——就是這份
文件要結清的東西。

## 3. 三個保存策略

### 方案 A：只存指標，本機重建（建議）

repo 裡不存任何來源原文，只存**擷取設定**：URL、章節 locator、`retrieved_at`、
`content_hash`、以及人工標註的 `entity_ids`。原文在使用者本機擷取一次，落在
gitignore 的目錄裡，索引從那裡建。

- **授權**：repo 散布的第三方內容為零。Fandom 的 share-alike 不觸發，HoYoLAB 的
  非商業限制不觸發，genshin-db 的資料權利問題不觸發。三個來源同一套規則。
- **可重現性**：`content_hash` 仍然釘住內容，抓到的文字跟當初不同會被發現，
  這正是 T31 建立 `dataset_version` 穩定性時想要的性質。
- **代價**：**CI 不再能從 repo 重建完整資料集**。目前 `npm run check` 之所以能在
  離線 guard 下跑，是因為 `fixtures/` 有一份自製的測試 pack——那份是專案自己寫的
  假資料，不受影響。但「clone 完就能跑真實查詢」會變成「clone 完要先擷取」。
- **代價**：擷取器要處理三種來源、要遵守 robots.txt 與速率限制，是實際的工作量。

### 方案 B：Fandom 全文 + 其餘只存指標

Fandom 的內容照 CC BY-SA 3.0 存進 repo（附署名、原文連結、授權聲明），
HoYoLAB 與 genshin-db 走方案 A 的指標路線。

- **授權**：合法，但**本 repo 必須處理 share-alike**。CC BY-SA 3.0 要求衍生作品
  以相同或相容授權釋出，而「衍生作品」的範圍在「一個內嵌了 wiki 文字的資料集」
  上並不清楚。最保守的作法是把 `sources/fandom/` 整個目錄標為 CC BY-SA 3.0，
  並在 README 說明 repo 其餘部分的授權。**這會讓本專案的授權敘述變複雜。**
- **好處**：Fandom 是三個來源裡唯一「可以合法散布」的，全文入庫讓長文檢索的
  開發與測試容易得多。
- **風險**：授權混合體一旦建立就很難拆掉。

### 方案 C：全部只存摘要與結構化事實

不存任何來源的連續原文，只存人工整理過的結構化事實（現行 `sources/_facts.json`
的形態）與極短的引用片段。

- **授權**：事實本身不受著作權保護，風險最低。
- **代價**：**這會拆掉 RAG 的核心。** 沒有 verbatim chunk 就沒有文件檢索，
  T33 的相似度門檻、T34 的整份公告、grounding 的逐字比對全部失去對象。
  等於把系統退回成一個結構化查詢器。**不建議。**

## 4. 建議

**採方案 A。**

理由：

1. 它是唯一一個讓三個來源適用**同一套規則**的方案。B 讓 repo 帶著一個
   CC BY-SA 的子目錄，往後每一次新增來源都要重新判斷落在哪一區。
2. 它讓「repo 裡不存第三方原文」成為**結構上的保證**，而不是每次提交都要人記得
   檢查的紀律。現行手抄 JSON 的設計正好相反——不小心就會存進去。
3. 它保住了 RAG 的核心。C 不行。
4. `content_hash` 已經在做內容指紋，方案 A 只是把「文字存哪裡」換掉，
   `dataset_version` 的穩定性機制不用改。

主要代價是擷取器的工作量，以及 clone 後需要一次擷取步驟。後者可以靠一個
`npm run fetch:sources` 與清楚的 README 說明處理。

## 5. 選定之後要做的事

1. 在 `docs/02-system-analysis.md` 把 OPEN-06 標記為已決議，指向本文件
2. 更新 `DEFAULT_RIGHTS_NOTES`：HoYoLAB 那條的 "terms review pending" 換成實際結論
3. 更新 `sources/README.md`：手抄流程改為擷取設定流程
4. 決定現有兩篇 HoYoLAB 原文的處置——保留（在引用範圍內）或一併轉為指標形式
5. 才開始寫 T36 第二階段的匯入程式

## 6. 這份文件不是法律意見

以上是依公開條款整理的工程判斷，供專案擁有者決策使用。條款連結：

- [Fandom Licensing](https://www.fandom.com/licensing)
- [Fandom Help:Licensing](https://community.fandom.com/wiki/Help:Licensing)
- [Genshin Impact Wiki:Copyrights](https://genshin-impact.fandom.com/wiki/Genshin_Impact_Wiki:Copyrights)
- [genshin-db LICENSE](https://github.com/theBowja/genshin-db/blob/main/LICENSE)
- [HoYoLAB 法律 FAQ](https://www.hoyolab.com/article/143107)
