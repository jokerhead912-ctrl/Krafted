# Windows 點跑（一條指令）

## 你要帶咩過去

淨係需要兩個檔案（`fixtures/` 唔使帶，嗰 450 MB 係 Mac 嘅料）：

```
Krafted/audit/run_audit.js      ← 主程式（mac/win 同一份）
Krafted/audit/win/              ← 呢個資料夾
```

放喺 Win 機邊度都得，兩個要**保持相對位置**（`win/` 喺 `run_audit.js` 隔離）。

## 三步

1. **改 `win/audit_config_win.json`** —— 填你自己嘅真嘢：
   - `board`：你塊 `.kpak`（例如 `C:\\Users\\you\\Desktop\\my_board.kpak`）
   - `footage`：你嘅 footage folder
   - **反斜線要寫兩次**（JSON 規矩）
   - 留空都得 —— 留空嘅 case 會如實報「not configured」，唔會造假數

2. **撳兩下 `win/run_audit_win.bat`**

3. **攞 `results/result_win.json` 畀我**（會喺 `run_audit.js` 隔離嘅 `results/` 資料夾）

## 如果 Win 機冇 Node

`.bat` 會自己detect到同埋話你知。後備：**直接喺 Chrome 開 `win/audit_page.html`**，撳四個掣就出 JSON，唔使裝任何嘢。

嗰版量到：真實 MIME 對應（W1 嘅關鍵）、真實解碼、長任務。
量唔到：heap snapshot、trace、cold start。

## 事前 3 秒準備（W1 要）

揀一條你自己嘅片，複製三份改名 `t.mxf` `t.mov` `t.mp4`。
我想知 **Windows Chrome** 對呢三個副檔名各報乜 MIME —— Mac 實測係
`application/mxf` / `video/quicktime` / `video/mp4`，兩邊要對。

## 跑幾耐

`soak` 預設 **120 分鐘**。趕時間可以改做 `0`（skip soak），其餘約 3–5 分鐘。

## 兩個平台點對比

兩邊用**同一套 case、同一個 `run_audit.js`**，淨係輸入路徑唔同。
對比腳本：

```bash
python3 Krafted/audit/compare.py results/result_mac.json results/result_win.json
```

會輸出逐項 Win / Mac 對照，輸入唔同嘅會標明「inputs differ — 行為可比較，數字唔好直接比」。
