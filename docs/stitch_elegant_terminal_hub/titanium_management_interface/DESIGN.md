---
name: Titanium Management Interface
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bbcabf'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#86948a'
  outline-variant: '#3c4a42'
  surface-tint: '#4edea3'
  primary: '#4edea3'
  on-primary: '#003824'
  primary-container: '#10b981'
  on-primary-container: '#00422b'
  inverse-primary: '#006c49'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#ffb95f'
  on-tertiary: '#472a00'
  tertiary-container: '#e29100'
  on-tertiary-container: '#523200'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6ffbbe'
  primary-fixed-dim: '#4edea3'
  on-primary-fixed: '#002113'
  on-primary-fixed-variant: '#005236'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-margin: 2rem
  gutter: 1.5rem
  sidebar-width: 260px
  row-height: 3.5rem
  stack-gap: 1rem
---

## Brand & Style
The brand personality is **utilitarian elegance**. It is designed for system administrators and DevOps engineers who require a high-density information environment that doesn't sacrifice visual clarity or aesthetic sophistication. The design system shifts away from the saturated gradients and cluttered sidebars of traditional enterprise tools toward a **refined minimalist** aesthetic.

The visual mood is established through:
- **Professionalism:** A palette dominated by deep slates and charcoals to reduce eye strain during long sessions.
- **Trust:** Precise alignment and consistent use of a single, vibrant emerald accent to denote system health and primary actions.
- **Efficiency:** A "breathing" layout that uses white space to group related data without the need for heavy visual containers.

## Colors
The color strategy employs a **Deep Slate Foundation**. The background uses a near-black ink (`#020617`) to maximize contrast with text. 

- **Primary Emerald (`#10B981`):** Reserved strictly for "Success" states, system "Online" indicators, and primary call-to-action buttons.
- **Surface Tiers:** UI depth is created through varying shades of charcoal and slate rather than shadows. The sidebar and header utilize a slightly lighter value than the main content area to create a structural hierarchy.
- **Data Accents:** Secondary blue is used for interactive links and SSH terminal text, while amber is reserved for "Warning" or "Pending" server states.

## Typography
The system uses **Hanken Grotesk** for its modern, geometric clarity in headings and UI labels. To support the technical nature of server management, **JetBrains Mono** is integrated for all data-heavy strings, IP addresses, and terminal outputs.

- **Scale:** Maintain a tight typographic scale. Most UI labels should hover between 12px and 14px to ensure high information density.
- **Hierarchy:** Use font weight (Medium/SemiBold) rather than size to differentiate table headers from row content.
- **Monospace Integration:** Any field containing an IP address, SSH key, or port number must use the `label-mono` or `code-sm` tokens to ensure character alignment and legibility.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model. The sidebar remains fixed at 260px to provide a constant navigation anchor, while the main dashboard area fluidly expands.

- **Breathing Room:** A generous 2rem margin surrounds the primary content area to prevent the "cluttered" feeling typical of server tools.
- **Grid:** Use a 12-column grid for dashboard widgets. Individual server cards or stats should span 3 or 4 columns.
- **Data Tables:** Implement a "comfortable" row height (56px) for the primary server list. This allows for clear multi-line information (e.g., Server Name + IP) within a single row without feeling cramped.

## Elevation & Depth
Depth is achieved through **Tonal Layering** rather than traditional drop shadows, which can feel "muddy" in dark interfaces.

- **Tier 1 (Background):** The lowest layer (`#020617`). Used for the main app canvas.
- **Tier 2 (Containers):** Cards and the side navigation use a slightly elevated slate (`#0F172A`).
- **Tier 3 (Active/Hover):** Modals or active dropdowns use a lighter surface (`#1E293B`).
- **Borders:** All containers must feature a 1px solid border (`#1E293B`). This provides crisp definition between dark surfaces where shadows would be invisible.

## Shapes
The design system employs a **Rounded** language (8px default) to soften the technical edge of the interface.

- **Containers:** Dashboard cards and the main server list container use a 12px radius (`rounded-lg`).
- **Action Elements:** Buttons, input fields, and chips use an 8px radius (`rounded-md`).
- **Status Indicators:** Server health dots are fully circular (pill-shaped) to distinguish them from interactive buttons.

## Components
- **Buttons:** Primary buttons use the Emerald gradient or solid fill. Secondary buttons should be "ghost" style with a 1px slate border, becoming solid only on hover.
- **Status Chips:** Use a subtle background tint of the status color (e.g., 10% opacity Emerald) with a solid-color dot icon. Text should be uppercase `label-mono`.
- **Input Fields:** Use a dark-on-dark approach. Background should be 5% lighter than the container it sits on, with a subtle 1px border that glows Primary Emerald on focus.
- **Data Tables:** Eliminate vertical lines. Use horizontal-only dividers in a faint slate. The header row should have a distinct background tint to separate it from data.
- **SSH Terminal:** Use a pure black background within the terminal component, with a "Glow" effect on text using `secondary_color_hex` (Blue) to simulate a high-end dev environment.
- **Server Cards:** Include a sparkline mini-graph for CPU/Memory usage directly in the list view to provide "at-a-glance" monitoring.