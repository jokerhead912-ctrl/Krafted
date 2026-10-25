# 人手 checklist —— 自動化唔到嘅動作

點解要人手：OS 嘅「拖一個 folder 入瀏覽器」呢個動作，Playwright / CDP **做唔到**
（佢冇辦法合成一個帶 `webkitGetAsEntry()` 嘅 DataTransfer）。而呢個動作正正係
P2 嘅核心路徑 —— 所以一定要你親手跑，兩部機各一次。

每格填：**觀察到乜**（唔好填「OK」，填你見到嘅字／行為）。

---

## A. 拖 folder（P2 嘅關鍵證據）— Mac + Win 各一次

準備：`Krafted/audit/fixtures/footage/` 已經有現成嘅料
（`takeA/` 同 `takeB/` 裡面各有一個 **`shot01.mp4`**，size 唔同：14,313,976 vs 18,002,861）。
Win 機要自己整一個同樣結構嘅（複製兩條唔同 size 嘅片都得）。

1. 開 https://jokerhead912-ctrl.github.io/Krafted/kraftpub.html
2. 將成個 `footage` folder 拖入板（**拖 folder，唔係拖入去揀檔**）
3. 數卡：應該出 **6 張片**（`takeA/shot01` 嘅 proxy、`takeB/shot01` 嘅 proxy、
   `CaseTest` 嗰對、`mimes/shot05.mp4`；兩個原檔因為有 proxy 配對而唔會出卡；
   `.mxf` 會被 skip）
   → 我見到 ______ 張
4. toast 寫乜？（應該有「已配对 N 个代理档」同「已略过 1 个不支援的档案」）
   → 我見到：____________________________________
5. **關鍵**：右鍵 `takeA` 嗰張 proxy 卡 → `Link original`。
   - 而家（v7.30.1）應該**即時駁上**，唔開揀檔對話框
   - 駁完卡面 chip 寫 **ORIG**，同埋播嘅係原檔
   → 有冇開對話框？______　chip 寫乜？______
6. 再右鍵 `takeB` 嗰張 → 同樣唔使揀檔，而且駁嘅係 **takeB** 嗰條
   （14.3 MB vs 18.0 MB —— 如果你見到兩張卡駁咗同一條，即係 P2 未修好）
   → takeA 卡駁咗邊條？______　takeB 卡駁咗邊條？______
   **兩條要唔同。**

---

## B. 拖成個 folder 之後「同名同 size」— 已知限制，確認唔係退化

`twinsA/shot02.mp4` 同 `twinsB/shot02.mp4` **size 完全一樣（51,553,100）但 bytes 唔同**。

7. 淨拖 `twinsA` + `twinsB` 兩個 folder 入板，然後右鍵 link original
   → 兩張卡駁到邊條？__________
   （預期：有路徑 → 各駁各嘅。如果駁錯，話我知。）

---

## C. 冷啟動（SW 未 warm）

8. Chrome 開 **無痕視窗**（保證冇 SW cache）→ 開 Krafted
9. 由撳 Enter 到見到板可以撳：______ 秒（用手機秒錶都得）
   預算：Mac ≤ 2.0 s / Win ≤ 3.0 s（第二次開應該快好多）

---

## D. 審片手感（冇得自動化，淨係你話事）

10. 一塊有 3 條片嘅板，逐條 scrub（拖時間軸）：
    → 跟手？______　定係要等？______
11. 一塊 ~80 個 item 嘅板，pan 同 zoom：
    → 拖泥？______

---

跑完將呢份填好畀我，或者淨係話我知邊一格同預期唔同。
