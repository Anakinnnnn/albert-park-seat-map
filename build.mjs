import { readFileSync, writeFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const BODY_START = '<div class="app">';

const page = read("./src/page.html").replace("__SVG__", () => read("./data/background.svg"));
const bodyAt = page.indexOf(BODY_START);
if (bodyAt < 0) throw new Error(`src/page.html is missing ${BODY_START}`);
const head = page.slice(0, bodyAt);
const body = page.slice(bodyAt);
const app = read("./src/app.js")
    .replace("__DATA__", () => read("./data/seats.json").trim())
    .replace("__ICONS__", () => read("./data/icons.json").trim());

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body { margin: 0; }</style>
${head.trim()}
</head>
<body>
${body.trim()}
<script>
${app.trim()}
</script>
</body>
</html>
`;

writeFileSync(new URL("./index.html", import.meta.url), html);
console.log(`Built index.html (${(html.length / 1024).toFixed(0)} KB)`);
