# 延遲 Gate 與生成降級日誌

## 2026-10-29 工程修補

`summarizeLatency` 先確認每個測量值是有限、非負的 number，門檻是有限正數，才判定逐題是否超標。缺值、null、NaN、Infinity、負數、字串或 sparse array 都拒絕；不能因 JavaScript 比較結果為 false 就把無效測量算成通過。10,000ms 門檻與完整回應定義不變，不改成首字延遲，也不縮短答案或調整模型。

生成降級日誌只保留分類與固定訊息。adapter 的原始 error message／未識別 error code 不進入紀錄；grounding 的原始生成詞句與矛盾描述也不複製到降級紀錄，避免依賴服務回傳的 URL、credential 或輸入內容被帶入日誌。已知 dependency_unavailable 與 ungrounded_answer 仍可分類，其他生成錯誤統一 generation_error；安全模板與引用行為不變。

這只修補生成降級紀錄，不是全系統日誌遮罩／保存政策結案。既有 query／answer 紀錄與保存期限仍需 OPEN-05 決議；沒有新增原始例外、prompt 或模型輸出檔。

## 驗證與未完成範圍

本輪 `npm run check` 通過語法、模組邊界與 463 項離線測試，包含無效延遲、無效門檻、未知錯誤碼／敏感訊息、grounding 詞句不寫入降級日誌，以及既有 fallback／引用回歸。GitHub CI 另驗 contract 與完整離線 suite。

離線 fake generator 證明邏輯，不證明目標硬體、模型品質或速度。#87 的74題長證據品質、#92 的三輪重現性、#94 的逐題完整回應10秒 Gate 仍需目標 Ollama 裝置實測；不以測試執行時間作為模型延遲。串流契約、模型更換、log 保存／遮罩政策尚未擅自決定，三個 issue 維持 open。
