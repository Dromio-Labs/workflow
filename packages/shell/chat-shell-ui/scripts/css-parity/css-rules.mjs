export function collectClassRules(css, options = {}) {
  const rules = new Map();

  for (const rule of collectRules(css)) {
    if (rule.prelude.startsWith("@")) {
      continue;
    }

    for (const token of extractSelectorClassTokens(rule.prelude, options)) {
      if (!rules.has(token)) {
        rules.set(token, []);
      }
      rules.get(token).push({
        raw: rule.body.trim(),
        normalized: normalizeBody(rule.body),
      });
    }
  }

  return rules;
}

function collectRules(css, inheritedPrelude = "") {
  const rules = [];
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf("{", index);
    if (open === -1) {
      break;
    }

    const preludeStart = findPreludeStart(css, index, open);
    const prelude = css.slice(preludeStart, open).trim();
    const close = findMatchingBrace(css, open);
    const body = css.slice(open + 1, close);

    if (hasTopLevelBlock(body)) {
      const nextPrelude = prelude.startsWith("@") ? inheritedPrelude : inheritedPrelude || prelude;
      rules.push(...collectRules(body, nextPrelude));
    } else {
      rules.push({prelude: inheritedPrelude || prelude, body});
    }

    index = close + 1;
  }

  return rules;
}

function findPreludeStart(css, index, open) {
  let start = open - 1;
  while (start >= index && css[start] !== "}" && css[start] !== ";") {
    start -= 1;
  }
  return start + 1;
}

function findMatchingBrace(css, open) {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error("Unbalanced CSS braces.");
}

function hasTopLevelBlock(body) {
  let parenDepth = 0;
  let bracketDepth = 0;

  for (const char of body) {
    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    } else if (char === "{" && parenDepth === 0 && bracketDepth === 0) {
      return true;
    }
  }

  return false;
}

function extractSelectorClassTokens(selector, options = {}) {
  const tokens = new Set();
  const selectors = splitSelectors(selector);

  for (const selectorPart of selectors) {
    const selectorTokens = [];

    for (let index = 0; index < selectorPart.length; index += 1) {
      if (selectorPart[index] !== ".") {
        continue;
      }

      const previous = selectorPart[index - 1];
      if (previous && /[a-zA-Z0-9_-]/.test(previous)) {
        continue;
      }

      const parsed = readCssClass(selectorPart, index + 1);
      if (parsed.value) {
        selectorTokens.push(parsed.value);
        index = parsed.end - 1;
      }
    }

    for (const token of options.allSelectorClasses ? selectorTokens : selectorTokens.slice(0, 1)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function splitSelectors(selector) {
  const selectors = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      selectors.push(selector.slice(start, index));
      start = index + 1;
    }
  }

  selectors.push(selector.slice(start));
  return selectors;
}

function readCssClass(selector, start) {
  let value = "";
  let index = start;

  while (index < selector.length) {
    const char = selector[index];

    if (char === "\\") {
      if (index + 1 < selector.length) {
        value += selector[index + 1];
        index += 2;
        continue;
      }
      break;
    }

    if (/[\s.,>+~#[:)]/.test(char)) {
      break;
    }

    value += char;
    index += 1;
  }

  return {value, end: index};
}

function normalizeBody(body) {
  const declarations = splitDeclarations(body).map(normalizeDeclaration);
  const declarationSet = new Set(declarations);

  if (declarationSet.has("container-type:inline-size") && declarationSet.has("container-name:topoverfay")) {
    declarationSet.delete("container-type:inline-size");
    declarationSet.delete("container-name:topoverfay");
    declarationSet.add("container:topoverfay/inline-size");
  }

  return [...declarationSet]
    .map(normalizeDeclaration)
    .sort()
    .join(";");
}

function normalizeDeclaration(declaration) {
  const separator = declaration.indexOf(":");
  if (separator === -1) {
    return declaration.replace(/\s+/g, "");
  }

  const property = declaration.slice(0, separator).trim().toLowerCase();
  let value = declaration.slice(separator + 1).trim();

  value = value.replace(/\s+/g, "");
  value = value.replace(/currentcolor/g, "currentColor");
  value = value.replace(/transparent/g, "#0000");
  value = value.replace(/0px\b/g, "0");
  value = value.replace(/150ms\b/g, ".15s");
  value = value.replace(/200ms\b/g, ".2s");
  value = value.replace(/300ms\b/g, ".3s");
  value = value.replace(/0\.(\d+)/g, ".$1");
  value = value.replace(/calc\(1\/2\*100%\)/g, "50%");
  value = value.replace(/calc\(50%\*-1\)/g, "-50%");
  value = value.replace(/calc\(90deg\*-1\)/g, "-90deg");
  value = value.replace(/calc\(infinity\*1px\)/g, "3.40282e+38px");
  value = value.replace(/1\/1/g, "1");
  value = value.replace(/var\(--color-([a-z][a-z-]*)\)/g, normalizeColorVariable);
  value = value.replace(/var\(--font-mono\)/g, "var(--font-geist-mono)");
  value = value.replace(/var\(--radius-lg\)/g, "var(--radius)");
  value = value.replace(/var\(--radius-md\)/g, "calc(var(--radius)-2px)");
  value = value.replace(/var\(--radius-xl\)/g, "calc(var(--radius)+4px)");
  value = value.replace(/var\(--animate-collapsible-down\)/g, "collapsible-downvar(--tw-animation-duration,var(--tw-duration,.2s))var(--tw-ease,ease-out)var(--tw-animation-delay,0s)var(--tw-animation-iteration-count,1)var(--tw-animation-direction,normal)var(--tw-animation-fill-mode,none)");
  value = value.replace(/var\(--animate-collapsible-up\)/g, "collapsible-upvar(--tw-animation-duration,var(--tw-duration,.2s))var(--tw-ease,ease-out)var(--tw-animation-delay,0s)var(--tw-animation-iteration-count,1)var(--tw-animation-direction,normal)var(--tw-animation-fill-mode,none)");

  if (property === "opacity") {
    value = value.replace(/^100%$/, "1").replace(/^50%$/, ".5").replace(/^0%$/, "0");
  } else if (property === "rotate") {
    value = value.replace(/^0deg$/, "none");
  }

  return `${property}:${value}`;
}

function normalizeColorVariable(match, name) {
  const aliases = new Set([
    "background",
    "background-alt",
    "foreground",
    "foreground-subtle",
    "foreground-subtlest",
    "foreground-inverse",
    "brand",
    "window-bg",
    "window-bg-strong",
    "window-border",
    "window-highlight",
    "hover",
    "selected",
    "tag",
    "surface",
    "surface-hover",
    "diff-added",
    "diff-removed",
    "input-border",
    "input-border-hover",
    "input-border-focused",
    "input",
    "border",
    "destructive",
    "accent",
    "secondary",
    "primary-foreground",
    "primary",
    "popover",
    "card",
    "muted",
    "ring",
  ]);

  return aliases.has(name) ? `var(--${name})` : match;
}

function splitDeclarations(body) {
  const declarations = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === ";" && depth === 0) {
      const declaration = body.slice(start, index).trim();
      if (declaration) {
        declarations.push(declaration);
      }
      start = index + 1;
    }
  }

  const tail = body.slice(start).trim();
  if (tail) {
    declarations.push(tail);
  }

  return declarations;
}

export function sameBodySet(left, right) {
  const leftBodies = normalizeAggregate(left);
  const rightBodies = normalizeAggregate(right);

  return JSON.stringify(leftBodies) === JSON.stringify(rightBodies);
}

function normalizeAggregate(entries) {
  const declarations = new Set();

  for (const entry of entries) {
    for (const declaration of entry.normalized.split(";")) {
      if (declaration) {
        declarations.add(declaration);
      }
    }
  }

  for (const declaration of [...declarations]) {
    const separator = declaration.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    if (!value.startsWith("var(")) {
      continue;
    }

    const hasColorMixOverride = [...declarations].some((candidate) => (
      candidate.startsWith(`${property}:color-mix(`) && candidate.includes(value)
    ));

    if (hasColorMixOverride) {
      declarations.delete(declaration);
    }
  }

  return [...declarations].sort();
}
