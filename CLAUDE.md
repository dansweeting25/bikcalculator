# BIK Calculator

Read README.md first. Rules:

1. Keep the design: markup and class names were ported 1:1 from Breakdance.
2. Calculator logic is in `public/wp-content/plugins/bik-calculator/assets/bikc.js`. When rates change for a new tax
   year, update them there and test a few salaries against HMRC's figures.
3. Inline `<script>`/`<style>` in `.astro` files carry `is:inline`, and `{` `}` in text are written `&#123;` `&#125;`.
4. Run `npm run build` after changes.
