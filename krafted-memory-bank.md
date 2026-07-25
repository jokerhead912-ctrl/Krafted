# Krafted Memory Bank v6.6.4

> Last updated: 2026-07-25  
> Active file: `/workspace/kraftpub-v6.2.html` → deployed to `jokerhead912-ctrl.github.io/Krafted/kraftpub.html`  
> GitHub: `https://github.com/jokerhead912-ctrl/Krafted` (main branch, commit `d228e3e`)

---

## 開發規則 RULES

### 1. 影片相關 code — 必須先問
影片播放器互動功能（時間軸、scrub、fullscreen、逐幀、音量、frame comment、draw on video、lockToPlayer、影片 touch handler、影片 save/load、annotation on video）已經過長時間測試穩定。**任何改動如會 touch 影片相關 code，必須先問用戶，不可自行修改。**

### 2. 每次改動 bump version
每次 code change 必須 bump `KRAFTED_VERSION`（line ~3924）、`<title>`、同 `sw.js` 嘅 `APP_VERSION` + `CACHE_NAME`。用戶透過 GET STARTED page 睇 version 確認更新。

### 3. Sync + Push 流程
改完 `/workspace/kraftpub-v6.2.html` 後：
```bash
cp /workspace/kraftpub-v6.2.html /workspace/Krafted/kraftpub.html
cp /workspace/kraftpub-v6.2.html /workspace/Krafted/docs/kraftpub.html
cd /workspace/Krafted && git add -A && git commit -m "vX.X.X: description" && git push origin main
```
**注意：唔好 `cp` 錯方向，之前試過 sw.js overwrite 主 file。**

### 4. 備份
每次重要改動前後都要備份：
```bash
cp /workspace/kraftpub-v6.2.html "/workspace/kraftpub-vX.X-backup-$(date +%Y%m%d-%H%M).html"
```

### 5. 向後兼容
Save file（.kpak）只保存 data，唔保存 code behavior。新舊 file 應互通。如有 breaking change（例如 lock/password 移除），要顯示 toast 提示用戶。

### 6. 文字 resize proportional scaling
文字框 resize 時字體必須按比例 scale（似圖片），唔係 re-wrap。Drag 期間 commit `item.size` 到 state，mouseup 用 `_origTextSize` 避免 double-scale。

---

## v6.6.0 → v6.6.4 完整改動

### 文字框 Resize Proportional Scaling
| 改動 | 位置 | 說明 |
|------|------|------|
| Live font scaling during drag | rAF fast path (~line 22356) | Drag 期間直接 commit `item.size = origSize × scaleX` 到 state，唔止改 CSS |
| Mouseup use `_origTextSize` | mouseup handler (~line 22660) | 避免 double-scale（drag 已改 `item.size`，mouseup 用 cache 嘅原值） |
| `renderRelations` skip during text resize | rAF fast path (~line 22385) | 文字框 resize 唔郁其他 items，skip relation line render |
| `repositionAllAnnoPopovers` skip during text resize | rAF fast path (~line 22389) | 文字框 resize 唔影響 popover position |
| Tidy sync text `size` | tidySelection (~line 7567) | Tidy 改 text item w/h 時同步 scale `item.size` |
| Tidy `applyTextProps` + handle refresh | tidySelection (~line 7586) | Tidy 後確保 fontSize CSS 同步 + handle container position 更新 |
| Load recalibrate | restoreBoard (~line 30903) | Load 舊 file 時如果 w≠160 但 size=24(default)，自動 recalibrate |

### Paste Fix
| 改動 | 位置 | 說明 |
|------|------|------|
| Paste in editing text-item | global paste handler (~line 20079) | 文字框 editing 時 paste 直接由 text-item 自己 handle，唔 blur。避免微信 `file://` 圖片 references 觸發 global handler 失敗 |

### Performance（30+ 圖片時）
| 改動 | 位置 | 說明 |
|------|------|------|
| `will-change: transform` + `contain: layout style` | resize mousedown (~line 21681) | 文字框 resize 時 isolate 到獨立 compositor layer，避免 30+ images global reflow |
| Cleanup on mouseup | mouseup (~line 22665) | 清除 `will-change` 同 `contain` 釋放 GPU memory |

### 其他
| 改動 | 說明 |
|------|------|
| lockToPlayer default ON | Draw mode 喺 video player 上 stays active between strokes |
| 1.5GB memory warning removed | v6 streaming kpak 用 Blob.slice()，不再有意義 |
| Autosave restore disabled | Startup 永遠 clean board |
| Ctrl+S/Cmd+S capture-phase handler | 防止 browser save page dialog |
| Quick Save 完全移除 | 所有 QS functions/shortcuts/UI 已刪除 |
| Status bar z-index fix | 9999998 防止遮蓋 Paper Color swatches |
| Paste strip formatting | text-item paste listener 強制 text/plain |
| F key fix | 用 `activeElement` 而唔係 `e.target` 檢測 typing state |

---

## 已知問題

- **30+ 圖片 + Tidy 後文字框 resize 可能仍有 performance 問題** — v6.6.4 加了 `will-change` + `contain:layout` 改善，需用戶實測確認
- **騰訊會議投屏時 Krafted 好慢** — GPU 資源爭奪問題，建議 Export PNG 後投屏
- **微信 paste `file://` 圖片 error** — v6.6.3 已 fix（editing text-item 直接 handle paste）

---

## 檔案位置

| 檔案 | 用途 |
|------|------|
| `/workspace/kraftpub-v6.2.html` | 主要開發檔案 (~31K lines) |
| `/workspace/Krafted/kraftpub.html` | Deploy 用 |
| `/workspace/Krafted/docs/kraftpub.html` | GitHub Pages root |
| `/workspace/Krafted/docs/sw.js` | PWA Service Worker |
| `/workspace/kraftpub-v6.6-backup-*.html` | 備份 |
