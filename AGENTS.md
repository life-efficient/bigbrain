# Project instructions

- Before changing UI, read the relevant files in `app-conventions/`, especially `app-conventions/visual-design/ui-design-rules.md`.
- All visible dropdowns must use accessible shadcn-grade components built on Radix or an equivalent established primitive. Never use browser-native `<select>` dropdowns or native datalist menus, including for small filters and settings. Reuse the app's shared component and styling. Hidden native form controls used internally by an accessible component are acceptable.
- Verify dropdown keyboard navigation, selected state, focus, dismissal, and rendered appearance when changing these controls.
