# Krafted Memory Bank

> 最後更新: 2026-07-22  
> 版本: v6.4.1  
> 部署: https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html

---

## 項目概覽

| 項目 | 詳情 |
|------|------|
| 名稱 | Krafted（前身 KBOARD / refboard） |
| 品牌 | Joker Head Studios |
| 開發者 | Kincheung（騰訊 CG 導演） |
| 類型 | 單檔 HTML PWA — 創意/影片/圖片/文件編輯器 |
| 規模 | ~32K 行 |
| Repo | `jokerhead912-ctrl/Krafted`（公開，開發流程私有） |
| 密碼 | 主備份密碼 `jokerhead` |

---

## 核心架構

### 檔案格式

| 格式 | 說明 |
|------|------|
| `.kpak` | Krafted Package — zip 內含 `manifest.json` + `media/<id>.<ext>` |
| `.json` / `.krafted` | 舊版 JSON 格式（legacy） |
| Locked kpak | JSON wrapper 內嵌 base64 zip + `_kraftedLock` 密碼保護 |

### Save Flow

```
state.items[] → buildManifest() → manifest.json
                                  ↓
                 buildKpakStream() → StreamingZipWriter → .kpak (stream to disk)
```

- **Streaming path** (Chrome/Edge): `FileSystemWritableFileStream` 直接寫 disk，零 memory
- **Fallback path** (其他瀏覽器): JSZip in-memory → download blob

### Load Flow

```
.kpak file → JSZip.loadAsync(file) → manifest.json parse
                                     ↓
                  Remap: media/<id>.<ext> → blob: URL (URL.createObjectURL)
                                     ↓
                  restoreBoard(data) → DOM rebuild
```

- **Lazy video**: Video blob 唔 extract 直到用戶第一次互動（click/hover）
- **Append mode** (v6.4.0+): 第二個 kpak 可以疊加上去，唔清 board

### Memory 限制

| Threshold | 行為 |
|-----------|------|
| >800MB | Save warning |
| >1.5GB | Load warning（JSZip OOM risk） |
| ~4GB | Browser tab hard limit |

### 狀態管理

| 變數 | 說明 |
|------|------|
| `state.items[]` | 所有 board items（images, videos, audio, GIFs, draws） |
| `state.texts[]` | 文字 items |
| `state.todos[]` | Todo items |
| `state.mindmaps[]` | Mind map items |
| `state.zoom` | 當前縮放 |
| `state.pan` | 當前位移 `{x, y}` |
| `G.nextZ` | 下一個 z-index |
| `G.nextId` | 下一個 item ID |
| `G.drawStrokes[]` | 繪圖筆劃數據 |

---

## 關鍵 Functions 索引

| Function | 行號 | 用途 |
|----------|------|------|
| `addImage()` | 7751 | 建立圖片/影片 DOM item |
| `addAudioItem()` | 17584 | 建立音頻 DOM item |
| `buildManifest()` | 29614 | 序列化 board state → JSON |
| `buildKpakStream()` | 29721 | Streaming zip writer |
| `buildKpakBlob()` | 29768 | JSZip fallback |
| `saveBoard()` | 29887 | 主儲存 function |
| `saveBoardSplit()` | 30055 | 分拆儲存（~800MB/part） |
| `loadBoardFile()` | 30168 | 主載入 function |
| `restoreBoard(data, append)` | 30648 | 從 manifest 重建 DOM |
| `_activateLazyVideo()` | 30346 | 按需提取 video blob |
| `requestSaveHandle()` | 29868 | File System Access API |
| `StreamingZipWriter` | 29325 | 自訂 streaming zip class |
| `crc32()` | ~29300 | CRC-32 checksum |

---

## 版本歷史

### v6.4.1 (2026-07-22)
- **Fix**: `restoreBoard` append mode 有 3 個位 unconditional overwrite zoom/pan
  - `state.zoom=1; state.pan={x:0,y:0}` 無條件執行
  - `state.pan=data.pan; state.zoom=data.zoom` 用新 file 值 overwrite
  - Auto fit-to-content 重新計算 bbox 後覆寫 zoom/pan
- **Fix**: Append mode `maxId` 由現有最大值開始
- **Fix**: Append mode `G.nextZ` 考慮現有 items
- **Fix**: Split save texts/todos/mindmaps 只在 part 1，其餘 parts 為空

### v6.4.0 (2026-07-22)
- Split save: 將 items 分 ~800MB batches，逐個 save
- Append load: `restoreBoard(data, append)` — 疊加而唔清 board
- Lazy video load: 延遲 video blob extract 至首次互動
- 3.7GB kpak load OOM → split save 係 practical solution

### v6.3.x (2026-07-22)
- Streaming zip writer（CRC-32 + PKZIP format）
- `buildKpakStream` 取代 `buildKpakBlob` for save
- File stream consumption bug fix（`.text()` → `.arrayBuffer()`）
- Lock save redesign（`_kraftedLock` in manifest.json）

### v6.2.x (2026-07-22)
- Memory meter in status bar
- Audio restart button (↺)
- Box-select performance（mousedown cache + throttle）
- GIF freeze on import + `_userFrozen` flag
- Audio WAV import OOM fix（`readAsDataURL` → `URL.createObjectURL`）

### v6.1.x (2026-07-21)
- Annotation render cache fix（`_perfLastRenderKey` clear）
- Video drag transparency fix（`visibility:hidden` → `pause + poster`）
- Text annotation invisible-after-commit fix
- Drawing preview invisible during stroke fix

---

## 已知 Bugs & 限制

| 問題 | 狀態 | 備註 |
|------|------|------|
| 超大 kpak (>1.5GB) load OOM | ⚠️ Workaround | 用 split save + append load |
| JSZip.loadAsync 全 file 讀入 memory | ⚠️ 設計限制 | 需要 streaming zip reader 解決 |
| iPhone/iPad touchstart preventDefault | 🔧 Debug 中 | ~line 20980 |
| Frame comment zip export 只 capture 一張圖 | 🔧 Known | 待修復 |
| kpak save 失敗（v4.4 遺留） | 🔧 Known | 缺少路徑對話框 |
| 文字 items zoom 值遺失 | ✅ Fixed | v6.1.x |
| JSON 儲存圖片遺失 | ✅ Fixed | v6.1.x |
| GitHub Pages CDN cache | ⚠️ 注意 | 加 `?v=` cache buster |

---

## 未來方向

### 短期
- **快速審片模式** for directors/supervisors（下一個功能）
- Frame comment 導出 zip 修復
- iPhone/iPad 觸控完整支援
- Tidy 功能（Masonry 演算法）

### 中期
- **AILUT** AI 調色工具整合（.cube LUT → Premiere Pro Lumetri）
- WorkBuddy 桌面雲端工作流
- IP 保護（HTML 不可被修改/轉售）

### 長期
- **Streaming zip reader** — 徹底解決超大 file load OOM
- **Media reference system** — Maya-style external file referencing
- 微信小遊戲

---

## 部署流程

```bash
# 1. 編輯 /workspace/kraftpub-v6.2.html（主開發檔）
# 2. 複製到 Krafted repo
cp /workspace/kraftpub-v6.2.html /workspace/Krafted/kraftpub.html
cp /workspace/kraftpub-v6.2.html /workspace/Krafted/docs/kraftpub.html

# 3. Commit & push
cd /workspace/Krafted
git add kraftpub.html docs/kraftpub.html
git commit -m "vX.Y.Z: description"
git push origin main

# 4. GitHub Pages 自動 deploy from docs/ folder
# URL: https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html
# CDN cache ~1-2 分鐘，加 ?v= 參數 bust cache
```

---

## 常用 Command Reference

| 操作 | 指令 |
|------|------|
| 測試 append mode | `restoreBoard(data, true)` |
| 測試 replace mode | `restoreBoard(data, false)` |
| 手動 clear board | `cleanupAllItems()` |
| 手動 zoom | `state.zoom = 1.5; updateCanvas()` |
| 手動 pan | `state.pan = {x:100, y:200}; updateCanvas()` |
| Build manifest | `buildManifest()` |
| Count media | `countMediaItems()` |
| 檢查 memory | status bar 自動顯示，或 `state.items.reduce((s,i)=>s+(i._fileSize||0),0)` |

---

## 開發者筆記

- **單檔原則**: 所有 code 在一個 HTML file，避免多檔案混淆
- **跨平台**: Win/Mac 行為不可破壞，新功能針對 iOS 時需隔離
- **模組化重構**: 需保持原檔不變
- **每次更新後**: 用戶會主動測試各功能驗證
- **偏好**: 簡潔直接、step-by-step、pros/cons 表格對比
- **反饋風格**: 直接指出 OK/BAD，方向錯會要求還原
- **手機審閱**: 輸出需手機友善
