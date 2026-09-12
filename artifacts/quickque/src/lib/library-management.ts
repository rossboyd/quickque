import type { Script, SortMode } from './types.ts';

export function getVisibleScripts(
  scripts: Script[],
  search: string,
  sortMode: SortMode,
  customOrder: string[],
): Script[] {
  const query = search.trim().toLocaleLowerCase();
  const visible = scripts.filter(script => {
    if (!query) return true;
    const haystack = [
      script.title,
      ...script.sections.flatMap(section => [section.title, section.content]),
    ].join('\n').toLocaleLowerCase();
    return haystack.includes(query);
  });

  const originalIndex = new Map(scripts.map((script, index) => [script.id, index]));
  const compareStable = (a: Script, b: Script, comparison: number) => (
    comparison || (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0)
  );

  if (sortMode === 'custom') {
    const customIndex = new Map(customOrder.map((id, index) => [id, index]));
    return [...visible].sort((a, b) => compareStable(
      a,
      b,
      (customIndex.get(a.id) ?? customOrder.length + (originalIndex.get(a.id) ?? 0)) -
        (customIndex.get(b.id) ?? customOrder.length + (originalIndex.get(b.id) ?? 0)),
    ));
  }

  if (sortMode === 'newest' || sortMode === 'oldest') {
    const direction = sortMode === 'newest' ? -1 : 1;
    return [...visible].sort((a, b) => compareStable(
      a,
      b,
      (a.createdAt - b.createdAt) * direction,
    ));
  }

  const direction = sortMode === 'az' ? 1 : -1;
  return [...visible].sort((a, b) => compareStable(
    a,
    b,
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) * direction,
  ));
}

export function downloadFile(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
