/** A display-only, deliberately small Markdown subset. Saved and copied replies stay raw. */
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const escapedAt = (source, index) => {
  let slashes = 0;
  while (index > 0 && source[--index] === '\\') slashes += 1;
  return slashes % 2 === 1;
};
const findUnescaped = (source, token, from) => {
  let at = source.indexOf(token, from);
  while (at !== -1 && escapedAt(source, at)) at = source.indexOf(token, at + token.length);
  return at;
};

function linkAt(source, from, image = false) {
  const labelStart = from + (image ? 2 : 1), labelEnd = findUnescaped(source, ']', labelStart);
  if (labelEnd === -1 || source[labelEnd + 1] !== '(') return null;
  let cursor = labelEnd + 2, nesting = 1;
  for (; cursor < source.length; cursor += 1) {
    if (escapedAt(source, cursor)) continue;
    if (source[cursor] === '(') nesting += 1;
    if (source[cursor] === ')') nesting -= 1;
    if (!nesting) return {label: source.slice(labelStart, labelEnd), href: source.slice(labelEnd + 2, cursor), end: cursor + 1};
    if (nesting > 8 || source[cursor] === '\n') return null;
  }
  return null;
}

function safeLink(href) {
  if (!href || /[\u0000-\u0020\u007f-\u009f"'<>\\]/.test(href)) return false;
  try {
    const url = new URL(href);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

function inline(source, depth = 0, allowLinks = true) {
  if (depth >= 8) return escape(source).replace(/\n/g, '<br>');
  const result = [];
  let cursor = 0, plainStart = 0;
  const flush = end => { if (end > plainStart) result.push(escape(source.slice(plainStart, end)).replace(/\n/g, '<br>')); };
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\' && /[\\`*_[\]{}()#+.!>~|\-]/.test(source[cursor + 1] || '')) {
      flush(cursor); result.push(escape(source[cursor + 1])); cursor += 2; plainStart = cursor; continue;
    }
    if (char === '`') {
      let count = 1;
      while (source[cursor + count] === '`') count += 1;
      const token = '`'.repeat(count), end = source.indexOf(token, cursor + count);
      if (end !== -1) {
        flush(cursor); result.push(`<code>${escape(source.slice(cursor + count, end).replace(/\n/g, ' '))}</code>`);
        cursor = end + count; plainStart = cursor; continue;
      }
      cursor += count; continue;
    }
    if (allowLinks && (char === '[' || char === '!' && source[cursor + 1] === '[')) {
      const image = char === '!', link = linkAt(source, cursor, image);
      if (link) {
        flush(cursor);
        result.push(!image && safeLink(link.href)
          ? `<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer">${inline(link.label, depth + 1, false)}</a>`
          : escape(source.slice(cursor, link.end)));
        cursor = link.end; plainStart = cursor; continue;
      }
    }
    if (char === '*' || char === '_') {
      let count = source.slice(cursor, cursor + 3) === char.repeat(3) ? 3 : source[cursor + 1] === char ? 2 : 1;
      const token = char.repeat(count), end = findUnescaped(source, token, cursor + count);
      const boundary = char !== '_' || !/[\p{L}\p{N}]/u.test(source[cursor - 1] || '');
      if (end > cursor + count && boundary && !/\s/.test(source[cursor + count]) && !/\s/.test(source[end - 1])
        && (char !== '_' || !/[\p{L}\p{N}]/u.test(source[end + count] || ''))) {
        flush(cursor);
        const content = inline(source.slice(cursor + count, end), depth + 1, allowLinks);
        result.push(count === 3 ? `<strong><em>${content}</em></strong>` : count === 2 ? `<strong>${content}</strong>` : `<em>${content}</em>`);
        cursor = end + count; plainStart = cursor; continue;
      }
      cursor += count; continue;
    }
    cursor += 1;
  }
  flush(source.length);
  return result.join('');
}

const headingAt = line => line.match(/^ {0,3}(#{1,6})[\t ]+(.+?)\s*$/);
const quoteAt = line => line.match(/^ {0,3}> ?(.*)$/);
const fenceAt = line => line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
const listAt = line => {
  const match = line.match(/^( *)([-+*]|\d{1,9}[.)])([\t ]+)(\S.*)$/);
  return match ? {indent: match[1].length, ordered: /^\d/.test(match[2]), start: Number.parseInt(match[2], 10),
    contentIndent: match[1].length + match[2].length + match[3].length, content: match[4]} : null;
};
const isBlank = line => /^\s*$/.test(line);
const startsBlock = line => headingAt(line) || quoteAt(line) || fenceAt(line) || listAt(line);

// Split only structural pipes. Escaped pipes and pipes inside code spans remain text.
function tableCells(line) {
  const cells = []; let start = 0, code = '', pipes = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (escapedAt(line, index)) continue;
    if (line[index] === '`') {
      let end = index + 1;
      while (line[end] === '`') end += 1;
      const marker = line.slice(index, end);
      if (code === marker) code = '';
      else if (!code && line.indexOf(marker, end) !== -1) code = marker;
      index = end - 1; continue;
    }
    if (line[index] === '|' && !code) {cells.push(line.slice(start, index).trim()); start = index + 1; pipes += 1;}
  }
  if (!pipes) return null;
  cells.push(line.slice(start).trim());
  if (cells[0] === '') cells.shift();
  if (cells.at(-1) === '') cells.pop();
  return cells.length ? cells : null;
}
function tableAt(lines, index) {
  const headers = tableCells(lines[index] || ''), separators = tableCells(lines[index + 1] || '');
  if (!headers || headers.length < 2 || headers.length > 20 || !separators || separators.length !== headers.length
    || !separators.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return {headers, align: separators.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left')};
}

function blocks(lines, depth = 0) {
  if (depth >= 8) return `<p>${inline(lines.join('\n'))}</p>`;
  const result = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (isBlank(line)) { cursor += 1; continue; }
    const fence = fenceAt(line);
    if (fence) {
      const code = [], marker = fence[1][0], minimum = fence[1].length;
      cursor += 1;
      while (cursor < lines.length) {
        const closing = lines[cursor].match(/^ {0,3}(`+|~+)\s*$/);
        if (closing && closing[1][0] === marker && closing[1].length >= minimum) { cursor += 1; break; }
        code.push(lines[cursor++]);
      }
      result.push(`<pre tabindex="0" aria-label="代码"><code>${escape(code.join('\n'))}</code></pre>`); continue;
    }
    const heading = headingAt(line);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length));
      result.push(`<h${level}>${inline(heading[2].replace(/[\t ]+#+[\t ]*$/, ''))}</h${level}>`); cursor += 1; continue;
    }
    if (quoteAt(line)) {
      const quoted = [];
      while (cursor < lines.length && quoteAt(lines[cursor])) quoted.push(quoteAt(lines[cursor++])[1]);
      result.push(`<blockquote>${blocks(quoted, depth + 1)}</blockquote>`); continue;
    }
    const table = tableAt(lines, cursor);
    if (table) {
      const rows = []; cursor += 2;
      while (cursor < lines.length && !isBlank(lines[cursor])) {
        const cells = tableCells(lines[cursor]);
        if (!cells || cells.length !== table.headers.length || startsBlock(lines[cursor])) break;
        rows.push(`<tr>${cells.map((cell, index) => `<td class="align-${table.align[index]}">${inline(cell)}</td>`).join('')}</tr>`);
        cursor += 1;
      }
      result.push(`<div class="ep-assistant-table" role="region" aria-label="表格，可左右滚动" tabindex="0"><table><thead><tr>${table.headers.map((cell, index) => `<th scope="col" class="align-${table.align[index]}">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const list = listAt(line);
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul', items = [];
      while (cursor < lines.length) {
        const item = listAt(lines[cursor]);
        if (!item || item.indent !== list.indent || item.ordered !== list.ordered) break;
        const content = [item.content]; cursor += 1;
        while (cursor < lines.length) {
          const next = lines[cursor], nextItem = listAt(next), indent = next.match(/^ */)[0].length;
          if (nextItem && nextItem.indent === list.indent || !isBlank(next) && indent <= list.indent) break;
          content.push(next.slice(Math.min(item.contentIndent, indent))); cursor += 1;
        }
        items.push(`<li>${blocks(content, depth + 1)}</li>`);
      }
      result.push(`<${tag}${list.ordered && list.start !== 1 ? ` start="${list.start}"` : ''}>${items.join('')}</${tag}>`); continue;
    }
    const paragraph = [line]; cursor += 1;
    while (cursor < lines.length && !isBlank(lines[cursor]) && !startsBlock(lines[cursor]) && !tableAt(lines, cursor)) paragraph.push(lines[cursor++]);
    result.push(`<p>${inline(paragraph.join('\n'))}</p>`);
  }
  return result.join('');
}

export function assistantReplyMarkup(raw) {
  const source = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ') : '';
  return `<div class="ep-assistant-reply">${source.trim() ? blocks(source.split('\n')) : ''}</div>`;
}
