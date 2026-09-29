# 專案進度（2026-09-29）

## 本輪已完成

- `main` 已先與 `origin/main` 同步；固定來源重新抓取並重建出 14 文件、89 切塊，與 74 題題庫同為 `dataset_version f49336564cad6162`。
- Node 24 完整離線檢查通過（459 tests）。本機索引建置通過。
- 正式查詢預設略過只供記錄、額外耗時的 evidence coverage 模型呼叫；`ENFORCE_COVERAGE=true` 仍可供實驗。
- 評估命令預設連跑三次，列出模板回答數的範圍、答案文字變動的題目、逐題端到端時間與 10 秒門檻結果。`GENERATION_MODEL` 可指定待比較的模型。
- SA／SD 已補上 10 秒效能門檻；既有 44–111 秒量測代表目前**未通過**。

## 待另一台裝置的 Ollama 實測

使用者指定在另一台裝置做 Ollama 實測；2026-09-29 已從這台 Mac 刪除 Ollama App、本機模型、設定與快取。`/usr/local/bin/ollama` 是 root 擁有的失效連結，仍須由具管理員密碼的使用者執行 `sudo rm /usr/local/bin/ollama` 才能清除。這台 Mac 曾以 `qwen2.5:7b-instruct` 嘗試 5.5 長篇總覽，180 秒逾時，沒有可用答案；這不是原 RTX 3060 基線的驗收結果。

| GitHub issue | 現況 | 關閉前需要的證據 |
|---|---|---|
| [#87](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/87) 長證據生成品質 | 尚未解決 | 「5.5版本更新了哪些內容？」有以主線開頭、無編造的散文；74 題三項機器指標與狀態分佈不退步，並完成必要人工複核。 |
| [#92](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/92) 可重現性 | 報告工具已改，未實測 | 同設定連跑三次，核對 `answer_text`、模板數範圍、狀態與指標；若仍有變動，記錄條件與幅度。 |
| [#94](https://github.com/frobel0520/Genshin-Impact-RAG-Helper/issues/94) 10 秒效能 | 門檻與測量已寫入，未達標 | 74 題每題完整回應 ≤10 秒，或先決定長篇總覽的串流驗收方式，再重跑新模型的 release gate。OPEN-05 另含日誌保存與遮罩規則，仍待決議。 |

在目標裝置安裝所需模型、依 `README.md` 重建來源與索引後，可執行：

```powershell
$env:GENERATION_MODEL = "qwen2.5:7b-instruct" # 候選模型；先保留原 14B 基線作對照
npm run evaluate -- evaluation\eval-cases.json --report artifacts\eval-report.json
```

報告須保留每次 run 的結果與延遲；目前三個 issue 維持 open，不把離線單元測試當成模型驗收。
