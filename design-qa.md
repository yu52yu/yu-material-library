# Design QA

## Comparison target

- Source visual truth: `C:\Users\thinkpad\Documents\ChatGPT\本地素材库\yu-material-library\design\reference-ui.png`
- Browser-rendered implementation: `C:\Users\thinkpad\Documents\ChatGPT\本地素材库\yu-material-library\design\implementation-empty-state.png`
- Full-view comparison: `C:\Users\thinkpad\Documents\ChatGPT\本地素材库\yu-material-library\design\qa-comparison.png`
- Focused brand/header comparison: `C:\Users\thinkpad\Documents\ChatGPT\本地素材库\yu-material-library\design\qa-focus-brand-header.png`
- Browser URL: `http://localhost:4173/`
- State: first-run empty library, no user folder connected.

The source mock and implementation intentionally show different content states. The source contains generated example files; after the user clarified that only their own computer files should populate the library, the implementation correctly shows an empty first-run state. The comparison therefore treats the source as truth for the application shell, brand, proportions, hierarchy, and visual tokens—not for demo content.

## Dimensions and normalization

- Source pixels: 1486 × 1059.
- Implementation screenshot pixels: 1440 × 967, captured by the Codex in-app browser.
- CSS viewport: 1440 × 1024 at device pixel ratio 1.
- Normalization: the source was fit to the implementation capture size (1440 × 967) before the side-by-side comparison. The aspect-ratio difference was negligible and no density mismatch was used as evidence.

## Findings

- No actionable P0, P1, or P2 visual differences remain for the approved shell.
- Typography: the implementation uses Microsoft YaHei UI/PingFang SC system fallbacks with close weight, line-height, and hierarchy to the source. Brand, page title, navigation, controls, and helper text remain legible without clipping.
- Spacing and layout: the 240 px navigation rail, top search/action bar, flexible content canvas, and 306 px inspector reproduce the source structure. The intentional empty-state message is centered within the content area and does not disturb the persistent shell.
- Colors and tokens: warm white surfaces, graphite text, pale forest-green selection, deep-green primary action, thin neutral dividers, restrained radius, and minimal elevation match the chosen direction.
- Image quality: the only bundled product image is the approved transparent knight crest. Generated feeder, aquarium, and ecommerce demo images were removed. Future thumbnails come directly from user-selected files; unsupported source formats use icon-library file tiles or a same-name preview image when present.
- Copy and content: all application copy is Simplified Chinese and reflects the agreed `下载素材 / AI制作素材 / 项目素材 / 参考素材 / 制作素材` model. The empty state explicitly says original files are read but not moved or modified.
- Icons: all interface icons come from Phosphor Icons; there are no handcrafted SVG or CSS-art substitutes.
- Responsiveness: at 900 px the inspector hides and the page has no horizontal overflow; at 640 px the sidebar contracts to 62 px, the import button to 48 px, and the page still has no horizontal overflow.
- Accessibility: semantic buttons, navigation labels, focus outlines, image alt text, keyboard-selectable asset cards, and readable contrast are present.

## Interaction verification

- Import menu opens and exposes `选择本地文件`, `读取素材库文件夹`, and `创建基础目录结构`.
- `待整理`, `下载素材`, and `AI制作素材` navigation states switch correctly.
- Grid/list view state switches correctly.
- Browser console errors and warnings checked: none.
- Folder access itself remains a user-controlled browser permission step and was not granted during automated QA. The in-app browser's native file chooser could not be exercised by automation; this is a manual test gap, not a visual defect.

## Comparison history

- Initial build used generated demo thumbnails. User clarified that the app must be populated only by their own local files.
- Fix: removed every generated demo thumbnail from the project, preserved only the approved knight logo, replaced static sample records with a real recursive folder scanner, path classification, local image object URLs, source-file tiles, and an honest first-run empty state.
- Post-fix evidence: `implementation-empty-state.png`, `qa-comparison.png`, and `qa-focus-brand-header.png` show the corrected browser-rendered result.

## Follow-up polish

- P3 manual verification: connect a real user-selected test folder and confirm permission persistence, very large-library performance, and PSD/Blender sidecar-preview matching with representative files.

## Implementation checklist

- [x] Approved knight identity and source shell reproduced.
- [x] Demo material images removed.
- [x] Real local file and folder ingestion implemented.
- [x] Agreed folder hierarchy recognized automatically.
- [x] Search, filters, project/mode navigation, selection, favorites, and grid/list controls implemented.
- [x] Desktop and compact-width layouts checked.
- [x] Production build passes.

final result: passed
