/**
 * IPC contracts — keep command strings aligned with `#[tauri::command]` names in `src-tauri/src/`.
 */

export const IPC_COMMANDS = {
  quitApp: "quit_app",
  getSessionSnapshot: "get_session_snapshot",
  resolveDownloadPath: "resolve_download_path",
  torrentListFull: "torrent_list_full",
  torrentBuildUpdatePayload: "torrent_build_update_payload",
  torrentAddMagnet: "torrent_add_magnet",
  torrentAddFile: "torrent_add_file",
  torrentPause: "torrent_pause",
  torrentResume: "torrent_resume",
  torrentRemove: "torrent_remove",
  torrentUpdateOnlyFiles: "torrent_update_only_files",
  torrentForceRecheck: "torrent_force_recheck",
  torrentDetails: "torrent_details",
  torrentPeerStats: "torrent_peer_stats",
  torrentLiveStats: "torrent_live_stats",
  torrentPieceBitmapDump: "torrent_piece_bitmap_dump",
  torrentStats: "torrent_stats",
  sessionDhtStats: "session_dht_stats",
  getNexttorrentSettings: "get_nexttorrent_settings",
  saveNexttorrentSettings: "save_nexttorrent_settings",
  setTorrentLabel: "set_torrent_label",
  exportConfigurationPaths: "export_configuration_paths",
  torrentPauseAll: "torrent_pause_all",
  rssPollFeeds: "rss_poll_feeds",
  diskFreeBytes: "disk_free_bytes",
  watchPoll: "watch_poll",
} as const;

export const IPC_EVENTS = {
  sessionReady: "session:ready",
  torrentsUpdate: "torrents:update",
} as const;

export type SessionSnapshot = {
  downloadDir: string;
  effectiveDownloadDir: string;
  configDir: string;
  cacheDir: string;
  logFilter: string;
  rqbitVersion: string;
};

export type SpeedSchedulerSlot = {
  startHour: number;
  endHour: number;
  downloadLimitBps: number | null;
  uploadLimitBps: number | null;
};

export type SpeedScheduler = {
  enabled: boolean;
  slots: SpeedSchedulerSlot[];
};

export type RssFeedEntry = {
  id: string;
  url: string;
  enabled: boolean;
  autoAdd: boolean;
  lastSeenIds: string[];
};

export type NexttorrentSettings = {
  downloadDir: string | null;
  globalDownLimitBps: number | null;
  globalUpLimitBps: number | null;
  listenPortStart: number;
  listenPortEnd: number;
  enableUpnp: boolean;
  socksProxy: string | null;
  theme: string;
  labelsByInfoHash: Record<string, string>;
  labelColors: Record<string, string>;
  sequentialDownload: boolean;
  rssFeeds: RssFeedEntry[];
  watchFolders: string[];
  maxActiveDownloads: number | null;
  maxActiveUploads: number | null;
  stalledTimeoutSecs: number | null;
  speedScheduler: SpeedScheduler;
  startAtLogin: boolean;
  minimizeToTray: boolean;
  diskSpaceReserveMb: number | null;
};

export type RssPollResult = {
  magnetsAdded: number;
  messages: string[];
};

export type TorrentFileRow = {
  name: string;
  length: number;
  included: boolean;
};

export type TorrentDetails = {
  id?: number;
  info_hash: string;
  name?: string | null;
  output_folder: string;
  files?: TorrentFileRow[] | null;
  stats?: TorrentStats | null;
};

export type TorrentStats = {
  total_bytes: number;
  progress_bytes: number;
  uploaded_bytes: number;
  finished: boolean;
  state: string;
  error?: string | null;
  live?: {
    average_piece_download_time?: unknown;
    peer_stats?: unknown;
  } | null;
};

export type TorrentRow = TorrentDetails & {
  label?: string | null;
  labelColor?: string | null;
};

export type TorrentsUpdatePayload = {
  torrents: TorrentRow[];
  session: {
    fetched_bytes: number;
    uploaded_bytes: number;
    download_speed: { mbps: number; human_readable?: string };
    upload_speed: { mbps: number; human_readable?: string };
    peers: unknown;
    uptime_seconds: number;
  };
};

/** Defaults aligned with `NexttorrentSettings::default` in Rust (for UI migration). */
export const DEFAULT_NEXTTORRENT_SETTINGS: NexttorrentSettings = {
  downloadDir: null,
  globalDownLimitBps: null,
  globalUpLimitBps: null,
  listenPortStart: 6881,
  listenPortEnd: 6891,
  enableUpnp: true,
  socksProxy: null,
  theme: "system",
  labelsByInfoHash: {},
  labelColors: {},
  sequentialDownload: false,
  rssFeeds: [],
  watchFolders: [],
  maxActiveDownloads: null,
  maxActiveUploads: null,
  stalledTimeoutSecs: null,
  speedScheduler: { enabled: false, slots: [] },
  startAtLogin: false,
  minimizeToTray: false,
  diskSpaceReserveMb: 512,
};
