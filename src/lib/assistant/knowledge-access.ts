/** Defence in depth in addition to can_read_knowledge and page RLS. Unknown visibility is not public. */
export function visibleKnowledgeHits<T extends { [key: string]: unknown }>(hits: T[], canPrice: boolean): T[] {
  return hits.filter((h) => h['visibility'] === 'all_staff' || (h['visibility'] === 'pricing_only' && canPrice));
}
