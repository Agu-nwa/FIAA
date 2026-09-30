# FIAA Evolution design system

## Product context

FIAA Evolution is a Nigerian automotive parts, accessories, and car-knowledge storefront. The public experience serves both experienced importers/traders who identify brake parts by familiar product numbers and less-technical drivers who identify their vehicle first. Every public product fact must come from owner-approved database records; never fabricate inventory, price, fitment, stock, or imagery.

The planned administration experience is for FIAA owners and trusted staff. Its primary jobs are reviewing catalogue records, resolving publication problems, approving products and content, managing orders, and checking launch readiness. It must favor accuracy, traceability, and clear status over decorative density.

## Brand

- Use the exact FIAA Evolution logo from `assets/fiaa-logo-pack.png`.
- Primary red: `#a90026`; hover red: `#c5002e`; dark red: `#7d001c`.
- Ink: `#111313`; secondary ink: `#202222`.
- Warm paper: `#f5f3ee`; white: `#ffffff`; line: `#dcdedb`.
- Muted text: `#667078`; success: `#17744a`.
- Do not introduce unrelated accent colors, gradients, or alternate logo treatments.

## Typography

- Display/headings: Rubik, weights 500–800, tight letter spacing (`-.035em`), line height around 1.08.
- Interface/body: Nunito Sans, weights 400–800, line height 1.55.
- Clear sentence case for controls. Uppercase with tracking is reserved for short eyebrow/status labels.

## Shape, spacing, elevation

- Content shell: maximum 1180px with 20px desktop and 14px mobile gutters.
- Spacing should follow a practical 4/8px rhythm; major sections use 70–100px vertical space.
- Radii: 10px small, 18px cards, 28px feature surfaces; buttons use 9px.
- Standard shadow: `0 18px 50px rgba(13,18,21,.1)`; avoid excessive elevation.
- Borders use `#dcdedb` or a close neutral with strong red focus indication.

## Components

- Primary actions: solid brand red, white label, 48px minimum height.
- Secondary actions: transparent neutral border; darken on hover.
- Cards: white on warm paper, thin neutral border, 18px radius.
- Forms: visible labels, 48px minimum controls, neutral borders, red focus ring, inline actionable errors.
- Status badges: semantic color plus text; never rely on color alone.
- Data tables: readable rows, sticky or persistent headings where useful, responsive cards or horizontal containment on narrow screens.
- Destructive or irreversible administration actions require explicit confirmation and a reason.

## Responsive behavior

- Desktop breakpoint: 980px; primary mobile breakpoint: 680px; compact breakpoint: 390px.
- Mobile is first-class: controls remain at least 44px, key actions stay reachable, dense tables transform safely, and no horizontal page overflow is allowed.
- Public storefront uses a fixed five-item mobile bottom navigation. Administration should use a compact top bar and collapsible navigation suitable for phones rather than copying the consumer bottom navigation.

## Motion and accessibility

- Interaction transitions: 180–220ms; drawer entrance around 220ms; use restrained movement.
- Honor `prefers-reduced-motion` by eliminating nonessential animation.
- Preserve skip navigation, landmarks, native semantics, keyboard operation, clear focus rings, live regions, and sufficient color contrast.
- Never place essential text only inside images.

## Administration information architecture

- Overview: launch readiness, catalogue status counts, content readiness, notification backlog, and actionable problems.
- Products: searchable/filterable list; product detail/review; publication problems; transition history.
- Content: policy/support drafts, version details, preview, publish action.
- Orders: status-focused list and detail, with private customer data shown only to authorized staff.
- System: provider/configuration readiness, not raw secrets.

The admin UI must clearly distinguish draft, review, approved, published, archived, pending, failed, and ready states. It should expose the reason and next action for every blocked publication rather than merely showing an error count.
