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
  exportConfigurationBundle: "export_configuration_bundle",
  importConfigurationBundle: "import_configuration_bundle",
  listNetworkInterfaces: "list_network_interfaces",
  torrentPauseAll: "torrent_pause_all",
  torrentResumeAll: "torrent_resume_all",
  torrentOpenFolder: "torrent_open_folder",
  torrentRevealFile: "torrent_reveal_file",
  torrentTrackers: "torrent_trackers",
  getTorrentBandwidthLimits: "get_torrent_bandwidth_limits",
  setTorrentBandwidthLimits: "set_torrent_bandwidth_limits",
  rssPollFeeds: "rss_poll_feeds",
  diskFreeBytes: "disk_free_bytes",
  watchPoll: "watch_poll",
  getActivityLog: "get_activity_log",
  openLogsFolder: "open_logs_folder",
} as const;

export const IPC_EVENTS = {
  sessionReady: "session:ready",
  torrentsUpdate: "torrents:update",
  magnetAdded: "magnet:added",
  magnetRejected: "magnet:rejected",
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

export type RssFeedKind = "rss" | "torznab";

export type RssFeedEntry = {
  id: string;
  url: string;
  name?: string | null;
  kind?: RssFeedKind;
  apiKey?: string | null;
  enabled: boolean;
  autoAdd: boolean;
  lastSeenIds: string[];
  titleRegex?: string | null;
  excludeRegex?: string | null;
  qualityFilter?: string | null;
  categorySavePaths?: Record<string, string>;
  defaultSavePath?: string | null;
};

export type PathsSnapshot = {
  settingsFile: string;
  rqbitPersistenceDir: string;
  configDir: string;
  cacheDir: string;
  watchProcessedFile: string;
  seedingStartedFile: string;
};

export type NetworkInterfaceInfo = {
  name: string;
  receivedBytes: number;
  transmittedBytes: number;
};

export type PerTorrentBandwidthLimits = {
  downloadLimitBps: number | null;
  uploadLimitBps: number | null;
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
  perTorrentLimitsByInfoHash: Record<string, PerTorrentBandwidthLimits>;
  seedRatioLimit: number | null;
  seedTimeLimitHours: number | null;
  bindInterface: string | null;
};

export type ActivityLogSnapshot = {
  traceLines: string[];
  diagFileLines: string[];
  sessionFileLines: string[];
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
  perTorrentLimitsByInfoHash: {},
  seedRatioLimit: null,
  seedTimeLimitHours: null,
  bindInterface: null,
};
