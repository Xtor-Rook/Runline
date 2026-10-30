RUNLINE v0.6 — INSTALLABLE PWA

WHAT CHANGED
- Installable web-app manifest
- iPhone/iPad Home Screen metadata
- Full-screen standalone app mode
- Offline app-shell caching via service worker
- 180 / 192 / 512 px app icons, including a maskable icon
- In-app Install Runline card with browser-specific guidance
- Safe-area padding for iPhone notch / Dynamic Island / Home indicator
- Existing v0.5 course planning, video review and timeline features retained

IMPORTANT: PWA installation requires HTTPS (or localhost for development).
Opening index.html directly from Files/Finder is useful for previewing, but service workers and Home Screen installation require the folder to be hosted.

IPHONE / IPAD INSTALLATION
1. Upload this entire folder to an HTTPS website. Keep the file/folder structure intact.
2. Open the resulting Runline URL in SAFARI on the iPhone/iPad.
3. Tap the Share button.
4. Tap “Add to Home Screen”.
5. Confirm the name Runline and tap Add.
6. Launch Runline from its new Home Screen icon.

MAC / DESKTOP
Chrome/Edge: open the hosted URL and use the browser's Install app control.
Safari on macOS: use File > Add to Dock where supported.

HOSTING OPTIONS
- GitHub Pages
- Netlify
- Cloudflare Pages
- Any HTTPS-enabled static web host / your own domain

DATA NOTE
Runline data and saved video blobs are browser/device-local. A fresh hosted origin is a different storage location from a file:// preview or another domain. Export a Runline JSON backup before moving domains and restore it in the installed copy. Video files are not included in JSON backups, so keep the original run videos separately.
