# FIAA Evolution theme

## Compact token summary

- Brand red: `--red: #a90026`; dark red: `--red-dark: #7d001c`
- Ink: `#111313`; secondary ink: `#202222`; paper: `#f5f3ee`; white: `#fff`
- Muted: `#667078`; border: `#dcdedb`; success: `#17744a`
- Body: Nunito Sans 400–800; display: Rubik 500–800
- Radii: 10px, 18px, 28px; buttons use 9px
- Shadow: `0 18px 50px rgba(13,18,21,.1)`
- Content width: `min(1180px, calc(100% - 40px))`; mobile gutters 14px
- Responsive breakpoints: 980px, 680px, 390px
- Motion: 180–220ms controls/drawers; 650ms hero fade; 6s subtle hero zoom/progress; reduced-motion override

## Raw source

Source: `styles.css`

```css
:root {
  --red: #a90026;
  --red-dark: #7d001c;
  --ink: #111313;
  --ink-2: #202222;
  --paper: #f5f3ee;
  --white: #fff;
  --muted: #667078;
  --line: #dcdedb;
  --success: #17744a;
  --shadow: 0 18px 50px rgba(13, 18, 21, 0.1);
  --radius-sm: 10px;
  --radius: 18px;
  --radius-lg: 28px;
  --shell: min(1180px, calc(100% - 40px));
}
body { margin: 0; background: var(--paper); color: var(--ink); font-family: "Nunito Sans", sans-serif; font-size: 16px; line-height: 1.55; }
h1, h2, h3 { font-family: "Rubik", sans-serif; letter-spacing: -.035em; line-height: 1.08; }
.shell { width: var(--shell); margin-inline: auto; }
:focus-visible { outline: 3px solid rgba(211,0,48,.35); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:.01ms!important; transition-duration:.01ms!important; } }
@media (max-width: 680px) { :root { --shell:min(100% - 28px,1180px); } }
```

There is no Tailwind configuration or theme provider. All visual tokens and responsive rules live in the 378-line `styles.css` file, which should be passed whole to design commands because it is below the 900-line trimming threshold.
