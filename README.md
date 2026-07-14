# Krafted — Creative Reference Board

**by Joker Head Studios** | v5.5

---

## 🔒 Developer Setup (PRIVATE — never share)

### 1. Keep your source safe

```
krafted-build/
├── Krafted_v5.2_PWA.html    ← YOUR DEV FILE (keep private!)
├── build.sh                  ← Build script
├── docs/                     ← PUBLIC output (this goes to GitHub Pages)
│   ├── kraftpub.html
│   └── version.json
└── README.md
```

### 2. Required local JS files

Place these alongside `Krafted_v5.2_PWA.html`:
- `krafted-format.bundle.js`
- `krafted-v5-integration.js`

### 3. Build the public version

```bash
./build.sh
```

This creates `docs/kraftpub.html` — the protected version you share.

### 4. Deploy to GitHub Pages

```bash
git add docs/
git commit -m "Build Krafted v5.2"
git push
```

Then in GitHub repo Settings → Pages:
- Source: Deploy from a branch
- Branch: main, Folder: /docs

Your app will be live at: `https://YOUR_USERNAME.github.io/YOUR_REPO/kraftpub.html`

---

## 🛡️ Protection Layers

| Layer | What it does |
|-------|-------------|
| **PWA Service Worker** | Caches the app for offline use; auto-updates when you push new builds |
| **Console Watermark** | Copyright notice embedded in JS — visible in DevTools |
| **Build Integrity Hash** | Unique per-build hash to detect tampering |
| **Master Password** | `jokerhead` — always unlocks locked boards |
| **Private Repo** | Your dev source NEVER goes public |

---

## 🚀 Sharing with your team

1. Run `./build.sh`
2. Push to GitHub
3. Share the URL: `https://YOUR_USERNAME.github.io/YOUR_REPO/kraftpub.html`
4. They can "Install" it as a PWA (Add to Home Screen / Desktop)
5. Works offline after first load

---

## ⚠️ Important

- **Never commit `Krafted_v5.2_PWA.html` to a public repo**
- Keep your GitHub repo **PRIVATE**
- Only `docs/` folder is deployed publicly
- For maximum protection, run JavaScript obfuscation before deploying:
  ```bash
  npx javascript-obfuscator docs/kraftpub.html --output docs/kraftpub.html \
    --compact true --control-flow-flattening true --dead-code-injection true
  ```

---

© 2025 Joker Head Studios. All rights reserved.
