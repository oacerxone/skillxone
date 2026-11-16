# Design system specification

Status: **proposed** (Phase 0). Tokens are implemented in `packages/ui/tokens` in Phase 1.

## Principles

1. **The list is the product.** A developer should compare eight skills without scrolling. Rows before cards.
2. **Evidence beside the claim.** A verification badge always links to its report; a rank always has a "why".
3. **One accent, used for action.** Colour otherwise carries state only.
4. **Quiet by default.** No gradients, glass, glow, illustration or decorative motion.
5. **Real numbers or none.** Empty states say what is missing; nothing is padded with invented statistics.

## Typography

- Sans: **Geist Sans** (OFL, self-hosted as a variable WOFF2), fallback `system-ui`.
- Mono: **Geist Mono** for commands, SHAs, paths, hashes and counts in tables.

| Token     | Size / line | Weight        | Use                    |
| --------- | ----------- | ------------- | ---------------------- |
| `display` | 40 / 44     | 600, -0.02em  | Homepage headline only |
| `h1`      | 28 / 34     | 600, -0.015em | Page titles            |
| `h2`      | 20 / 28     | 600           | Section titles         |
| `h3`      | 16 / 24     | 600           | Card and panel titles  |
| `body`    | 14 / 22     | 400           | Default                |
| `small`   | 13 / 20     | 400           | Table cells, metadata  |
| `caption` | 12 / 16     | 500           | Labels, badges         |
| `mono`    | 13 / 20     | 400           | Technical values       |

Base size is 14 px for density. Rendered Markdown uses 15 / 26 with a 72-character measure.

## Colour

Neutral scale with a single indigo accent. Values in OKLCH; hex shown for reference.

| Token           | Light     | Dark      |
| --------------- | --------- | --------- |
| `bg`            | `#ffffff` | `#0b0c0e` |
| `bg-subtle`     | `#fafafa` | `#111316` |
| `bg-muted`      | `#f3f4f5` | `#191c20` |
| `border`        | `#e5e6e8` | `#24282d` |
| `border-strong` | `#cfd1d5` | `#343940` |
| `text`          | `#111315` | `#edeef0` |
| `text-muted`    | `#5b616b` | `#9aa1ab` |
| `text-subtle`   | `#666c76` | `#8a919c` |
| `accent`        | `#3b49df` | `#8b95ff` |
| `accent-fg`     | `#ffffff` | `#0b0c0e` |
| `focus`         | `#3b49df` | `#a5adff` |

State colours, each with a tinted background and a text colour that meets 4.5:1 on it:

| State      | Light text / bg       | Dark text / bg        | Icon            |
| ---------- | --------------------- | --------------------- | --------------- |
| Verified   | `#12703f` / `#e9f6ee` | `#5fd092` / `#10241a` | check in shield |
| Unverified | `#5b616b` / `#f3f4f5` | `#9aa1ab` / `#191c20` | dashed circle   |
| Flagged    | `#b3261e` / `#fdecea` | `#ff8a80` / `#2a1412` | triangle        |
| Warning    | `#8a5a00` / `#fdf3dc` | `#f0be5a` / `#261d0a` | —               |

Unverified is deliberately neutral grey, not amber or red: it is the absence of an assessment, not a warning. State is never conveyed by colour alone; every badge has an icon and a text label.

All text pairs are checked for WCAG 2.2 AA contrast by an automated test over the token file.

## Space, shape, elevation

- Spacing scale (px): 2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64.
- Radius: 4 (inputs, badges), 6 (buttons, cards), 8 (dialogs). Nothing larger.
- Borders: 1 px `border`. Surfaces are separated by borders, not shadows. One shadow token exists, for popovers and dialogs.
- Content width: 1200 px max; reading column 720 px.
- Table row height: 44 px comfortable, 36 px compact.

## Motion

100-150 ms ease-out on hover, focus and popover open. No entrance animation, no parallax, no skeleton shimmer. `prefers-reduced-motion: reduce` removes all transitions.

## Components

| Component                       | Notes                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Top navigation                  | 48 px tall. Logo, Explore, Categories, Trending, Verified, Collections, Submit Skill, GitHub. Search trigger with `/` and `⌘K` hints. Collapses to a menu button below 768 px. Secondary links (Documentation, API, Contribute, About) live in the footer and the mobile menu. |
| Search field                    | Large on the homepage (48 px), compact in the header. Debounced 150 ms, suggestions in a listbox following the ARIA combobox pattern, matches highlighted with `<mark>`.                                                                                                       |
| Filter bar                      | Agent chips (Claude Code, Codex), verification select, category select, sort select, list/card toggle. All state lives in the URL query string.                                                                                                                                |
| Skill row                       | Name and one-line description, owner/repo in mono, stars, last update (relative, with exact date in `title`), agent marks, verification badge, copy-install button.                                                                                                            |
| Skill card                      | Optional layout of the same data; three per row on desktop.                                                                                                                                                                                                                    |
| Verification badge              | Icon, label, links to the report. Three variants only.                                                                                                                                                                                                                         |
| Install panel                   | Agent segmented control, project/global toggle, command in a mono block with a copy button, prerequisites, warnings, collapsible update and uninstall instructions. A flagged or unverified skill shows its notice above the command, not instead of it.                       |
| Security report                 | Summary line, checks run and skipped, findings grouped by severity; each finding shows rule id, file and line link to GitHub at the scanned commit, explanation, remediation, and a "Report false positive" action.                                                            |
| Markdown view                   | Sanitised output, headings anchored, code blocks with copy.                                                                                                                                                                                                                    |
| File tree                       | Supporting files with size and kind; text files open in a viewer, binaries are listed only.                                                                                                                                                                                    |
| Data table (admin)              | Sortable, paginated, bulk actions with confirmation dialogs.                                                                                                                                                                                                                   |
| Empty, error and loading states | One line saying what happened and one action. Loading uses static placeholders.                                                                                                                                                                                                |
| Toast                           | Copy confirmation and form results; announced through a polite live region.                                                                                                                                                                                                    |

## Page layouts

- **Homepage**: navigation; headline and one-sentence subhead; search with agent quick filters; Trending (8 rows); Featured categories (grid of text tiles with real counts); Verified (6 rows); Recently updated (6 rows); Collections; contributor call to action (one bordered band); footer.
- **Explore / search**: filter bar, result count, list, pagination (page numbers in the URL for SEO; 30 per page).
- **Skill detail**: two columns from 1024 px. Main: title, description, tabs (Overview with rendered SKILL.md, Files, Security, Versions). Aside (sticky): install panel, verification summary, repository statistics, compatibility, dependencies, license, report link. Related skills below. Single column on mobile with the install panel directly under the title.
- **Admin**: left rail of modules, dense tables, no charts unless backed by stored history.

## Accessibility (WCAG 2.2 AA)

- Landmarks, one `h1` per page, ordered headings, skip link.
- Full keyboard operation; 2 px focus ring with 2 px offset in `focus` colour, never removed; focus not obscured by the sticky header.
- Targets at least 24 × 24 px; primary controls 32 px or more.
- Form fields have visible labels, described errors, and `aria-live` status.
- Tables use `<th scope>`; icon-only buttons have accessible names.
- Theme follows `prefers-color-scheme` only after the user opts in; default is light, with a toggle that persists in `localStorage` and is applied before paint to avoid a flash.
- Automated: axe-core in Playwright on every page template in both themes. Manual: keyboard walk-through and VoiceOver check per phase.

## Performance budget

- Public pages are server-rendered; client JavaScript is limited to search, the install panel, theme toggle and copy buttons.
- Budget per public page: 90 KB compressed JavaScript, LCP under 2.0 s on a simulated mid-tier phone against a 2 vCPU VPS, CLS under 0.05. Measured in Phase 10, not asserted now.
- Two font files, preloaded, `font-display: swap`. No remote images from repositories; owner avatars load from GitHub's avatar host with fixed dimensions and lazy loading.
