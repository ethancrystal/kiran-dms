import type { ClientBase } from "pg";

export declare const DUMMY: string;
export declare const DUMMY_PRICE_PAISA: number;
export declare const DUMMY_PRICE_REASON: string;

export interface DummyGroup {
  slug: string;
  name: string;
  id: string;
  cycleDays: number;
  active: boolean;
}

export interface DummyProduct {
  slug: string;
  group: string;
  name: string;
  id: string;
  groupId: string;
  brandLabel: string;
  active: boolean;
}

export interface DummySku {
  slug: string;
  product: string;
  code: string;
  variant: string;
  unit: string;
  size: number;
  id: string;
  productId: string;
  priceClientId: string;
  active: boolean;
}

export interface DummyCatalogue {
  groups: DummyGroup[];
  products: DummyProduct[];
  skus: DummySku[];
  pricePaisa: number;
  priceReason: string;
}

export declare const DUMMY_CATALOGUE: DummyCatalogue;

export type SeedAction = "created" | "updated" | "unchanged";
export type SeedKind = "groups" | "products" | "skus" | "prices";

export interface CatalogueChange {
  kind: SeedKind;
  action: SeedAction;
  label: string;
  detail?: string;
}

export interface SeedCounts {
  groups: number;
  products: number;
  skus: number;
  pricedSkus: number;
}

export interface SeedResult {
  dryRun: boolean;
  applied: boolean;
  conflicts: string[];
  changes: CatalogueChange[];
  counts: Record<SeedKind, Record<SeedAction, number>>;
  before: SeedCounts;
  after: SeedCounts;
}

export declare function assertLocalDatabaseUrl(url: string | undefined): void;

export declare function runDummyCatalogueSeed(
  client: ClientBase,
  options: { actorId: string; dryRun?: boolean; commit?: boolean },
): Promise<SeedResult>;
