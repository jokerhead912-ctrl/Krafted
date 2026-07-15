// ============================================================
//  i18n — Language toggle (English ↔ 中文)
//  Krafted v5.5.1
// ============================================================
//  Walks the DOM and replaces known English UI strings with
//  their Chinese equivalents. Only targets static UI elements
//  (toolbar, panels, modals, help) — never touches user content.
//  Toggle via the 🌐 button in the toolbar or via `toggleLang()`.
// ============================================================

var I18N = (function() {
  // ── Translation map: exact English string → 中文 ──────────
  var MAP = {
    // ── Toolbar buttons ──
    'Select & Move (V)': '選擇移動 (V)',
    'Select': '選擇',
    'Add Text (T)': '加入文字 (T)',
    'Text': '文字',
    'Draw (Ctrl+D)': '繪圖 (Ctrl+D)',
    'Draw': '繪圖',
    'Export PNG (E)': '導出PNG (E)',
    'Export': '導出',
    'Capture Area (C) | Screen Capture (Shift+C)': '截圖區域 (C) | 螢幕截圖 (Shift+C)',
    'Capture': '截圖',
    'Free Shape Cut (X)': '自由剪裁 (X)',
    'Cut': '剪裁',
    'Lasso Polygon Cut (L)': '多邊形套索 (L)',
    'Lasso': '套索',
    'Mind Map Brainstorm (M)': '心智圖 (M)',
    'Mind': '心智',
    'Relation Line — connect two items (R)': '關係線 — 連接兩個項目 (R)',
    'Relation': '關係',
    'Undo (Ctrl+Z)': '復原 (Ctrl+Z)',
    'Undo': '復原',
    'Redo (Ctrl+Y)': '重做 (Ctrl+Y)',
    'Redo': '重做',
    'Add Link Card (Ctrl+L)': '加入連結 (Ctrl+L)',
    'Link': '連結',
    'Add To-Do List': '加入待辦清單',
    'Todo': '待辦',
    'Tidy Selected (Ctrl+Shift+U)': '整理選取 (Ctrl+Shift+U)',
    'Tidy': '整理',
    'Toggle Grid (G)': '切換網格 (G)',
    'Grid': '網格',
    'Group Selected (Ctrl+G)': '群組 (Ctrl+G)',
    'Group': '群組',
    'Ungroup (Ctrl+Shift+G)': '取消群組 (Ctrl+Shift+G)',
    'Ungroup': '解散',
    'Save Board (Ctrl+S)': '儲存 (Ctrl+S)',
    'Save': '儲存',
    'Fullscreen (Shift+F)': '全螢幕 (Shift+F)',
    'Full': '全螢幕',
    'Load Board': '載入面板',
    'Load': '載入',
    'New Board (clear all)': '新面板 (清除全部)',
    'Clear': '清除',
    'Pan (Hand tool)': '平移 (手掌工具)',
    'Pan': '平移',
    'Add Image': '加入圖片',
    'Add Video': '加入影片',
    'Fit': '適應',

    // ── Text toolbar ──
    'Font size (px on screen)': '字型大小 (px)',
    'Bold': '粗體',
    'Italic': '斜體',
    'Underline': '底線',
    'Strikethrough': '刪除線',
    'Uppercase': '大寫',
    'Highlight': '螢光筆',
    'Shadow': '陰影',
    'Outline': '外框',
    'Background': '背景',
    'Text Color': '文字顏色',
    'Highlight Color': '螢光筆顏色',
    'Align Left': '靠左',
    'Align Center': '置中',
    'Align Right': '靠右',
    'Translate EN -> 中文 (Ctrl+Shift+T)': '翻譯 EN→中文 (Ctrl+Shift+T)',

    // ── Draw toolbar ──
    'Tool': '工具',
    'Pen': '筆',
    'Arrow': '箭頭',
    'Box': '方框',
    'Eraser': '橡皮擦',
    'Color': '顏色',
    'Size:': '大小：',
    'Opacity:': '透明度：',
    'Pressure (Pen Tablet)': '壓力感應 (繪圖板)',
    'Arrow Head Size': '箭頭大小',
    'Undo Last Stroke': '復原上一筆',
    'Clear All Draws': '清除所有繪圖',
    'Clear All': '清除全部',
    'Tip: switch to Select (V), click any drawing to select it, then press Del to remove.': '提示：切換到選擇 (V)，點擊繪圖選取後按 Del 刪除。',

    // ── Free Cut ──
    'Free Cut': '自由剪裁',
    'Draw on image to cut': '在圖片上繪製剪裁範圍',
    'Extract': '提取',
    'Redraw': '重畫',
    'Done': '完成',

    // ── Lasso ──
    'Click points on image to cut': '在圖片上點擊建立剪裁點',
    'Border': '邊框',
    'Border color': '邊框顏色',
    'Close Shape': '閉合形狀',
    'Undo Point': '復原點',
    'Cancel': '取消',

    // ── Export modal ──
    'BG:': '背景：',
    'Pick any background color': '選擇背景顏色',
    'White': '白色',
    'Canvas': '畫布',
    'Dark': '深色',
    'Transparent': '透明',
    'Save to a local folder (Chrome/Edge on Win/Mac)': '儲存到本機資料夾 (Chrome/Edge Win/Mac)',
    'Save to Folder...': '儲存到資料夾...',
    'Save PNG': '儲存 PNG',
    'Close': '關閉',

    // ── Capture ──
    'Drag to select capture area': '拖曳選取截圖範圍',
    'Paste to Board': '貼到面板',
    'Drop the captured image directly onto the board at the cursor position (avoids the clipboard round-trip, which can fail on some browsers)': '直接將截圖放到面板遊標位置',
    'Discard': '放棄',

    // ── Media bar ──
    'Media': '媒體',
    'Play all GIF & Video': '播放所有 GIF 和影片',
    '▶️ Play All': '▶️ 全部播放',
    'Pause all GIF & Video to save memory': '暫停全部以節省記憶體',
    '⏸ Pause All': '⏸ 全部暫停',

    // ── Status bar ──
    'Zoom: 100% | Items: 0 | Undo: 0': '縮放：100% | 項目：0 | 復原：0',

    // ── Zoom widget ──
    'Mouse-wheel zoom step (1%–50% per tick)': '滑鼠滾輪縮放步長 (1%–50%)',
    '🎚 Wheel step': '🎚 滾輪步長',
    'Frame selected — center the view on selection and zoom to fit (F). With nothing selected, resets to 100% / (0,0).': '框選 — 將視圖置中並縮放至適合 (F)',
    '🎯 Frame': '🎯 框選',
    'Natural scroll: flip wheel-zoom direction (Mac default). Does not affect pinch-zoom.': '自然滾輪：反轉縮放方向 (Mac 預設)',
    '🔄 Natural scroll': '🔄 自然滾輪',

    // ── Welcome screen ──
    'For every creative soul.': '獻給每個創意靈魂。',
    'Professional reference board — images, video, audio, mind maps & more.': '專業創意參考板 — 圖片、影片、音訊、心智圖等。',
    'GET STARTED': '開始使用',
    'CREATED BY KINCHEUNG': '由 KINCHEUNG 製作',
    'V 5 . 5': 'V 5 . 5',

    // ── Save modals ──
    'Save Board': '儲存面板',
    'Full Package (.kpak) — ZIP archive with all images/videos/audio embedded. No size limits. Share with your team.': '完整套件 (.kpak) — 包含所有圖片/影片/音訊的 ZIP 封存。無大小限制。',
    'Lock & Save (.kpak) — Same as above, but encrypted with a password for extra security.': '加密儲存 (.kpak) — 同上，但以密碼加密增加安全性。',
    'Chrome/Edge: you\'ll choose where to save. Other browsers: file downloads automatically.': 'Chrome/Edge：可選擇儲存位置。其他瀏覽器：自動下載。',
    '🔒 Lock & Save': '🔒 加密儲存',
    'Full Package (.kpak)': '完整套件 (.kpak)',
    'Save with Password': '密碼儲存',
    'Your file is locked. Save this password somewhere safe — it cannot be recovered.': '檔案已加密。請妥善保存此密碼 — 無法復原。',
    'Copy': '複製',
    'Copied': '已複製',
    'Tip: The master password can also open this file as a backup.': '提示：主備份密碼也可開啟此檔案。',
    'OK, Download': '確定，下載',
    '🔒 Locked Board': '🔒 已鎖定面板',
    'This board was saved with a password. Enter the password to open it.': '此面板已密碼保護，請輸入密碼開啟。',
    'Enter password': '輸入密碼',
    'Unlock': '解鎖',

    // ── Help overlay ──
    'KRAFTED — Hotkeys & Guide': 'KRAFTED — 快捷鍵與指南',
    'Tools': '工具',
    'Select & Move': '選擇移動',
    'Text Tool': '文字工具',
    'Draw (pen/arrow/box)': '繪圖 (筆/箭頭/方框)',
    'Export Area (drag select)': '導出區域 (拖曳選取)',
    'Capture Area': '截圖區域',
    'Screen Capture': '螢幕截圖',
    'Free Shape Cut': '自由剪裁',
    'Lasso Cut': '套索剪裁',
    'Mind Map': '心智圖',
    'Relation Line': '關係線',
    'Add Link': '加入連結',
    'Actions': '操作',
    'Save Board (.kpak)': '儲存面板 (.kpak)',
    'Open Board': '開啟面板',
    'Group Selected': '群組選取',
    'Duplicate': '複製',
    'Tidy Selected': '整理選取',
    'Translate EN->中文': '翻譯 EN→中文',
    'Toggle Grid': '切換網格',
    'Fullscreen': '全螢幕',
    'Frame Selection': '框選',
    'Delete Selected': '刪除選取',
    'Pan Canvas': '平移畫布',
    'Alt-Pan (text editing)': 'Alt+平移 (文字編輯)',
    'Mouse / Touch': '滑鼠 / 觸控',
    'Zoom in/out': '縮放',
    'Pan canvas': '平移畫布',
    'Context menu': '右鍵選單',
    'Zoom (natural)': '縮放 (自然)',
    'Pan (trackpad)': '平移 (觸控板)',
    'Krafted v5.5 — by Joker Head Studios': 'Krafted v5.5 — Joker Head Studios',

    // ── Link modal ──
    'Add Reference Link': '加入參考連結',
    'Paste URL (e.g. https://youtube.com/watch?v=...)': '貼上網址 (如 https://youtube.com/watch?v=...)',
    'Fetching preview...': '擷取預覽中...',
    'Add Link': '加入連結',

    // ── Properties panel ──
    'Toggle Panel': '切換面板',
    'Select an item to see properties': '選取項目以查看屬性',
    'Transform': '變形',
    'Opacity': '透明度',
    'Rotate': '旋轉',
    'Flip Horizontal': '水平翻轉',
    'Flip H': '水平翻轉',
    'Flip Vertical': '垂直翻轉',
    'Flip V': '垂直翻轉',
    'Quick Translate': '快速翻譯',
    'EN -> 中文': 'EN → 中文',
    '中 -> EN': '中 → EN',
    'Open in Google Translate (new tab) — always works': '在 Google 翻譯中開啟 (新分頁)',
    'Photo Adjust': '圖片調整',
    'Bright': '亮度',
    'Contrast': '對比',
    'Saturate': '飽和',
    'Hue': '色相',
    'Blur': '模糊',
    'Sepia': '復古',
    'Grayscale': '灰階',
    'Reset All': '全部重設',
    'CGI Director': 'CGI 導演',
    'Temp': '色溫',
    'Vignette': '暗角',
    'Highlight': '高光',
    'Grain': '顆粒',
    'Reset CGI': '重設 CGI',
    'Mask Layers': '遮罩圖層',
    'Color Mask': '顏色遮罩',
    'Brush Mask': '筆刷遮罩',
    'No mask layers. Add one above.': '尚無遮罩圖層，請在上方新增。',
    'GIF': 'GIF',
    'Trim GIF Frames': '裁剪 GIF 影格',
    'Video': '影片',
    '▶️ Play': '▶️ 播放',
    '⏮ Restart': '⏮ 重播',
    'Volume': '音量',
    'Speed': '速度',
    'Trim': '裁剪',
    'Click to re-detect frame rate': '點擊重新偵測幀率',
    'Click to toggle 0:00 ↔ f 1234': '點擊切換 0:00 ↔ f 1234',
    'Duration:': '長度：',
    'Reset Trim': '重設裁剪',
    'Previous frame (←)': '上一幀 (←)',
    '◀ Frame': '◀ 影格',
    'Play / Pause (Space when annotating)': '播放 / 暫停 (註解時按空白鍵)',
    '▶ Play': '▶ 播放',
    'Next frame (→)': '下一幀 (→)',
    'Frame ▶': '影格 ▶',
    'Comments': '留言',
    'Save comments as .json so you can re-open and continue': '儲存留言為 .json 以便日後繼續編輯',
    '💾 Save': '💾 儲存',
    'Layer & Layout': '圖層與佈局',
    'Order': '順序',
    'Bring to Front': '移至最前',
    'Top': '最前',
    'Move Up': '上移',
    'Up': '上',
    'Move Down': '下移',
    'Down': '下',
    'Send to Back': '移至最後',
    'Bottom': '最後',
    'Lock/unlock': '鎖定/解鎖',
    'Lock': '鎖定',
    'Unlock': '解鎖',
    'Duplicate (Ctrl+Shift+D)': '複製 (Ctrl+Shift+D)',
    'Align': '對齊',
    'Align Center H': '水平置中',
    'Center': '置中',
    'Right': '靠右',
    'Left': '靠左',
    'Align Top': '靠上',
    'Align Center V': '垂直置中',
    'Middle': '中間',
    'Align Bottom': '靠下',
    'Smart Layout': '智能佈局',
    'Column Layout': '直列佈局',
    'Column': '直列',
    'Row Layout': '橫列佈局',
    'Row': '橫列',
    'Grid Layout': '網格佈局',
    '▦ Grid': '▦ 網格',
    'Distribute & Size': '分佈與大小',
    'Distribute Horizontal': '水平分佈',
    '━━ H': '━━ 水平',
    'Distribute Vertical': '垂直分佈',
    '┃┃ V': '┃┃ 垂直',
    'Same Size': '相同大小',
    'CGSize': '同大小',
    'Same Width': '相同寬度',
    '= W': '= 寬',
    'Same Height': '相同高度',
    '= H': '= 高',
    'Stack': '堆疊',
    'Border Color': '邊框顏色',
    'Open Link': '開啟連結',
    'Background Color': '背景顏色',
    'Dark Grey': '深灰',
    'Dark Blue': '深藍',
    'Near Black': '近黑',
    'Charcoal': '炭灰',
    'Light': '淺色',
    'Warm paper': '暖紙色',
    'Paper / Artboard': '紙張 / 畫板',
    'Show Paper': '顯示紙張',
    'Hide Paper': '隱藏紙張',
    'Auto-fit: ON': '自動適應：開',
    'Auto-fit: OFF': '自動適應：關',
    'Paper Color': '紙張顏色',
    'W': '寬',
    'H': '高',
    '4K': '4K',

    // ── GIF Editor ──
    'GIF Trim Editor': 'GIF 裁剪編輯器',
    'Preview': '預覽',
    'Total Frames:': '總幀數：',
    'Duration:': '時長：',
    'Trim:': '裁剪：',
    'Speed:': '速度：',
    'Apply Trim': '套用裁剪',
    'Export GIF': '導出 GIF',
    'Frame Strip (click to set In point)': '影格條 (點擊設定起始點)',

    // ── Context menu ──
    'Duplicate Ctrl+Shift+D': '複製 Ctrl+Shift+D',
    'Copy Ctrl+C': '複製 Ctrl+C',
    'Paste Ctrl+V': '貼上 Ctrl+V',
    '✓ Alt+Left Pan (Mac trackpad)': '✓ Alt+左鍵平移 (Mac 觸控板)',
    '○ Alt+Left Pan (Mac trackpad)': '○ Alt+左鍵平移 (Mac 觸控板)',
    'Same Size Ctrl+Alt+↑': '相同大小 Ctrl+Alt+↑',
    'Distribute H': '水平分佈',
    'Distribute V': '垂直分佈',
    '🧹 Tidy Selected': '🧹 整理選取',
    'Trim GIF': '裁剪 GIF',
    'Download Source File': '下載原始檔',
    'Crop Image C': '裁剪圖片 C',
    'Reframe Image Enter': '重構圖片 Enter',
    'Lock/Unlock': '鎖定/解鎖',
    'Translate EN->中': '翻譯 EN→中',
    'Group Ctrl+G': '群組 Ctrl+G',
    'Ungroup Ctrl+Shift+G': '解散 Ctrl+Shift+G',
    'Bring to Front': '移至最前',
    'Send to Back': '移至最後',
    'Delete Del': '刪除 Del',
    'Import Audio': '匯入音訊',
    'Save Images to Folder...': '儲存圖片到資料夾...',
    '🧹 Tidy All': '🧹 全部整理',
    'Help & Shortcuts H': '幫助與快捷鍵 H',
    '🔗 Toggle Relations': '🔗 切換關係線',

    // ── Player controls ──
    'Player Fullscreen': '播放器全螢幕',
    'Exit Player Fullscreen (Esc)': '退出全螢幕 (Esc)',
    'Open frame comments  (shortcut: M)': '開啟影格留言 (快捷鍵: M)',
    'Draw on the frame (D) — arrows / freehand annotations saved with the next comment': '在影格上繪圖 (D) — 箭頭/手繪註解隨下次留言儲存',
    'Clean mode (H) — hide all controls for distraction-free viewing': '簡潔模式 (H) — 隱藏所有控制項',
    'Snap all annotated frames — batch-capture every frame that has draw/text strokes as a frame comment': '擷取所有註解影格',
    'Snap': '擷取',
    'Press H or click to exit clean mode': '按 H 或點擊退出簡潔模式',

    // ── Video annotation toolbar ──
    'Arrow mode — click and drag to draw an arrow': '箭頭模式 — 拖曳繪製箭頭',
    'Freehand pen mode — click and drag to draw': '手繪筆模式 — 拖曳繪製',
    'Box / rectangle mode — click and drag to draw a box': '方框模式 — 拖曳繪製方框',
    'Circle / ellipse mode — click and drag to draw a circle': '圓形模式 — 拖曳繪製圓形',
    'Text mode — click on the video to place a text annotation': '文字模式 — 點擊影片放置文字註解',
    'Click to pick saturation & brightness': '點擊選擇飽和度與亮度',
    'Drag to pick hue': '拖曳選擇色相',
    'Lock to player — stay in draw mode between strokes (off -> keep current tool, on -> continuous draw)': '鎖定播放器 — 保持繪圖模式',
    'Clear all strokes on this frame': '清除此影格所有筆劃',
    'Done drawing (Esc)': '完成繪圖 (Esc)',
    'Exit draw mode (press the draw button again to come back)': '退出繪圖模式',
    'Snap the draw panel back to the video (re-enable follow)': '將繪圖面板對齊影片',
    'Drag to move the toolbar': '拖曳移動工具列',

    // ── Frame comments popover ──
    'Translate the typed text — auto-detects source language (uses MyMemory/Google translate API; offline / network failure shows a hint)': '翻譯文字 — 自動偵測語言',
    '🌐 → 中': '🌐 → 中',
    '⏳': '⏳',
    'no change': '無變更',
    '✗ offline': '✗ 離線',
    'Add': '新增',
    '📝 (overall comment)': '📝 (整體留言)',
    'Drag to resize': '拖曳調整大小',
    'Click to view full-size snapshot with annotations': '點擊查看完整截圖與註解',
    'Click to jump to this frame': '點擊跳到此影格',
    'Jump to this frame (...)': '跳到此影格 (...)',
    'Translate': '翻譯',
    'Delete': '刪除',
    'Click to type...': '點擊輸入...',
    'Export frame comments + snapshots + over comment to HTML (uses original file name)': '導出影格留言+截圖為 HTML',
    '⤓ Export': '⤓ 導出',
    'Send every snap+text comment to the canvas as a 2-column storyboard...': '將所有截圖+留言發送到畫布',
    '📋 Board': '📋 面板',
    'Export the video with per-frame drawings baked in (.mp4)': '導出含影格繪圖的影片 (.mp4)',
    '🎬 Video': '🎬 影片',
    'Close  (Esc)': '關閉 (Esc)',
    'Delete ALL comments for this video (cannot be undone — confirmation asked)': '刪除此影片所有留言 (無法復原)',
    '🗑 Clear': '🗑 清除',
    'Hide / show snapshot thumbnails on every comment card': '隱藏/顯示留言卡縮圖',
    '📌 Follow': '📌 跟隨',
    'Snap the popover back to the video (re-enable follow)': '將彈窗對齊影片',
    'Show the draw toolbar and start drawing (or press Ctrl+D / the draw button)': '顯示繪圖工具列',
    'Translate every comment to the other language at once (sequential, ~1s per comment)': '一次翻譯所有留言',
    '🌐->中 All': '🌐→中 全部',

    // ── Toast messages (frequent ones) ──
    'Board cleared!': '面板已清除！',
    'Board loaded!': '面板已載入！',
    'Select an item first': '請先選取項目',
    'Select a video first': '請先選取影片',
    'Select items to tidy first': '請先選取要整理的項目',
    'Select 2+ items to group': '請選取 2 個以上項目進行群組',
    'Select items to ungroup': '請選取要解散的群組',
    'Select a text item first': '請先選取文字項目',
    'Select a node first': '請先選取節點',
    'Select a static image to crop': '請選取靜態圖片進行裁剪',
    'Select 1 GIF image': '請選取 1 個 GIF 圖片',
    'Image not loaded': '圖片未載入',
    'Video not ready': '影片尚未就緒',
    'Video not ready yet': '影片尚未就緒',
    'Video not ready yet — wait for it to load': '影片尚未就緒 — 請等待載入',
    'Pasted from clipboard': '已從剪貼簿貼上',
    'Failed to paste image': '貼上圖片失敗',
    'Use Ctrl+V to paste from clipboard': '使用 Ctrl+V 從剪貼簿貼上',
    'Pasted text': '已貼上文字',
    'Pasted link': '已貼上連結',
    'Failed to paste text': '貼上文字失敗',
    'Pasted image': '已貼上圖片',
    'Paste failed': '貼上失敗',
    'Copied ... item(s)': '已複製 ... 個項目',
    'Pasted ... item(s)': '已貼上 ... 個項目',
    'Pasted ... files': '已貼上 ... 個檔案',
    'Grouped ... items': '已群組 ... 個項目',
    'Ungrouped': '已解散群組',
    'Tidied ... items': '已整理 ... 個項目',
    'Comment added at frame': '已在影格新增留言',
    'Comment removed': '留言已刪除',
    'Comment cannot be empty': '留言不可為空',
    'Comment updated': '留言已更新',
    'No comments to export — add at least one frame comment first': '沒有留言可導出 — 請先新增至少一則影格留言',
    'Comments saved — load it later to continue editing': '留言已儲存 — 稍後載入可繼續編輯',
    'No comments to translate': '沒有留言可翻譯',
    'All comments already have a translation': '所有留言已有翻譯',
    'No comments to clear': '沒有留言可清除',
    'Cleared all ... comments': '已清除全部 ... 則留言',
    'No comments to send — add at least one frame comment first': '沒有留言可發送',
    'Sent ... comment(s) to board': '已發送 ... 則留言到面板',
    'No strokes on any frame': '任何影格皆無筆劃',
    'No drawings to export — draw on at least one frame first': '沒有繪圖可導出',
    'Draw mode off — press the draw button to start again': '繪圖模式已關閉 — 再按繪圖按鈕開始',
    'Draw mode on — click ✕ or the draw button to hide': '繪圖模式已開啟',
    'Following video': '已跟隨影片',
    'Frame rate:': '幀率：',
    'fps (manual)': 'fps (手動)',
    'fps (auto)': 'fps (自動)',
    'Saved as PNG': '已儲存為 PNG',
    'Capture discarded': '截圖已放棄',
    'Captured': '已截圖',
    'copied to clipboard': '已複製到剪貼簿',
    'Area too small': '區域太小',
    'Nothing to capture': '沒有可截圖的內容',
    'Screen captured:': '螢幕截圖：',
    'Screen capture cancelled': '螢幕截圖已取消',
    'Screen capture failed:': '螢幕截圖失敗：',
    'Cut shape extracted': '剪裁形狀已提取',
    'Lasso extracted': '套索已提取',
    'Lasso extracted with border': '套索已提取 (含邊框)',
    'Align': '對齊',
    'Column layout': '直列佈局',
    'Row layout': '橫列佈局',
    'Grid layout': '網格佈局',
    'cols)': '列)',
    'Crop cancelled': '裁剪已取消',
    'Crop area too small': '裁剪區域太小',
    'Cropping...': '裁剪中...',
    'Image cropped to': '圖片已裁剪至',
    'Crop failed': '裁剪失敗',
    'Could not load image for cropping': '無法載入圖片進行裁剪',
    'Relation created — double-click line to add label': '關係線已建立 — 雙擊線條新增標籤',
    'Relation deleted': '關係線已刪除',
    'Relations shown': '關係線已顯示',
    'Relations hidden': '關係線已隱藏',
    'Click first item, then second item to connect': '點擊第一個項目，再點擊第二個以連接',
    'Now click the target item': '現在點擊目標項目',
    'Translated to': '已翻譯為',
    'Translation returned no change': '翻譯結果無變更',
    'Translation failed': '翻譯失敗',
    'Translation failed — try again or use 🌐 in Text panel': '翻譯失敗 — 請重試或使用文字面板的 🌐',
    'Text is empty — nothing to translate': '文字為空 — 無內容可翻譯',
    'Opened Google Translate in a new tab — copy result back': '已在 Google 翻譯新分頁開啟 — 請複製結果',
    'Opened Google Translate — copy result back': '已開啟 Google 翻譯 — 請複製結果',
    'Save cancelled': '已取消儲存',
    'Save failed:': '儲存失敗：',
    'Load cancelled': '已取消載入',
    'Auto-saved board restored': '已還原自動儲存的面板',
    'Preparing save...': '準備儲存中...',
    'Choose where to save...': '選擇儲存位置...',
    'Building package...': '建立封裝中...',
    'Generating zip...': '生成 ZIP 中...',
    'Writing': '寫入中',
    'Saved': '已儲存',
    'Downloaded': '已下載',
    'Loading': '載入中',
    'Unlocking': '解鎖中',
    'Unpacking': '解壓中',
    'Restoring media...': '還原媒體中...',
    'Invalid .kpak file (not valid JSON)': '無效的 .kpak 檔案 (非有效 JSON)',
    'Invalid locked kpak: missing lock data': '無效的加密 kpak：缺少鎖定資料',
    'Corrupted locked kpak: no manifest': '損壞的加密 kpak：無清單',
    'Corrupted locked kpak': '損壞的加密 kpak',
    'Error loading: file is empty': '載入錯誤：檔案為空',
    'Error loading: Invalid JSON:': '載入錯誤：無效 JSON：',
    'Error loading:': '載入錯誤：',
    'Please enter a password': '請輸入密碼',
    'Wrong password. Try again.': '密碼錯誤，請重試。',
    'Save failed: JSZip library not loaded. Please refresh the page.': '儲存失敗：JSZip 未載入，請重整頁面。',
    'Folder picker not supported — downloaded instead': '不支援資料夾選擇器 — 改為下載',
    'Folder picker not supported — downloading': '不支援資料夾選擇器 — 下載中',
    'Saved to': '已儲存至',
    'Cannot save: image is cross-origin': '無法儲存：圖片為跨來源',
    'Permission denied': '權限被拒',
    'No images to export': '沒有圖片可導出',
    'Downloaded ... image(s)': '已下載 ... 張圖片',
    'Saved ... image(s) to': '已儲存 ... 張圖片至',
    'Saved ..., failed': '已儲存 ...，失敗',
    'Opened': '已開啟',
    'media)': '媒體)',
    'Failed to open:': '開啟失敗：',
    'Link card added:': '連結卡片已新增：',
    'Link added (no preview available)': '連結已新增 (無預覽)',
    '⏸ All media paused — memory saved': '⏸ 所有媒體已暫停 — 已節省記憶體',
    'No capture to paste': '沒有截圖可貼上',
    'Cannot paste: canvas tainted by cross-origin image': '無法貼上：畫布被跨來源圖片污染',
    'Pasted capture to board': '已將截圖貼到面板',
    'Failed to decode capture image': '解碼截圖失敗',
    'Importing ... images...': '匯入 ... 張圖片中...',
    'Failed to load video:': '載入影片失敗：',
    'Image attached to idea:': '圖片已附加到想法：',
    'Audio attached to idea:': '音訊已附加到想法：',
    'Audio attached:': '音訊已附加：',
    'Audio attached to:': '音訊已附加到：',
    'Image attached to:': '圖片已附加到：',
    'Select a mind map node first to attach audio': '請先選取心智圖節點以附加音訊',
    'Cannot delete the last node': '無法刪除最後一個節點',
    'Node is empty — nothing to translate': '節點為空 — 無內容可翻譯',
    'Translating...': '翻譯中...',
    'Cannot play this audio format in browser': '瀏覽器不支援此音訊格式',
    'Exporting GIF... please wait': '導出 GIF 中... 請稍候',
    'GIF trimmed!': 'GIF 已裁剪！',
    'GIF exported!': 'GIF 已導出！',
    'GIF library not loaded. Check internet connection.': 'GIF 函式庫未載入，請檢查網路連線。',
    'This GIF has only 1 frame (not animated)': '此 GIF 只有 1 幀 (非動畫)',
    'Error loading GIF:': '載入 GIF 錯誤：',
    'Failed to load GIF image': '載入 GIF 圖片失敗',
    'GIF encoder not loaded. Check internet connection.': 'GIF 編碼器未載入，請檢查網路連線。',
    'GIF not loaded': 'GIF 未載入',
    'Need at least 2 frames': '需要至少 2 幀',
    'Encoding GIF... please wait': '編碼 GIF 中... 請稍候',
    'GIF encoding is taking long... try fewer frames or lower quality': 'GIF 編碼耗時較長... 試試減少幀數或降低品質',
    'GIF encoding failed. Try Export instead.': 'GIF 編碼失敗，請改用導出。',
    'GIF trim failed:': 'GIF 裁剪失敗：',
    'GIF export failed:': 'GIF 導出失敗：',
    'Drag to reframe — Enter to apply, Esc to cancel': '拖曳重構 — Enter 套用，Esc 取消',
    'Crop: drag to move, drag handles to resize. Enter to apply, Esc to cancel': '裁剪：拖曳移動，拖曳控點調整大小。Enter 套用，Esc 取消',
    'Masks only work on images': '遮罩僅適用於圖片',
    'Click on the image to pick a color': '點擊圖片選取顏色',
    'Paint on the image to create mask': '在圖片上繪製建立遮罩',
    'Brush mask cleared': '筆刷遮罩已清除',
    'Color picked:': '已選取顏色：',
    'Select or edit a text item first': '請先選取或編輯文字項目',
    'Audio source expired — re-add the file to paste it again': '音訊來源已過期 — 請重新加入檔案',
    'Media source expired — re-add the file to paste it again': '媒體來源已過期 — 請重新加入檔案',
    'Downloading ... file(s)': '下載 ... 個檔案中',
    'No image to download': '沒有圖片可下載',
    'Download failed': '下載失敗',
    'Nothing to clear (draw removed)': '沒有可清除的內容 (繪圖已移除)',
    'Nothing to undo (draw removed)': '沒有可復原的內容 (繪圖已移除)',
    'Jumped to frame': '已跳到影格',
    'comment:': '留言：',
    'Comment': '留言',
    'Frame': '影格',
    'Capturing': '擷取中',
    'frame snapshot(s)': '影格截圖',
    'Export failed:': '導出失敗：',
    'Video export not supported in this browser': '此瀏覽器不支援影片導出',
    'Video duration unknown — wait for it to load': '影片時長未知 — 請等待載入',
    'Your browser does not support MP4 video export — try the latest Chrome': '你的瀏覽器不支援 MP4 影片導出 — 請用最新版 Chrome',
    'Could not start video export:': '無法開始影片導出：',
    'Video saved as': '影片已儲存為',
    'Video downloaded as': '影片已下載為',
    'Video export cancelled': '影片導出已取消',
    'Capturing ... snapshot(s)': '擷取 ... 張截圖中',
    'Snapped f': '已擷取影格',
    'No strokes to snap — draw or type on the video first': '沒有筆劃可擷取 — 請先在影片上繪圖或打字',
    'All ... stroked frames already have comments': '所有 ... 個有筆劃的影格已有留言',
    'Snapped .../... frames': '已擷取 .../... 影格',
    'Snapped ... frame(s)': '已擷取 ... 影格',
    'skipped': '已跳過',
    'Translated ... / ...': '已翻譯 ... / ...',
    'failed': '失敗',
    'Send-to-board not ready yet': '發送到面板尚未就緒',
    'Video export not ready yet': '影片導出尚未就緒',
    'Export not ready yet': '導出尚未就緒',
    'View reset': '視圖已重設',
    'Framed': '已框選',
    'failed:': '失敗：',
    'Failed to load snapshot': '載入截圖失敗',
    'No snapshot for this comment': '此留言沒有截圖',
    'annotation(s) drawn on this frame': '個註解繪於此影格',
    'Jump to frame': '跳到影格',
    'Download image': '下載圖片',
    'No translation available': '沒有可用的翻譯',
    'Translation failed — try again': '翻譯失敗 — 請重試',
    'Select a video to add frame-by-frame comments.': '選取影片以新增逐幀留言。',
    'No comments yet. Pause the video, type above, and press Enter.': '尚無留言。暫停影片，在上方輸入後按 Enter。',
    'No comments yet. Pause the video, then use 💬 Add to mark this frame.': '尚無留言。暫停影片，使用 💬 新增標記此影格。',
    'Preparing export...': '準備導出中...',
    'Exporting video...': '導出影片中...',
    'Bundling…': '打包中…',
    'No snapshots to bundle': '沒有截圖可打包',
    'Download all snapshots (.zip)': '下載所有截圖 (.zip)',
    'Download again': '再次下載',
    'Downloaded ... snapshot(s)': '已下載 ... 張截圖',
    'ZIP build failed:': 'ZIP 建立失敗：',
    '⏹ Stop export': '⏹ 停止導出',
    'Review Mode: hover over a video first': '檢閱模式：請先將滑鼠移到影片上',
    'Review Mode: no comments on this video': '檢閱模式：此影片沒有留言',
    '▶ Play': '▶ 播放',
    'Select': '選擇',
    'Loading shortcuts…': '載入快捷鍵中…',
    'Click a shortcut to rebind — press the new key combo, then Enter to save or Esc to cancel.': '點擊快捷鍵重新綁定 — 按下新組合鍵，Enter 儲存或 Esc 取消。',
    'Reset All': '全部重設',
    'Press keys…': '按下按鍵…',
    'Click to rebind': '點擊重新綁定',
    'Reset to default': '重設為預設',
    'KRAFTED — Help': 'KRAFTED — 幫助',
    '📖 Guide': '📖 指南',
    '⌨️ Shortcuts': '⌨️ 快捷鍵',
    'Krafted v5.5 — by Joker Head Studios': 'Krafted v5.5 — Joker Head Studios',
    'Help / Shortcuts': '幫助 / 快捷鍵',
    'Draw Tool': '繪圖工具',
    'Export Area': '導出區域',
    'Add Link Card': '加入連結卡片',
    'Redo (Shift+Undo)': '重做 (Shift+復原)',
    'Save Board': '儲存面板',
    'Save As…': '另存新檔…',
    'Tidy Selection': '整理選取',
    'Tetris Align Up': '俄羅斯方塊向上對齊',
    'Tetris Align Down': '俄羅斯方塊向下對齊',
    'Tetris Align Left': '俄羅斯方塊向左對齊',
    'Tetris Align Right': '俄羅斯方塊向右對齊',
    'Normalize Size': '標準化大小',
    'Normalize Scale': '標準化縮放',
    'Normalize Height': '標準化高度',
    'Normalize Width': '標準化寬度',
    'Stack Items': '堆疊項目',
    'Pan Canvas (hold)': '平移畫布 (按住)',
    'Show Help / Shortcuts': '顯示幫助 / 快捷鍵',
    'Cancel / Deselect': '取消 / 取消選取',
    'Translate EN->中文': '翻譯 EN→中文',
    'Frame Step Left': '逐幀向左',
    'Frame Step Right': '逐幀向右',
    'Jump 10 Frames Left': '跳 10 幀向左',
    'Jump 10 Frames Right': '跳 10 幀向右',
    'Trim In Point': '裁剪入點',
    'Trim Out Point': '裁剪出點',
    'Edit': '編輯',
    'File': '檔案',
    'Arrange': '排列',
    'Navigation': '導覽',
    'Media': '媒體',
    'Translate': '翻譯',

    // ── Misc ──
    'MP4': 'MP4',
    'Video': '影片',
    'Image': '圖片',
    'F 0': 'F 0',
    '0:00.00': '0:00.00',
    '30 fps': '30 fps',
    'fps': 'fps',
    '0:00': '0:00',
    'f —': 'f —',
    '—': '—',
    'Type here...': '在此輸入...',
    'Krafted Package': 'Krafted 封裝',
    'JSON File': 'JSON 檔案',
    'Checklist': '待辦清單',
    'Mind Map': '心智圖',
    'Original video file name': '原始影片檔名',
    'Comment text size:': '留言文字大小：',
    'Hide / show snapshot thumbnails on every comment card': '隱藏/顯示留言卡縮圖',
    'Snap the popover back to the video (re-enable follow)': '將彈窗對齊影片',
    'Show the draw toolbar and start drawing (or press Ctrl+D / the draw button)': '顯示繪圖工具列',
    'Translate every comment to the other language at once (sequential, ~1s per comment)': '一次翻譯所有留言',
    'Delete ALL comments for this video (cannot be undone — confirmation asked)': '刪除此影片所有留言',
    'Export frame comments + snapshots + over comment to HTML (uses original file name)': '導出影格留言+截圖為 HTML',
    'Send every snap+text comment to the canvas as a 2-column storyboard...': '發送所有截圖+留言到畫布',
    'Export the video with per-frame drawings baked in (.mp4)': '導出含影格繪圖的影片 (.mp4)',
    'Trim start': '裁剪起點',
    'Trim end': '裁剪終點',
    'Reset trim': '重設裁剪',
    'Drag to move': '拖曳移動',
    'Frame rate. Click to cycle 24->25->30->50->60->auto. Right-click to reset to auto-detect.': '幀率。點擊循環 24→25→30→50→60→自動。右鍵重設為自動偵測。',
    'Drag to set trim start': '拖曳設定裁剪起點',
    'Drag to set trim end': '拖曳設定裁剪終點',
    'Snap all annotated frames — batch-capture every frame that has draw/text strokes as a frame comment': '擷取所有註解影格',
    'Save images to a local folder (Chrome / Edge on Win + Mac)': '儲存圖片到本機資料夾 (Chrome/Edge Win+Mac)',
    'Folder picker unavailable — will download each image instead': '不支援資料夾選擇器 — 改為逐張下載',
    'Exporting video...': '導出影片中...',
  };

  // ── State ──
  var currentLang = 'en'; // 'en' | 'zh'
  var REVERSE_MAP = null; // built lazily when switching to zh

  function buildReverseMap() {
    if (REVERSE_MAP) return;
    REVERSE_MAP = {};
    Object.keys(MAP).forEach(function(en) {
      REVERSE_MAP[MAP[en]] = en;
    });
  }

  // ── Walk DOM and translate text nodes + attributes ──
  function walkAndTranslate(root, toZh) {
    var map = toZh ? MAP : (buildReverseMap(), REVERSE_MAP);
    if (!map) return;

    // Skip user content areas — never translate these
    var skipTags = { 'SCRIPT':1, 'STYLE':1, 'TEXTAREA':1, 'INPUT':1, 'SELECT':1, 'CANVAS':1, 'VIDEO':1, 'AUDIO':1, 'IFRAME':1, 'CODE':1, 'PRE':1 };
    // Skip user-editable content
    var skipClasses = ['user-text', 'comment-body', 'mindmap-node', 'todo-text', 'media-filename-badge'];

    function shouldSkip(el) {
      if (!el || !el.tagName) return true;
      if (skipTags[el.tagName]) return true;
      if (el.isContentEditable || (el.getAttribute && el.getAttribute('contenteditable') === 'true')) return true;
      // Skip items on the canvas (user content)
      if (el.closest && (el.closest('.item') || el.closest('.mindmap-node') || el.closest('.todo-item'))) return true;
      // Skip comment bodies
      if (el.closest && el.closest('.comment-body')) return true;
      return false;
    }

    function walk(node) {
      if (!node) return;

      // Text nodes
      if (node.nodeType === 3) { // TEXT_NODE
        var text = node.textContent;
        if (!text || !text.trim()) return;
        var trimmed = text.trim();
        if (map[trimmed] !== undefined) {
          node.textContent = text.replace(trimmed, map[trimmed]);
        }
        return;
      }

      // Element nodes
      if (node.nodeType !== 1) return;
      if (shouldSkip(node)) return;

      // Translate title attribute
      if (node.title && map[node.title] !== undefined) {
        node.title = map[node.title];
      }

      // Translate placeholder attribute
      if (node.placeholder && map[node.placeholder] !== undefined) {
        node.placeholder = map[node.placeholder];
      }

      // Translate aria-label
      if (node.getAttribute && node.getAttribute('aria-label')) {
        var al = node.getAttribute('aria-label');
        if (map[al] !== undefined) node.setAttribute('aria-label', map[al]);
      }

      // Walk children
      var children = node.childNodes;
      if (children) {
        for (var i = 0; i < children.length; i++) {
          walk(children[i]);
        }
      }
    }

    walk(root);
  }

  // ── Translate specific dynamic elements ──
  function translateDynamicElements(toZh) {
    // Status bar
    var statusEl = document.getElementById('status');
    if (statusEl && toZh) {
      var txt = statusEl.textContent || '';
      statusEl.textContent = txt
        .replace(/Zoom:/g, '縮放：')
        .replace(/Items:/g, '項目：')
        .replace(/Undo:/g, '復原：');
    }

    // Paper toggle button
    var paperBtn = document.getElementById('btn-paper-toggle');
    if (paperBtn) {
      var pt = paperBtn.textContent || '';
      if (toZh) {
        paperBtn.textContent = pt.replace('Show Paper', '顯示紙張').replace('Hide Paper', '隱藏紙張');
      } else {
        paperBtn.textContent = pt.replace('顯示紙張', 'Show Paper').replace('隱藏紙張', 'Hide Paper');
      }
    }

    // Auto-fit button
    var autoFitBtn = document.getElementById('btn-autofit-toggle');
    if (autoFitBtn) {
      var at = autoFitBtn.textContent || '';
      if (toZh) {
        autoFitBtn.textContent = at.replace('Auto-fit: ON', '自動適應：開').replace('Auto-fit: OFF', '自動適應：關');
      } else {
        autoFitBtn.textContent = at.replace('自動適應：開', 'Auto-fit: ON').replace('自動適應：關', 'Auto-fit: OFF');
      }
    }
  }

  // ── Main toggle function ──
  function toggleLang() {
    var toZh = (currentLang === 'en');
    currentLang = toZh ? 'zh' : 'en';

    // Walk entire body (but skip canvas content)
    var body = document.body;
    if (body) walkAndTranslate(body, toZh);

    // Handle dynamic elements
    translateDynamicElements(toZh);

    // Update the lang button icon
    updateLangButton();

    // Persist preference
    try { localStorage.setItem('krafted_lang', currentLang); } catch(e) {}

    // Show toast
    if (typeof window.toast === 'function') {
      window.toast(toZh ? '🌐 介面已切換為中文' : '🌐 UI switched to English');
    }

    return currentLang;
  }

  function setLang(lang) {
    if (lang === currentLang) return;
    toggleLang();
  }

  function getLang() {
    return currentLang;
  }

  // ── Lang button in toolbar ──
  function updateLangButton() {
    var btn = document.getElementById('btn-lang');
    if (!btn) return;
    btn.textContent = currentLang === 'zh' ? '中' : 'EN';
    btn.title = currentLang === 'zh' ? 'Switch UI to English' : '切換介面為中文';
  }

  function createLangButton() {
    var existing = document.getElementById('btn-lang');
    if (existing) return existing;

    var toolbar = document.getElementById('toolbar');
    if (!toolbar) return null;

    // Add a separator before the lang button
    var sep = document.createElement('span');
    sep.className = 'tb-sep';
    sep.style.cssText = 'width:1px;height:20px;background:var(--border);margin:0 2px;flex-shrink:0;align-self:center;';
    toolbar.appendChild(sep);

    var btn = document.createElement('button');
    btn.id = 'btn-lang';
    btn.className = 'tb-primary';
    btn.style.cssText = 'font-weight:700;font-size:11px;min-width:32px;padding:0 6px;';
    btn.textContent = currentLang === 'zh' ? '中' : 'EN';
    btn.title = currentLang === 'zh' ? 'Switch UI to English' : '切換介面為中文';
    btn.addEventListener('click', toggleLang);
    toolbar.appendChild(btn);
    return btn;
  }

  // ── Init ──
  function init() {
    // Restore saved preference
    try {
      var saved = localStorage.getItem('krafted_lang');
      if (saved === 'zh') {
        currentLang = 'en'; // toggleLang expects currentLang to be opposite
        // Delay to let DOM render first
        setTimeout(function() {
          toggleLang();
        }, 500);
      }
    } catch(e) {}

    // Create button after a short delay (let toolbar render)
    setTimeout(function() {
      createLangButton();
    }, 300);
  }

  // ── Observe new DOM elements and translate them ──
  var observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function(mutations) {
      if (currentLang !== 'zh') return;
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) {
            walkAndTranslate(node, true);
            translateDynamicElements(true);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start observer once DOM is ready
  setTimeout(startObserver, 1000);

  // ── Public API ──
  return {
    init: init,
    toggle: toggleLang,
    setLang: setLang,
    getLang: getLang,
    t: function(key) { return currentLang === 'zh' && MAP[key] ? MAP[key] : key; },
    MAP: MAP
  };
})();

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { I18N.init(); });
} else {
  I18N.init();
}
