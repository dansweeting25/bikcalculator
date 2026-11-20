# BIK Calculator

UK benefit-in-kind tax calculator (tax year 2026/27). Static [Astro](https://astro.build) site on Cloudflare Workers,
ported 1:1 from the WordPress/Breakdance build that ran on Cloudways (`wordpress-1540631-6595484.cloudwaysapps.com`).
Pushing to `main` deploys it (`.github/workflows/deploy.yml`). It has no domain yet.

- `src/pages/index.astro`: the calculator page (Breakdance markup, unchanged).
- `public/wp-content/plugins/bik-calculator/assets/bikc.js` and `.css`: the calculator itself. All the maths runs
  in the browser; there is no server code. Tax rates and bands live in `bikc.js`.
- `src/layouts/Base.astro`: shared head and scripts.
- `scripts/port/`: the tools used for the port; `scripts/port-snapshot/` is the WordPress HTML it was checked against
  (`npm run verify`).

```bash
npm install
npm run dev
```

Going live on a domain: add the domain to your Cloudflare account, then Workers & Pages → `bikcalculator` →
Settings → Domains & Routes → add it.
