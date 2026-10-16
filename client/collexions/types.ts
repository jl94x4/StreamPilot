
export interface SpecialCollection {
  start_date: string;
  end_date: string;
  collection_names: string[];
}

export interface CategoryConfig {
  category_name: string;
  pin_count: number;
  collections: string[];
}

export interface AppConfig {
  plex_url: string;
  plex_token: string;
  /** Set by worker when Plex URL/token resolve from Settings → Media Player. */
  _plex_from_portal?: boolean;
  _portal_plex_url?: string;
  collexions_label: string;
  dry_run: boolean;
  pinning_interval: number;
  repeat_block_hours: number;
  min_items_for_pinning: number;
  discord_webhook_url: string;
  use_random_category_mode: boolean;
  random_category_skip_percent: number;
  exclusion_list: string[];
  regex_exclusion_patterns: string[];
  special_collections: SpecialCollection[];
  /** UI display preference only — dates in special_collections stay stored as MM-DD. */
  special_date_format: 'MM-DD' | 'DD-MM';
  library_names: string[];
  number_of_collections_to_pin: Record<string, number>;
  categories: Record<string, CategoryConfig[]>;
  tmdb_api_key?: string;
  trakt_client_id?: string;
  mdblist_api_key?: string;
  enable_trending_pinning?: boolean;
}

export interface LibraryRunStats {
  name: string;
  pin_limit?: number;
  found: number;
  eligible: number;
  pinned: number;
  skips?: Record<string, number>;
  skip_samples?: Record<string, string[]>;
  notes?: string[];
  specials_picked?: number;
  categories_picked?: number;
  random_picked?: number;
  withheld_by_category?: number;
  category_skipped_by_chance?: boolean;
  repeat_block_hours?: number;
  min_items?: number;
  selected_titles?: string[];
}

export interface PinFairness {
  repeat_block_hours?: number;
  min_items_for_pinning?: number;
  use_random_category_mode?: boolean;
  random_category_skip_percent?: number;
  pinning_interval_minutes?: number;
}

export interface AppStatus {
  status: string;
  last_update: string;
  last_run_at?: string | null;
  last_run_started_at?: string;
  last_run_duration_seconds?: number;
  last_run_pinned?: number;
  next_run_timestamp?: number;
  pin_slots?: number;
  libraries?: LibraryRunStats[];
  fairness?: PinFairness;
  process_alive?: boolean;
  status_source?: string;
}

export interface PlexCollection {
  title: string;
  library: string;
  is_pinned: boolean;
  /** False until resolve-pins (or a full non-light list) has filled pin state */
  pin_resolved?: boolean;
  has_label: boolean;
  thumb?: string | null;
  ratingKey: string;
  itemCount?: number;
  key?: string;
  /** Deep link to open this collection in the Plex web/app UI. */
  plexUrl?: string;
}

export interface PinEvent {
  timestamp: string; // ISO Date String
  collectionName: string;
  library: string;
}

export interface HistoryResponse {
  events: PinEvent[];
  total_count: number;
  unique_count: number;
}

export enum Tab {
  DASHBOARD = 'dashboard',
  GALLERY = 'gallery',
  STATS = 'stats',
  CREATOR = 'creator',
  JOBS = 'jobs',
  SETTINGS = 'settings',
  LOGS = 'logs'
}