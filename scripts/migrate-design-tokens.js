/**
 * One-shot visual token migration: indigo/violet/purple/slate → GrowwMatics tokens.
 * Presentation-only class renames; does not touch logic.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");

const REPLACEMENTS = [
  // Indigo → primary
  [/bg-indigo-50\/60/g, "bg-primary-fixed/60"],
  [/bg-indigo-50\/50/g, "bg-primary-fixed/50"],
  [/hover:bg-indigo-50\/50/g, "hover:bg-primary-fixed/50"],
  [/hover:bg-indigo-50/g, "hover:bg-primary-fixed"],
  [/bg-indigo-50/g, "bg-primary-fixed"],
  [/bg-indigo-100/g, "bg-primary-fixed"],
  [/bg-indigo-500/g, "bg-primary"],
  [/bg-indigo-600/g, "bg-primary"],
  [/bg-indigo-700/g, "bg-primary-container"],
  [/text-indigo-400/g, "text-primary-fixed-dim"],
  [/text-indigo-500/g, "text-primary"],
  [/text-indigo-600/g, "text-primary"],
  [/text-indigo-700/g, "text-primary"],
  [/border-indigo-100/g, "border-primary-fixed-dim"],
  [/border-indigo-200/g, "border-primary-fixed-dim"],
  [/border-indigo-300/g, "border-primary-fixed-dim"],
  [/hover:border-indigo-200/g, "hover:border-primary-fixed-dim"],
  [/hover:border-indigo-300/g, "hover:border-primary"],
  [/hover:text-indigo-600/g, "hover:text-primary"],
  [/group-hover:text-indigo-600/g, "group-hover:text-primary"],
  [/group-hover:text-indigo-500/g, "group-hover:text-primary"],
  [/group-hover:bg-indigo-100/g, "group-hover:bg-primary-fixed"],
  [/ring-indigo-500/g, "ring-primary"],
  [/focus:ring-indigo-500/g, "focus:ring-primary"],
  [/focus:border-indigo-500/g, "focus:border-primary"],
  [/from-indigo-\d+/g, "from-primary"],
  [/to-indigo-\d+/g, "to-primary-container"],

  // Violet → primary
  [/bg-violet-50/g, "bg-primary-fixed"],
  [/bg-violet-100/g, "bg-primary-fixed"],
  [/bg-violet-500/g, "bg-primary"],
  [/bg-violet-600/g, "bg-primary"],
  [/bg-violet-700/g, "bg-primary-container"],
  [/text-violet-500/g, "text-primary"],
  [/text-violet-600/g, "text-primary"],
  [/text-violet-700/g, "text-primary"],
  [/border-violet-100/g, "border-primary-fixed-dim"],
  [/border-violet-200/g, "border-primary-fixed-dim"],
  [/from-violet-\d+/g, "from-primary"],
  [/to-violet-\d+/g, "to-primary-container"],
  [/via-violet-\d+/g, "via-primary-container"],

  // Purple → primary
  [/bg-purple-50/g, "bg-primary-fixed"],
  [/bg-purple-100/g, "bg-primary-fixed"],
  [/bg-purple-500/g, "bg-primary"],
  [/bg-purple-600/g, "bg-primary"],
  [/text-purple-500/g, "text-primary"],
  [/text-purple-600/g, "text-primary"],
  [/text-purple-700/g, "text-primary"],
  [/border-purple-100/g, "border-primary-fixed-dim"],
  [/border-purple-200/g, "border-primary-fixed-dim"],
  [/from-purple-\d+/g, "from-primary"],
  [/to-purple-\d+/g, "to-primary-container"],

  // Emerald success → secondary (growth green)
  [/bg-emerald-50/g, "bg-secondary-container/40"],
  [/bg-emerald-100/g, "bg-secondary-container"],
  [/bg-emerald-500/g, "bg-secondary"],
  [/bg-emerald-600/g, "bg-secondary"],
  [/text-emerald-500/g, "text-secondary"],
  [/text-emerald-600/g, "text-secondary"],
  [/text-emerald-700/g, "text-on-secondary-container"],
  [/border-emerald-100/g, "border-secondary-fixed"],
  [/border-emerald-200/g, "border-secondary-fixed"],

  // Green (non-whatsapp) → secondary where clearly success
  [/bg-green-50/g, "bg-secondary-container/40"],
  [/bg-green-100/g, "bg-secondary-container"],
  [/text-green-600/g, "text-secondary"],
  [/text-green-700/g, "text-on-secondary-container"],
  [/border-green-100/g, "border-secondary-fixed"],
  [/border-green-200/g, "border-secondary-fixed"],

  // Red → error tokens
  [/bg-red-50/g, "bg-error-container"],
  [/bg-red-100/g, "bg-error-container"],
  [/bg-red-400\/10/g, "bg-error-container"],
  [/hover:bg-red-50/g, "hover:bg-error-container"],
  [/hover:bg-red-400\/10/g, "hover:bg-error-container"],
  [/text-red-400/g, "text-error"],
  [/text-red-500/g, "text-error"],
  [/text-red-600/g, "text-error"],
  [/text-red-700/g, "text-on-error-container"],
  [/hover:text-red-500/g, "hover:text-error"],
  [/border-red-100/g, "border-error-container"],
  [/border-red-200/g, "border-error-container"],

  // Slate → surface / on-surface
  [/bg-slate-50/g, "bg-surface"],
  [/bg-slate-100/g, "bg-surface-container"],
  [/bg-slate-200/g, "bg-surface-container-high"],
  [/bg-slate-800/g, "bg-primary"],
  [/bg-slate-900/g, "bg-primary"],
  [/hover:bg-slate-50/g, "hover:bg-surface-container-low"],
  [/hover:bg-slate-100/g, "hover:bg-surface-container"],
  [/hover:bg-slate-800/g, "hover:bg-primary-container"],
  [/text-slate-300/g, "text-outline"],
  [/text-slate-400/g, "text-outline"],
  [/text-slate-500/g, "text-on-surface-variant"],
  [/text-slate-600/g, "text-on-surface-variant"],
  [/text-slate-700/g, "text-on-surface"],
  [/text-slate-800/g, "text-on-surface"],
  [/text-slate-900/g, "text-on-surface"],
  [/hover:text-slate-900/g, "hover:text-on-surface"],
  [/border-slate-100/g, "border-outline-variant"],
  [/border-slate-200/g, "border-outline-variant"],
  [/border-slate-300/g, "border-outline-variant"],
  [/divide-slate-100/g, "divide-outline-variant"],
  [/divide-slate-200/g, "divide-outline-variant"],

  // Blue (generic) → primary
  [/bg-blue-50/g, "bg-primary-fixed"],
  [/text-blue-600/g, "text-primary"],
  [/border-blue-100/g, "border-primary-fixed-dim"],

  // Hardcoded hex leftovers commonly used
  [/#7C3AED/gi, "#00386c"],
  [/#8b5cf6/gi, "#00386c"],
  [/#4F46E5/gi, "#00386c"],
  [/rgba\(139,\s*92,\s*246/g, "rgba(0, 56, 108"],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, files);
    } else if (/\.(tsx|jsx|css|ts)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(ROOT);
let changed = 0;
const changedFiles = [];

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  const original = content;
  for (const [re, to] of REPLACEMENTS) {
    content = content.replace(re, to);
  }
  if (content !== original) {
    fs.writeFileSync(file, content);
    changed++;
    changedFiles.push(path.relative(path.join(__dirname, ".."), file));
  }
}

console.log(`Updated ${changed} files`);
changedFiles.forEach((f) => console.log(" -", f));
