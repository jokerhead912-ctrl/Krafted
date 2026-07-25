# Krafted Memory Bank v6.7.25

> Last updated: 2026-07-25  
> Active file: `/workspace/kraftpub-v6.7.25.html` → deployed to `jokerhead912-ctrl.github.io/Krafted/kraftpub.html`  
> GitHub: `https://github.com/jokerhead912-ctrl/Krafted` (main branch, commit `c73a3df`)

---

## 開發規則 RULES

### 1. 影片相關 code — 必須先問
影片播放器互動功能（時間軸、scrub、fullscreen、逐幀、音量、frame comment、draw on video、lockToPlayer、影片 touch handler、影片 save/load、annotation on video）已經過長時間測試穩定。**任何改動如會 touch 影片相關 code，必須先問用戶，不可自行修改。**

### 2. 每次改動 bump version
每次 code change 必須 bump `KRAFTED_VERSION`（line ~3924）、`<title>`、同 `sw.js` 嘅 `APP_VERSION` + `CACHE_NAME`。用戶透過 GET STARTED page 睇 version 確認更新。

### 3. Sync + Push 流程
改完 `/workspace/kraftpub-v6.7.25.html` 後：
```bash
cp /workspace/kraftpub-v6.7.25.html /workspace/Krafted/kraftpub.html
cp /workspace/kraftpub-v6.7.25.html /workspace/Krafted/docs/kraftpub.html
cd /workspace/Krafted && git add -A && git commit -m "vX.X.XX: description" && git push origin main
```
**注意：唔好 `cp` 錯方向，之前試過 sw.js overwrite 主 file。**

### 4. 備份
每次重要改動前後都要備份：
```bash
cp /workspace/kraftpub-v6.7.25.html "/workspace/kraftpub-v6.7.XX-backup-$(date +%Y%m%d-%H%M).html"
```

### 5. 向後兼容
Save file（.kpak）只保存 data，唔保存 code behavior。新舊 file 應互通。如有 breaking change（例如 lock/password 移除），要顯示 toast 提示用戶。

---

## 近期版本歷程

| 版本 | 日期 | 改動 |
|------|------|------|
| v6.7.25 | Jul 25 | skip load fit-to-content — preserve save-time zoom/pan |
| v6.7.24 | Jul 25 | remove load-time autoGrow timeout — fix tx.h overwrite |
| v6.7.23 | Jul 25 | log restored zoom |
| v6.7.22 | Jul 25 | fix buildKpakV6 text save + round size to avoid float drift |
| v6.6.4 | Jul 23 | will-change+contain:layout on text resize for 30+ image perf |
| v6.6.3 | Jul 23 | fix paste — always handle in text-item when editing, don't blur |
| v6.6.2 | Jul 23 | revert will-change/contain — investigate paste issue |
| v6.6.1 | Jul 23 | text resize handle sync after tidy + perf + double-scale fix |
| v6.6.0 | Jul 23 | live text font scaling during resize, auto-recalibrate on load |

---

## 檔案位置

| 檔案 | 用途 |
|------|------|
| `/workspace/kraftpub-v6.7.25.html` | 主要開發檔案 |
| `/workspace/Krafted/kraftpub.html` | Deploy 用 |
| `/workspace/Krafted/docs/kraftpub.html` | GitHub Pages root |
| `/workspace/Krafted/docs/sw.js` | PWA Service Worker |
| `/workspace/kraftpub-v6.7.25-backup-*.html` | 備份 |
