import {readdir, readFile} from "node:fs/promises";
import path from "node:path";

export async function listSourceFiles(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
    } else if (/\.[cm]?[tj]sx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

export async function extractUsedClassTokens(files) {
  const tokens = new Set();

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const literal of extractClassBindingLiterals(source)) {
      for (const token of literal.value.split(/\s+/)) {
        const cleanToken = token.trim();
        if (isLikelyClassToken(cleanToken)) {
          tokens.add(cleanToken);
        }
      }
    }
  }

  return [...tokens].sort();
}

function extractClassBindingLiterals(source) {
  const literals = [];
  const bindingPattern = /\b(?:className|class)\s*[:=]/g;
  let match;

  while ((match = bindingPattern.exec(source)) !== null) {
    let valueStart = bindingPattern.lastIndex;
    while (/\s/.test(source[valueStart])) {
      valueStart += 1;
    }

    if (source[valueStart] === "{" && source[valueStart + 1] !== undefined) {
      const end = findMatchingDelimiter(source, valueStart, "{", "}");
      literals.push(...extractStringLiterals(source.slice(valueStart + 1, end)).map((literal) => ({
        start: literal.start + valueStart + 1,
        end: literal.end + valueStart + 1,
        value: literal.value,
      })));
      bindingPattern.lastIndex = end + 1;
    } else if (/["'`]/.test(source[valueStart])) {
      const [literal] = extractStringLiterals(source.slice(valueStart));
      if (literal) {
        literals.push({
          start: literal.start + valueStart,
          end: literal.end + valueStart,
          value: literal.value,
        });
        bindingPattern.lastIndex = valueStart + literal.end;
      }
    }
  }

  return literals;
}

function extractStringLiterals(source) {
  const literals = [];
  const pattern = /(["'`])/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const quote = match[1];
    const start = match.index;
    let index = start + 1;
    let value = "";

    while (index < source.length) {
      const char = source[index];
      if (char === "\\") {
        value += source.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (char === quote) {
        literals.push({start, end: index + 1, value});
        pattern.lastIndex = index + 1;
        break;
      }
      value += char;
      index += 1;
    }
  }

  return literals;
}

function findMatchingDelimiter(source, start, open, close) {
  let depth = 0;
  let quote = "";

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (/["'`]/.test(char)) {
      quote = char;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(`Unbalanced ${open}${close} expression while extracting className literals.`);
}

function isLikelyClassToken(token) {
  if (!token || token.includes("${") || token.includes("}")) {
    return false;
  }

  if (!/^[!@a-zA-Z0-9_\-:/.[\]()%#=*>+~'"]+$/.test(token)) {
    return false;
  }

  if (/^(true|false|null|undefined|open|closed|button|navigation|main|section|article|img|svg)$/.test(token)) {
    return false;
  }

  return /[-:[\]/!@]|\b(flex|grid|block|hidden|contents|relative|absolute|fixed|sticky|truncate|container|opacity|shadow|border|rounded|size|group|lucide)\b/.test(token);
}
