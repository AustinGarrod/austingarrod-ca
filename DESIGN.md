---
name: International Precision
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 64px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.05em
spacing:
  unit: 4px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 16px
  max-width: 1440px
---

## Brand & Style
The brand personality is authoritative, objective, and meticulously structured, drawing heavily from the International Typographic Style (Swiss Design). It targets professional sectors—finance, enterprise technology, and governance—where clarity and objectivity are paramount. The UI evokes a sense of permanence and reliability through extreme order.

The design style is **Modern/Corporate** with a lean toward **Minimalism**. It prioritizes a rigid mathematical hierarchy, removing all non-functional ornamentation. Visual interest is generated through precise alignment, intentional use of negative space, and typographic scale rather than decorative elements.

## Colors
This design system utilizes a high-contrast, professional palette that replaces aggressive signals with sophisticated depth.

- **Primary:** A deep, "ink" black (#0F172A) used for primary typography and structural boundaries.
- **Secondary:** A refined teal (#0D9488) used sparingly for active states, primary actions, and data highlights. It provides a professional, calm alternative to red.
- **Neutrals:** A range of cool greys (Slate) to define hierarchy and UI surfaces without introducing warmth.
- **Backgrounds:** Pure white is the standard for high-legibility "document" feel, with light grey offsets for surface differentiation.

## Typography
The typography follows a systematic, utilitarian approach. **Inter** provides the neutral, neo-grotesque foundation required for Swiss-style layouts, while **JetBrains Mono** is used for technical labels and metadata to reinforce a sense of precision.

Headlines should be set with tight tracking and leading to create a dense, impactful "block" of text. Alignment is strictly flush-left; justified text and centered headings should be avoided to maintain the modular grid integrity.

## Layout & Spacing
The layout is governed by a **Fixed Grid** system. On desktop, a 12-column grid is utilized with a strict 24px gutter. All components, text blocks, and imagery must snap to these column edges.

Spacing follows a strict 4px/8px baseline rhythm. Padding within components is generous to prevent visual clutter and ensure that "white space" acts as a functional separator. 

**Breakpoints:**
- **Desktop (1280px+):** 12 columns, 64px margins.
- **Tablet (768px - 1279px):** 8 columns, 32px margins.
- **Mobile (Below 768px):** 4 columns, 16px margins.

## Elevation & Depth
In keeping with the Swiss aesthetic, depth is communicated through **Tonal Layers** and **Low-contrast outlines** rather than shadows. 

Avoid drop shadows entirely. Instead, use 1px solid borders in light neutrals (#E2E8F0) to define containers. When an element needs to "pop," use a slight background color shift (e.g., White to Slate-50) or a high-contrast black fill. Overlays should use a subtle, 80% opacity neutral wash to maintain the flat, architectural feel of the interface.

## Shapes
This design system uses a **Sharp** shape language. All corners for buttons, cards, inputs, and containers are set to 0px. This reinforces the rigid, architectural nature of the grid and ensures that all elements align perfectly with the 1px border system without gaps.

## Components
- **Buttons:** Primary buttons are solid "ink" black (#0F172A) with white text. Secondary buttons are transparent with a 1px black border. All buttons are rectangular with no rounded corners.
- **Input Fields:** 1px solid borders. On focus, the border weight remains 1px but changes to the Teal accent (#0D9488). Labels are set in JetBrains Mono at 12px.
- **Cards:** Defined by a 1px border. No shadows. Content inside cards must follow the internal 8px spacing rhythm.
- **Chips/Badges:** Rectangular with a light grey background and dark grey text. Use the Teal accent only for "Active" or "Positive" status indicators.
- **Lists:** Separated by 1px horizontal hair-lines. High vertical padding (16px+) between items to maintain readability.
- **Data Tables:** High-density, no vertical lines, only horizontal rules. Header row set in bold JetBrains Mono.