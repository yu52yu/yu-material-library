# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product direction

- Desktop libraries use native filesystem change notifications and update only changed paths, with no periodic or focus-triggered full scans. Initial loading and explicit refresh read the directory. Preserve browsing/selection state and invalidate image previews after overwrite saves. Users can save from creative tools straight into connected project/category folders.

- Project file categories accept custom names in the organizer, offer existing categories, and retain custom folder categories when rescanning both managed and linked projects.

- Browsing, changing projects/tabs, and refreshing must never automatically select the first material. Project materials support explicit single/batch moves between 制作素材 and 参考素材; linked projects organize within their own folder.

- Both the left navigation and right inspector must have draggable width dividers, persist their widths locally, and reserve usable space for the material list. Double-clicking a divider restores its default width.

- Product name: `瑜の素材库`.
- Keep the information architecture intentionally shallow: reusable `素材` split into `下载素材` and `AI制作素材`; project content split by project, then `参考素材` and `制作素材`, with `源文件/PS源文件`, `详情页`, and `渲染图`.
- The selected visual direction is a light, thumbnail-first creative desktop tool with warm off-white surfaces, graphite typography, restrained forest-green accents, and a modern knight shield/helmet identity.
- Avoid game-like fantasy styling, decorative dashboard features, and deep folder trees.
- The user explicitly wants their own computer files to populate the library. Do not generate or bundle demo material thumbnails; the app must read real selected folders/files and show an honest empty state before import. The approved generated knight crest is the only product image asset.
- Deliver as a Windows desktop application. Use the approved knight logo for the executable, installer, taskbar, and desktop shortcut. Folder indexing is read-only; explicit file import copies to 待整理 without overwriting originals.
- A selected unstructured folder is a direct project, not 待整理. Desktop users can link external project folders by picker or drag-and-drop without copying them. Managed-library inbox files can be explicitly moved through the 整理到 flow.
- Loose files dropped while viewing `下载素材` or `AI制作素材` go directly into that active area under `未分类`. If only a direct project is connected, ask once for a reusable-material save location, then keep that project linked.
- Material cards support batch selection through their top-left selectors, Ctrl/Cmd-click, Shift-range selection, and a batch toolbar for selecting all visible results, clearing the selection, or moving/classifying multiple managed files together.
- A managed library indexes only `00_待整理`, `01_素材`, and `02_项目素材`; unrelated sibling application files must never appear as inbox items. Managed files can be moved to the OS recycle bin after confirmation, including in batches. Category chips may have locally persisted display-name aliases without renaming source folders.
- Category chip order is independently persisted per reusable area and per project/mode context. `未分类` defaults immediately after `全部`, and users can drag category chips to customize their order.
- In grid view, the multi-select control may overlay the thumbnail corner; in list view, it belongs at the far right of the row and must not cover the thumbnail.
- User rejected the deep-green v0.8 sidebar. Use pearl white and silver-gray surfaces, graphite text, restrained blue-gray accents, and subtle cool silver gradients on the sidebar, headers, active chips, and primary buttons. Preserve the knight logo. Honor reduced-motion settings, keep list selectors at the row's right edge, and avoid animating every item during large imports.
- The logo is now a refined silver/titanium knight shield with a crimson aurora light ribbon from the image-left eye. Use the same transparent source for app branding and the multi-resolution Windows icon; no green emblem or solid backdrop.

- Desktop material cards and inspector use persistent, versioned local thumbnails with bounded generation concurrency; opening a file retains the original. File overwrites invalidate thumbnails.
- Desktop thumbnails must drag the original local file into Photoshop and other apps' file upload targets. A preview image must never become the drag payload; keep thumbnail display and native file dragging separate.
