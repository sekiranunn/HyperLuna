export function addHeaderEntry(header, label, href, icon = 'el-icon-setting') {
  if (!header) return;
  const existing = header.querySelector('.lf-extension-entry');
  if (existing) {
    existing.title = label; existing.setAttribute('aria-label', label);
    existing.querySelector('span').textContent = label;
    return;
  }
  header.classList.add('lf-header-layout');
  const target = header.querySelector('.headerMadinRight');
  const link = document.createElement('a');
  link.className = 'lf-extension-entry'; link.href = href; link.title = label; link.setAttribute('aria-label', label);
  const glyph = document.createElement('i'); glyph.className = icon;
  const text = document.createElement('span'); text.textContent = label;
  link.append(glyph, text); target.prepend(link);
}
