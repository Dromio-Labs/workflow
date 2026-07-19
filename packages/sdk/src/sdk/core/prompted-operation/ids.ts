export type IdCatalogValue<T> =
  T extends string ? T :
  T extends Record<string, unknown> ? IdCatalogValue<T[keyof T]> :
  never;

export function defineIdCatalog<const TCatalog extends Record<string, unknown>>(
  catalog: TCatalog,
): TCatalog {
  return catalog;
}

export function defineId<const TId extends string>(id: TId): TId {
  return id;
}
