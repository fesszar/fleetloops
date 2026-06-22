#!/usr/bin/env bash
# Rebuild the self-contained dashboard bundle (app.js + app.css) from FleetView.jsx.
# Run this after editing FleetView.jsx. Needs Node 18+ and network ONCE (to fetch the
# build tools via npx); the OUTPUT is fully offline — no CDNs at runtime.
set -euo pipefail
WEB="$(cd "$(dirname "$0")" && pwd)"
SRC="$WEB/../../FleetView.jsx"   # outputs/FleetView.jsx
TMP="$(mktemp -d)"; cd "$TMP"

echo "Installing build tools (esbuild, react, lucide, tailwind)…"
npm init -y >/dev/null 2>&1
npm i esbuild@0.21.5 react@18.3.1 react-dom@18.3.1 lucide-react@0.453.0 tailwindcss@3.4.13 >/dev/null 2>&1

cp "$SRC" "$TMP/FleetView.jsx"
mkdir -p "$TMP/web"
cat > "$TMP/web/entry.jsx" <<'JS'
import React from "react";
import { createRoot } from "react-dom/client";
import FleetView from "../FleetView.jsx";
class EB extends React.Component{constructor(p){super(p);this.state={e:null}}static getDerivedStateFromError(e){return{e}}render(){return this.state.e?React.createElement("pre",{style:{color:"#fca5a5",padding:"2rem",whiteSpace:"pre-wrap"}},String(this.state.e.stack||this.state.e)):this.props.children}}
createRoot(document.getElementById("root")).render(React.createElement(EB,null,React.createElement(FleetView)));
JS

echo "Bundling app.js…"
./node_modules/.bin/esbuild web/entry.jsx --bundle --format=iife --loader:.jsx=jsx --jsx=automatic --minify --outfile="$WEB/app.js"

echo "Generating app.css…"
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > input.css
echo "module.exports={content:['$TMP/FleetView.jsx','$TMP/web/entry.jsx'],theme:{extend:{}},plugins:[]};" > tailwind.config.js
./node_modules/.bin/tailwindcss -c tailwind.config.js -i input.css -o "$WEB/app.css" --minify 2>/dev/null

echo "✓ Rebuilt $WEB/app.js ($(wc -c <"$WEB/app.js") bytes) and app.css. Reload the dashboard."
