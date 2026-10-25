package com.servermanagerportal.mediaplayer;

import android.app.PictureInPictureParams;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.TextUtils;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.Rational;
import android.view.Display;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.Surface;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.VideoSize;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.text.TextOutput;
import androidx.media3.exoplayer.text.TextRenderer;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.trackselection.TrackSelector;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.URL;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@UnstableApi
public class PlayerActivity extends AppCompatActivity {
    private static final String TAG = "SmpPlayerActivity";
    /** Format id of the OpenSubtitles SubtitleConfiguration, so the selector can pin it. */
    private static final String SIDECAR_TEXT_ID = "smp-sidecar";
    private static final String USER_AGENT = "StreamPilot-MediaPlayer/1.0 (Android TV; ExoPlayer)";
    private static final String PREFS = "smp_player_prefs";

    public static final String EXTRA_URL = "url";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_LOGO_URL = "logoUrl";
    public static final String EXTRA_OFFSET_MS = "offsetMs";
    public static final String EXTRA_HEADERS_JSON = "headersJson";
    public static final String EXTRA_SESSION_JSON = "sessionJson";
    public static final String EXTRA_SPEED = "speed";
    public static final String EXTRA_AUTOPLAY_NEXT = "autoplayNext";
    public static final String EXTRA_AUTO_SKIP_INTRO = "autoSkipIntro";
    public static final String EXTRA_AUTO_SKIP_CREDITS = "autoSkipCredits";
    public static final String EXTRA_ENDED = "ended";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_ERROR = "error";
    public static final String EXTRA_PLAY_NEXT = "playNext";
    public static final String EXTRA_NEXT_RATING_KEY = "nextRatingKey";
    public static final String EXTRA_PLAY_PREVIOUS = "playPrevious";
    public static final String EXTRA_PREVIOUS_RATING_KEY = "previousRatingKey";

    private ExoPlayer player;
    private DefaultHttpDataSource.Factory httpFactory;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private View chrome;
    private View topBar;
    private View bufferingView;
    private View burnOverlay;
    private Button burnCancelBtn;
    private TextView errorView;
    @Nullable private String burnCancelSubtitleId;
    private boolean burnInProgress;
    private SeekBar seekBar;
    private TextView timeView;
    private TextView speedLabel;
    private TextView titleView;
    private ImageView logoView;
    private ImageView artView;
    private TextView upNextLabel;
    private ImageButton playPauseBtn;
    private ImageButton prevEpisodeBtn;
    private ImageButton nextEpisodeBtn;
    private Button skipIntroBtn;
    private TextView upNextKicker;
    private TextView upNextCountdown;
    private ImageView upNextArt;
    private Button upNextPlayBtn;
    private Button upNextCreditsBtn;
    private boolean watchCreditsChosen;
    private TextView statsView;
    private TextView modeChipView;
    private TextView resolutionChipView;
    private boolean statsVisible;
    private TextView clockView;
    private String lastClockLabel = "";
    private Button skipCreditsBtn;
    private Button qualityBtn;
    private Button audioBtn;
    private Button subsBtn;
    private Button versionBtn;
    private Button speedBtn;
    private Button sleepBtn;
    private Button externalBtn;
    private LinearLayout upNextRow;
    private View skipRow;
    private Button pipBtn;
    private Button chaptersBtn;
    private Button zoomBtn;
    private Button delayBtn;
    private Button repeatBtn;
    private ImageView seekPreview;
    private View menuScrim;
    private TextView menuTitle;
    private ScrollView menuScroll;
    private LinearLayout menuList;
    private TextView metaView;
    private TextView remainingView;
    private TextView endsAtView;
    private TextView seekFlashView;
    private ImageButton settingsBtn;
    private String metaText = "";
    private final PlayerMenuNav menuNav = new PlayerMenuNav();
    private final PlayerKeyHandler keyHandler = new PlayerKeyHandler(new PlayerKeyHandler.Host() {
        @Override
        public boolean isOptionDialogShowing() {
            return PlayerActivity.this.isOptionDialogShowing();
        }

        @Override
        public void popMenuOrClose() {
            PlayerActivity.this.popMenuOrClose();
        }

        @Override
        public boolean isStatsKey(int keyCode) {
            return PlayerActivity.this.isStatsKey(keyCode);
        }

        @Override
        public boolean statsVisible() {
            return statsVisible;
        }

        @Override
        public void toggleStatsOverlay() {
            PlayerActivity.this.toggleStatsOverlay();
        }

        @Override
        public void hideStatsOverlay() {
            PlayerActivity.this.hideStatsOverlay();
        }

        @Override
        public boolean chromeVisible() {
            return chromeVisible;
        }

        @Override
        public void setChromeVisible(boolean visible) {
            PlayerActivity.this.setChromeVisible(visible);
        }

        @Override
        public void bumpChrome() {
            PlayerActivity.this.bumpChrome();
        }

        @Override
        public boolean seekHoldActive() {
            return seekHoldDirection != 0;
        }

        @Override
        public void startSeekHold(int direction) {
            PlayerActivity.this.startSeekHold(direction);
        }

        @Override
        public void stopSeekHold() {
            PlayerActivity.this.stopSeekHold();
        }

        @Override
        public boolean isUpNextVisible() {
            return PlayerActivity.this.isUpNextVisible();
        }

        @Override
        public boolean isUpNextFocused() {
            return PlayerActivity.this.isUpNextFocused();
        }

        @Override
        public void focusUpNextControls() {
            PlayerActivity.this.focusUpNextControls();
        }

        @Override
        public boolean playbackEndedNow() {
            return playbackEnded || (player != null && player.getPlaybackState() == Player.STATE_ENDED);
        }

        @Override
        public boolean musicMode() {
            return musicMode;
        }

        @Override
        public void finishWithResult(boolean ended, boolean playNext) {
            PlayerActivity.this.finishWithResult(ended, playNext);
        }

        @Override
        public void minimizeToBrowse() {
            PlayerActivity.this.minimizeToBrowse();
        }

        @Override
        public boolean isPlaybackConfirmTarget() {
            return PlayerActivity.this.isPlaybackConfirmTarget();
        }

        @Override
        public boolean hasChapters() {
            return !chapters.isEmpty();
        }

        @Override
        public void skipChapter(int direction) {
            PlayerActivity.this.skipChapter(direction);
        }

        @Override
        public void skipNextFromPlugin() {
            PlayerActivity.this.skipNextFromPlugin();
        }

        @Override
        public void finishForPlayPrevious() {
            PlayerActivity.this.finishForPlayPrevious();
        }

        @Override
        public void showSettingsRoot() {
            PlayerActivity.this.showSettingsRoot();
        }

        @Override
        public void applyPlayPause(boolean play) {
            PlayerActivity.this.applyPlayPause(play);
        }

        @Override
        public void togglePlayPause() {
            PlayerActivity.this.togglePlayPause();
        }

        @Override
        public void focusPlayPauseButton() {
            if (playPauseBtn != null) playPauseBtn.requestFocus();
        }

        @Override
        public boolean isSeekBarFocused() {
            return getCurrentFocus() == seekBar;
        }

        @Override
        public boolean hasSettingsButton() {
            return settingsBtn != null;
        }

        @Override
        public boolean trySkipFromRemote() {
            return PlayerActivity.this.trySkipFromRemote();
        }
    });
    private int seekHoldDirection;
    private final Runnable seekHoldRunnable = new Runnable() {
        @Override
        public void run() {
            if (seekHoldDirection == 0) return;
            // Move the clock only. One seek is applied when the key is released.
            previewSeekBy(seekHoldDirection * 10_000L);
            flashSeek(seekHoldDirection);
            mainHandler.postDelayed(this, 350);
        }
    };
    private final Runnable hideSeekFlashRunnable = new Runnable() {
        @Override
        public void run() {
            if (seekFlashView == null) return;
            seekFlashView.animate().cancel();
            seekFlashView.animate()
                .alpha(0f)
                .setDuration(180)
                .withEndAction(() -> {
                    if (seekFlashView != null) {
                        seekFlashView.setVisibility(View.GONE);
                        seekFlashView.setAlpha(1f);
                    }
                })
                .start();
        }
    };

    private boolean playbackEnded;
    private boolean playbackError;
    private int streamFallbackStage;
    /** Bumped when a new stream starts so a pending failure exit does not close a recovered player. */
    private int errorGeneration;
    private boolean finishing;
    private boolean seekingUi;
    private boolean chromeVisible = true;
    private boolean skippedIntro;
    private boolean skippedCredits;
    /** Timed Skip Intro/Credits prompt (independent of OSD chrome). */
    private static final long SKIP_CHIP_VISIBLE_MS = 10_000L;
    /** True after we've offered the chip once for the current intro/credits visit. */
    private boolean skipIntroPromptOffered;
    private boolean skipCreditsPromptOffered;
    private boolean skipIntroChipActive;
    private boolean skipCreditsChipActive;
    private final Runnable hideSkipIntroChipRunnable = () -> {
        skipIntroChipActive = false;
        applySkipChipVisibility(false, skipCreditsChipActive);
    };
    private final Runnable hideSkipCreditsChipRunnable = () -> {
        skipCreditsChipActive = false;
        applySkipChipVisibility(skipIntroChipActive, false);
    };
    @Nullable
    private WatchNext.Entry watchNextEntry;
    private long lastWatchNextAtMs;
    private long lastWatchNextPosMs = -1;
    private boolean watchNextRemoved;
    private final PlayerSessionController sessionController = new PlayerSessionController(
        this,
        new PlayerSessionController.Host() {
            @Override
            public void applyPlayPause(boolean play) {
                PlayerActivity.this.applyPlayPause(play);
            }

            @Override
            public void seekToContent(long contentMs, boolean immediate) {
                PlayerActivity.this.seekToContent(contentMs, immediate);
            }

            @Override
            public void seekByWithFlash(long deltaMs) {
                PlayerActivity.this.seekByWithFlash(deltaMs);
            }

            @Override
            public long contentPositionMs() {
                return PlayerActivity.this.contentPositionMs();
            }

            @Override
            public long contentDurationMs() {
                return PlayerActivity.this.contentDurationMs();
            }

            @Override
            public long timelineOriginMs() {
                return timelineOriginMs;
            }
        }
    );
    private boolean userPaused;
    /** Ignore the OK press that opened the player so it cannot pause the start. */
    private long suppressPauseUntilElapsed;
    private long lastToggleElapsedMs;
    private long pendingSeekMs;
    /** Content time already skipped by a transcode URL offset. Player time starts at 0. */
    private long timelineOriginMs;
    /** Resume offset passed with the current transcode. Cleared once the timeline is checked. */
    private long transcodeAnchorMs;
    private long scrubTargetMs = -1;
    /** Keep the bar on the scrubbed time until playback catches up. */
    private long scrubHoldUntilMs;
    private long pendingTranscodeSeekMs = -1;
    private long lastSeekTargetMs = -1;
    private long lastSeekAtMs;
    /** One HTTP failure after a seek can reload the stream. A second one is shown. */
    private boolean seekRecoveryUsed;
    /** The previous playlist 404s while a replacement stream is opening. Ignore that. */
    private boolean streamSwapInFlight;
    private float playbackSpeed = 1f;
    private boolean autoplayNext = true;
    private boolean autoSkipIntro;
    private boolean autoSkipCredits;
    /** off | manual | auto — prefer over autoSkip* booleans. */
    private String skipIntroMode = "manual";
    private String skipCreditsMode = "manual";
    private int rewindOnResumeSec;
    private long pausePositionMs = -1;
    private int audioBoost = 100;
    private String burnSubtitles = "auto";
    private int subtitleDelayMs;
    /** Extra offset from voice-activity auto-sync (external SRT only). */
    private int subtitleAutoSyncOffsetMs;
    private boolean subtitleAutoSync;
    private boolean subtitleAutoSyncAvailable;
    private boolean audioPassthrough;
    /** Settings → Auto-lower quality: step down by itself instead of asking once. */
    private boolean autoQuality;
    private long lastAutoQualityDropAt;
    private static final long AUTO_QUALITY_COOLDOWN_MS = 20_000;
    private int cinemaTrailerCount;
    private final OffsettingSubtitleDecoderFactory subtitleDecoderFactory = new OffsettingSubtitleDecoderFactory();
    private long sleepUntilElapsedRealtime;
    private boolean sleepEndOfEpisode;
    /** Remaining play-next transitions before sleep stops (persisted across episodes). */
    private int sleepEpisodesRemaining;
    private boolean sleepEpisodeLimit;
    private boolean sleepAtCredits;
    private final List<OptionItem> relatedItems = new ArrayList<>();
    /** Consecutive seconds in STATE_BUFFERING while play-when-ready (stall nudge). */
    private int bufferingStreakSec;
    private boolean qualityNudgeOffered;
    private static final String[] QUALITY_LADDER = {
        "original", "1080-20", "1080-12", "1080-8", "720-4", "720-2", "480-1.5", "360-0.7"
    };

    private String currentUrl = "";
    /** What PMS reports this HLS session is doing ("Transcoding video, audio" / "Direct Stream"); empty until known. */
    private String transcodeDetail = "";
    /** The stream URL transcodeDetail belongs to; a new URL clears it and asks again. */
    private String transcodeDetailUrl = "";
    private int transcodeDetailGen = 0;
    private String headersJson = "";
    private String qualityId = "";
    private String audioStreamId = "";
    private String subtitleStreamId = "";
    private int mediaIndex;
    private long durationHintMs;
    private long introStartMs = -1;
    private long introEndMs = -1;
    private long creditsStartMs = -1;
    private long creditsEndMs = -1;
    private String nextRatingKey = "";
    private String previousRatingKey = "";
    private String nextTitle = "";
    private String nextThumbUrl = "";
    private String loadedUpNextThumb = "";
    private String streamMode = "";
    private int streamWidth;
    private int streamHeight;
    private int streamBitrate;
    private String streamVideoCodec = "";
    private String streamAudioCodec = "";
    private String streamContainer = "";
    private String streamResolution = "";
    private String ratingKey = "";
    private String showKey = "";
    private String titleText = "";
    private String subtitleText = "";
    private String logoUrl = "";
    private String artUrl = "";
    private boolean musicMode;
    private boolean minimized;
    private String pendingLogoUrl = "";
    private String loadedLogoUrl = "";
    private String loadedArtUrl = "";
    private int logoLoadGeneration;
    private final ExecutorService logoExecutor = Executors.newSingleThreadExecutor();
    /**
     * Plex timeline / scrobble pings. App-wide, not shut down with the activity: the final
     * "stopped" (and watched scrobble) is queued as the player closes for the next episode,
     * and onDestroy's shutdownNow() on logoExecutor used to cancel it — so Plex kept showing
     * the finished episode as playing until its session timed out.
     */
    private static final ExecutorService TIMELINE_EXECUTOR = Executors.newSingleThreadExecutor();

    private final List<OptionItem> qualities = new ArrayList<>();
    private final List<OptionItem> audioTracks = new ArrayList<>();
    private final List<OptionItem> subtitles = new ArrayList<>();
    private final List<OptionItem> versions = new ArrayList<>();
    private final List<OptionItem> chapters = new ArrayList<>();
    private String previewThumbTemplate = "";
    private float videoFrameRate;
    private boolean nightMode;
    private boolean matchFrameRate = true;
    private int subtitleSizePct = 100;
    private String subtitleColor = "#ffffff";
    private String subtitleBackground = "none";
    private String subtitlePosition = "bottom";
    private int previewGeneration;
    private final DelayAudioProcessor delayAudioProcessor = new DelayAudioProcessor();
    private float videoZoom = 1f;
    private boolean videoFill;
    private int audioDelayMs;
    private int repeatMode;
    private String sidecarSubtitleUrl = "";
    private String sidecarSubtitleCodec = "";
    @Nullable private String pendingSidecarDownloadId;
    private boolean subtitleSearchPending;
    private boolean applyingTextTracks;
    private boolean applyingAudioTracks;
    private final PlexTimelineReporter timelineReporter = new PlexTimelineReporter(USER_AGENT);
    private int timelineKeepAliveTicks;

    private final Runnable hideChromeRunnable = () -> {
        if (isOptionDialogShowing()) return;
        setChromeVisible(false);
    };
    private final Runnable clearSwapRunnable = () -> streamSwapInFlight = false;
    /**
     * Resume target. Opening the file already at this time shows that frame and
     * then the clock never moves. Start at 0, and seek only after frames advance.
     */
    private long playThenSeekMs = -1;
    private boolean playThenSeekArmed;
    /** True once this open has produced a picture, even if isPlaying never flips. */
    private boolean resumeFrameSeen;
    private final Runnable playThenSeekRunnable = () -> {
        if (player == null || finishing || playThenSeekMs <= 0) return;
        if (userPaused) {
            playThenSeekArmed = false;
            return;
        }
        long target = playThenSeekMs;
        playThenSeekMs = -1;
        player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
        player.seekTo(target);
        player.setSeekParameters(SeekParameters.DEFAULT);
        player.setPlayWhenReady(true);
        try {
            player.play();
        } catch (Throwable ignored) {
            /* ignore */
        }
    };
    /** Position when the resume kick was armed — only remux if it stays frozen. */
    private long resumeKickArmPosMs = -1;
    /** After resume/seek, some SoCs show a still frame with playWhenReady stuck ineffective. */
    private final Runnable resumePlayKickRunnable = () -> {
        // A short focus loss (Assistant, notification) holds playback on purpose.
        // The frozen clock is not a stuck decoder, so do not kick or remux.
        if (player == null || userPaused || finishing || focusSuppressed()) {
            resumeKickArmPosMs = -1;
            return;
        }
        // isPlaying never arrived. The opening frame is enough — seek to the
        // resume point on the file already open. Do not start another session.
        if (playThenSeekMs > 0) {
            player.setPlayWhenReady(true);
            try {
                player.play();
            } catch (Throwable ignored) {
                /* ignore */
            }
            if (!playThenSeekArmed && (resumeFrameSeen || player.getPlaybackState() == Player.STATE_READY)) {
                armPlayThenSeek();
            }
            resumeKickArmPosMs = -1;
            return;
        }
        player.setPlayWhenReady(true);
        try {
            player.play();
        } catch (Throwable ignored) {
            /* ignore */
        }
        resumeKickArmPosMs = -1;
    };
    private final Runnable directSeekRunnable = () -> {
        if (player == null || scrubTargetMs < 0) return;
        player.seekTo(Math.max(0, scrubTargetMs - timelineOriginMs));
        emitProgress("playing");
    };
    private final Runnable transcodeSeekRunnable = () -> {
        long target = pendingTranscodeSeekMs;
        pendingTranscodeSeekMs = -1;
        if (target < 0) return;
        markStreamSwap();
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex, target, "seek");
    };
    private final Runnable tickRunnable = new Runnable() {
        @Override
        public void run() {
            updateProgressUi();
            updateWallClock();
            maybeAutoSkip();
            maybeShowUpNext();
            if (statsVisible) refreshStatsOverlay();
            maybeSleepTimer();
            maybeQualityNudge();
            String state = "paused";
            if (player != null && player.isPlaying()) state = "playing";
            else if (player != null && player.getPlaybackState() == Player.STATE_BUFFERING) state = "buffering";
            emitProgress(state);
            timelineKeepAliveTicks += 1;
            if (timelineKeepAliveTicks % 5 == 0) PlayerBridge.get().keepHostWebViewAlive();
            mainHandler.postDelayed(this, 1000);
        }
    };
    private final Runnable progressEmitRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && player.isPlaying()) {
                emitProgress("playing");
            }
            mainHandler.postDelayed(this, minimized ? 1000 : 5000);
        }
    };

    private static final String SUBTITLE_SEARCH_ID = "__search__";

    private static final class OptionItem {
        final String id;
        final String label;
        final String url;
        final String language;
        final String codec;
        /** Index among subtitles muxed into the file; -1 for sidecars / unknown. */
        int embeddedOrdinal = -1;
        /** OpenSubtitles hit PMS has yet to download; url is empty until JS resolves it. */
        String downloadKey = "";

        OptionItem(String id, String label) {
            this(id, label, "", "", "");
        }

        OptionItem(String id, String label, String url) {
            this(id, label, url, "", "");
        }

        OptionItem(String id, String label, String url, String language, String codec) {
            this.id = id;
            this.label = label;
            this.url = url == null ? "" : url;
            this.language = language == null ? "" : language;
            this.codec = codec == null ? "" : codec;
        }
    }

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        overridePendingTransition(0, 0);
        PlayerBridge.get().attachActivity(this);
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (insets != null) {
                insets.hide(WindowInsetsCompat.Type.systemBars());
                insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            setContentView(R.layout.activity_player);
            bindViews();

            Intent intent = getIntent();
            currentUrl = intent.getStringExtra(EXTRA_URL);
            String title = intent.getStringExtra(EXTRA_TITLE);
            titleText = title == null ? "" : title.trim();
            String extraLogo = intent.getStringExtra(EXTRA_LOGO_URL);
            logoUrl = extraLogo == null ? "" : extraLogo.trim();
            pendingSeekMs = Math.max(0, intent.getIntExtra(EXTRA_OFFSET_MS, 0));
            headersJson = intent.getStringExtra(EXTRA_HEADERS_JSON);
            playbackSpeed = intent.getFloatExtra(EXTRA_SPEED, 1f);
            autoplayNext = intent.getBooleanExtra(EXTRA_AUTOPLAY_NEXT, true);
            autoSkipIntro = intent.getBooleanExtra(EXTRA_AUTO_SKIP_INTRO, false);
            autoSkipCredits = intent.getBooleanExtra(EXTRA_AUTO_SKIP_CREDITS, false);
            skipIntroMode = autoSkipIntro ? "auto" : "manual";
            skipCreditsMode = autoSkipCredits ? "auto" : "manual";
            applySessionJson(intent.getStringExtra(EXTRA_SESSION_JSON));
            String sessionAudio = audioStreamId;
            String sessionSub = subtitleStreamId;
            restoreAvPrefs();
            restoreSleepPrefs();
            bufferingStreakSec = 0;
            qualityNudgeOffered = false;
            boolean avChanged = !String.valueOf(sessionAudio).equals(String.valueOf(audioStreamId))
                || !String.valueOf(sessionSub).equals(String.valueOf(subtitleStreamId));
            PlayerBridge.get().keepHostWebViewAlive();
            flashModeChip();

            if (currentUrl == null || currentUrl.trim().isEmpty()) {
                Log.e(TAG, "Missing playback url");
                finishWithResult(false, false);
                return;
            }
            currentUrl = currentUrl.trim();
            absorbTimelineFromUrl(currentUrl);
            applyTitleChrome();

            Map<String, String> headers = headersWithCookies(currentUrl, PlaybackUrls.parseHeaders(headersJson));
            headers.put("Accept-Encoding", "identity");

            httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(USER_AGENT)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(8_000)
                .setReadTimeoutMs(15_000)
                .setDefaultRequestProperties(headers);

            // DefaultDataSource covers file:// (offline downloads) and http(s).
            DefaultDataSource.Factory dataSourceFactory = new DefaultDataSource.Factory(this, httpFactory);
            boolean localPlayback = PlaybackUrls.isLocalPlaybackUrl(currentUrl);

            // Direct Play of a 20–80 Mbps file only held ~1.5s / 4MB before, so a brief
            // LAN hitch stalled playback for 2–3 seconds. Keep a real buffer on the
            // network path; local files stay small. minBuffer must stay >= the
            // playback / rebuffer start thresholds or LoadControl throws.
            DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    localPlayback ? 2_500 : 15_000,
                    localPlayback ? 10_000 : 50_000,
                    localPlayback ? 500 : 2_500,
                    localPlayback ? 1_000 : 5_000
                )
                .setTargetBufferBytes(localPlayback ? 4 * 1024 * 1024 : 48 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(false)
                .build();

            DefaultExtractorsFactory extractorsFactory = new DefaultExtractorsFactory();

            DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
                @Override
                protected AudioSink buildAudioSink(
                    Context context,
                    boolean enableFloatOutput,
                    boolean enableAudioTrackPlaybackParams
                ) {
                    return new DefaultAudioSink.Builder(context)
                        .setEnableFloatOutput(enableFloatOutput)
                        .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
                        .setAudioProcessors(new AudioProcessor[] { delayAudioProcessor })
                        .build();
                }

                @Override
                protected void buildTextRenderers(
                    Context context,
                    TextOutput output,
                    Looper outputLooper,
                    int extensionRendererMode,
                    ArrayList<Renderer> out
                ) {
                    out.add(new TextRenderer(output, outputLooper, subtitleDecoderFactory));
                }
            }
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_OFF)
                .setEnableDecoderFallback(true);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build();

            // handleAudioFocus: pause for calls / other apps / Assistant and duck for
            // short prompts. Becoming noisy: pause when headphones or BT audio drop.
            player = new ExoPlayer.Builder(this, renderersFactory)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory, extractorsFactory))
                .setLoadControl(loadControl)
                .setAudioAttributes(audioAttributes, true)
                .setHandleAudioBecomingNoisy(true)
                .setWakeMode(localPlayback ? C.WAKE_MODE_LOCAL : C.WAKE_MODE_NETWORK)
                .build();
            player.setVideoScalingMode(C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
            // Snap to the nearest keyframe so a seek does not download a long gap.
            player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
            applySpeed(playbackSpeed);
            applyNightMode();
            applyRepeatMode();
            applyAudioDelay(false);
            applyVideoZoom();
            applySubtitleDelay();

            PlayerView playerView = findViewById(R.id.player_view);
            playerView.setPlayer(player);
            playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
            playerView.setKeepScreenOn(true);
            playerView.setOnClickListener(v -> toggleChrome());
            applySubtitleLook(playerView);
            applyFrameRate(playerView);

            // If saved AV prefs need a different stream (image-sub burn, etc.), do NOT
            // prepare the opener URL first — swapping mid MediaCodec init hard-crashes
            // some Android TV SoCs. Wait for JS updateSrc instead.
            boolean needsAvRebuild = false;
            if (avChanged) {
                OptionItem restoredSub = findSubtitleOption(subtitleStreamId);
                boolean burn = restoredSub != null && subtitleCodecNeedsBurn(restoredSub.codec);
                // Text subs on Direct Play only need a track select — safe to prepare now.
                needsAvRebuild = burn || !PlaybackUrls.isDirectPlayUrl(currentUrl);
            }

            wirePlayerListener();
            sessionController.start(player);
            wireControls();
            updateActionVisibility();
            updateChipLabels();
            bumpChrome();
            if (playPauseBtn != null) playPauseBtn.requestFocus();

            if (needsAvRebuild) {
                Log.i(TAG, "Deferring prepare for AV rebuild url=" + PlaybackUrls.summarizeUrl(currentUrl));
                userPaused = false;
                suppressPauseUntilElapsed = android.os.SystemClock.elapsedRealtime() + 1200;
                player.setPlayWhenReady(true);
                setBufferingVisible(true);
                long offset = pendingSeekMs;
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex, offset);
            } else {
                Log.i(TAG, "Starting ExoPlayer url=" + PlaybackUrls.summarizeUrl(currentUrl));
                userPaused = false;
                suppressPauseUntilElapsed = android.os.SystemClock.elapsedRealtime() + 1200;
                queueStartPosition(currentUrl, pendingSeekMs);
                pendingSeekMs = 0;
                player.setPlayWhenReady(true);
                player.prepare();
                try {
                    player.play();
                } catch (Throwable ignored) {
                    /* prepare already has playWhenReady set */
                }
                applyAudioTrackPreference();
                applyTextTrackPreference();
                if (avChanged) notifyTracksOnlyChange();
            }
            mainHandler.post(tickRunnable);
            mainHandler.postDelayed(progressEmitRunnable, 5000);
            updatePipVisibility();
        } catch (Throwable t) {
            Log.e(TAG, "PlayerActivity failed to start", t);
            playbackError = true;
            String detail = t.getClass().getSimpleName();
            if (t.getMessage() != null && !t.getMessage().isEmpty()) {
                detail = detail + ": " + t.getMessage();
            }
            if (detail.length() > 80) detail = detail.substring(0, 80);
            toast("Unable to start player (" + detail + ")");
            finishWithResult(false, false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    private void bindViews() {
        chrome = findViewById(R.id.player_chrome);
        topBar = findViewById(R.id.player_top);
        menuScrim = findViewById(R.id.player_menu_scrim);
        menuTitle = findViewById(R.id.player_menu_title);
        menuScroll = findViewById(R.id.player_menu_scroll);
        menuList = findViewById(R.id.player_menu_list);
        if (menuScrim != null) {
            menuScrim.setOnClickListener(v -> hideOptionSheet());
        }
        bufferingView = findViewById(R.id.player_buffering);
        burnOverlay = findViewById(R.id.player_burn_overlay);
        burnCancelBtn = findViewById(R.id.player_burn_cancel);
        if (burnCancelBtn != null) {
            burnCancelBtn.setOnClickListener(v -> cancelBurnInSubtitles());
        }
        errorView = findViewById(R.id.player_error);
        titleView = findViewById(R.id.player_title);
        modeChipView = findViewById(R.id.player_mode_chip);
        resolutionChipView = findViewById(R.id.player_resolution_chip);
        statsView = findViewById(R.id.player_stats);
        clockView = findViewById(R.id.player_clock);
        updateWallClock();
        logoView = findViewById(R.id.player_logo);
        artView = findViewById(R.id.player_art);
        seekBar = findViewById(R.id.player_seek);
        if (seekBar != null) {
            seekBar.setBackground(null);
            seekBar.setSplitTrack(false);
            if (Build.VERSION.SDK_INT >= 26) {
                seekBar.setDefaultFocusHighlightEnabled(false);
            }
        }
        timeView = findViewById(R.id.player_time);
        remainingView = findViewById(R.id.player_remaining);
        endsAtView = findViewById(R.id.player_ends_at);
        speedLabel = findViewById(R.id.player_speed_label);
        metaView = findViewById(R.id.player_meta);
        seekFlashView = findViewById(R.id.player_seek_flash);
        playPauseBtn = findViewById(R.id.player_play_pause);
        prevEpisodeBtn = findViewById(R.id.player_prev_episode);
        nextEpisodeBtn = findViewById(R.id.player_next_episode);
        settingsBtn = findViewById(R.id.player_settings);
        skipRow = findViewById(R.id.player_skip_row);
        skipIntroBtn = findViewById(R.id.player_skip_intro);
        skipCreditsBtn = findViewById(R.id.player_skip_credits);
        qualityBtn = findViewById(R.id.player_quality);
        audioBtn = findViewById(R.id.player_audio);
        subsBtn = findViewById(R.id.player_subs);
        versionBtn = findViewById(R.id.player_version);
        speedBtn = findViewById(R.id.player_speed);
        sleepBtn = findViewById(R.id.player_sleep);
        externalBtn = findViewById(R.id.player_external);
        upNextRow = findViewById(R.id.player_up_next);
        upNextArt = findViewById(R.id.player_up_next_art);
        if (upNextArt != null) {
            // Card is player_context_sheet (18dp, 6dp inset) — art follows its inner curve.
            final float artRadius = 12f * getResources().getDisplayMetrics().density;
            upNextArt.setOutlineProvider(new ViewOutlineProvider() {
                @Override
                public void getOutline(View view, Outline outline) {
                    outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), artRadius);
                }
            });
            upNextArt.setClipToOutline(true);
        }
        upNextKicker = findViewById(R.id.player_up_next_kicker);
        upNextLabel = findViewById(R.id.player_up_next_label);
        upNextCountdown = findViewById(R.id.player_up_next_countdown);
        upNextPlayBtn = findViewById(R.id.player_up_next_play);
        upNextCreditsBtn = findViewById(R.id.player_up_next_credits);
        zoomBtn = findViewById(R.id.player_zoom);
        delayBtn = findViewById(R.id.player_delay);
        repeatBtn = findViewById(R.id.player_repeat);
        chaptersBtn = findViewById(R.id.player_chapters);
        pipBtn = findViewById(R.id.player_pip);
        seekPreview = findViewById(R.id.player_seek_preview);
        // Top-left title / episode line and the delivery + resolution badges: the app's clock
        // face (medium Switzer), as on the TV Home and title pages.
        applyAssetTypeface("fonts/switzer_medium.ttf", titleView, metaView, modeChipView, resolutionChipView);
        applySatoshiTypeface(
            timeView,
            remainingView,
            endsAtView,
            seekFlashView,
            clockView,
            menuTitle,
            speedLabel
        );

        ImageButton close = findViewById(R.id.player_close);
        if (close != null) close.setOnClickListener(v -> finishWithResult(false, false));
        disableTvFocusBox(
            close,
            seekBar,
            playPauseBtn,
            prevEpisodeBtn,
            nextEpisodeBtn,
            settingsBtn,
            findViewById(R.id.player_seek_back),
            findViewById(R.id.player_seek_fwd),
            skipIntroBtn,
            skipCreditsBtn,
            qualityBtn,
            audioBtn,
            subsBtn,
            versionBtn,
            speedBtn,
            sleepBtn,
            externalBtn,
            pipBtn,
            chaptersBtn,
            zoomBtn,
            delayBtn,
            repeatBtn,
            findViewById(R.id.player_up_next_play),
            findViewById(R.id.player_up_next_credits)
        );
    }

    private void applySatoshiTypeface(TextView... views) {
        applyAssetTypeface("fonts/satoshi_bold.ttf", views);
    }

    private void applyAssetTypeface(String assetPath, TextView... views) {
        Typeface face;
        try {
            face = Typeface.createFromAsset(getAssets(), assetPath);
        } catch (RuntimeException ignored) {
            return;
        }
        for (TextView view : views) {
            if (view != null) view.setTypeface(face);
        }
    }

    private void disableTvFocusBox(View... views) {
        if (Build.VERSION.SDK_INT < 26) return;
        for (View view : views) {
            if (view != null) view.setDefaultFocusHighlightEnabled(false);
        }
    }

    private void wireControls() {
        if (playPauseBtn != null) playPauseBtn.setOnClickListener(v -> togglePlayPause());
        if (prevEpisodeBtn != null) prevEpisodeBtn.setOnClickListener(v -> finishForPlayPrevious());
        if (nextEpisodeBtn != null) nextEpisodeBtn.setOnClickListener(v -> finishForPlayNext());
        if (settingsBtn != null) settingsBtn.setOnClickListener(v -> showSettingsRoot());
        View seekBack = findViewById(R.id.player_seek_back);
        if (seekBack != null) seekBack.setOnClickListener(v -> seekByWithFlash(-10_000));
        View seekFwd = findViewById(R.id.player_seek_fwd);
        if (seekFwd != null) seekFwd.setOnClickListener(v -> seekByWithFlash(10_000));
        if (skipIntroBtn != null) skipIntroBtn.setOnClickListener(v -> doSkipIntro());
        if (skipCreditsBtn != null) skipCreditsBtn.setOnClickListener(v -> doSkipCredits());
        View upNextPlay = findViewById(R.id.player_up_next_play);
        if (upNextPlay != null) upNextPlay.setOnClickListener(v -> finishForPlayNext());
        if (qualityBtn != null) qualityBtn.setOnClickListener(v -> showOptionMenu(R.string.player_quality, "quality", qualities, qualityId));
        if (upNextPlayBtn != null) upNextPlayBtn.setOnClickListener(v -> finishForPlayNext());
        if (upNextCreditsBtn != null) upNextCreditsBtn.setOnClickListener(v -> dismissUpNextWatchCredits());
        audioBtn.setOnClickListener(v -> showOptionMenu(R.string.player_audio, "audio", audioTracks, audioStreamId == null ? "" : audioStreamId));
        subsBtn.setOnClickListener(v -> showSubtitleMenu());
        versionBtn.setOnClickListener(v -> showOptionMenu(R.string.player_version, "version", versions, String.valueOf(mediaIndex)));
        speedBtn.setOnClickListener(v -> showSpeedMenu());
        if (zoomBtn != null) zoomBtn.setOnClickListener(v -> showZoomMenu());
        if (delayBtn != null) delayBtn.setOnClickListener(v -> showDelayMenu());
        if (repeatBtn != null) repeatBtn.setOnClickListener(v -> showRepeatMenu());
        sleepBtn.setOnClickListener(v -> showSleepMenu());
        externalBtn.setOnClickListener(v -> openExternalPlayer());
        if (pipBtn != null) pipBtn.setOnClickListener(v -> enterPip());
        if (chaptersBtn != null) {
            chaptersBtn.setOnClickListener(v -> showChaptersMenu());
        }

        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (!fromUser || player == null) return;
                long duration = contentDurationMs();
                if (duration <= 0) return;
                long pos = (long) ((progress / 1000.0) * duration);
                setTimeLabels(pos, duration);
                showSeekPreview(pos);
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                seekingUi = true;
                bumpChrome();
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                hideSeekPreview();
                if (player == null) {
                    seekingUi = false;
                    return;
                }
                long duration = contentDurationMs();
                if (duration <= 0) {
                    seekingUi = false;
                    return;
                }
                long pos = (long) ((bar.getProgress() / 1000.0) * duration);
                seekToContent(pos, true);
                emitProgress("playing");
                bumpChrome();
            }
        });
        // SeekBar consumes Left/Right itself and only moves the thumb. Swallow those
        // keys here so a press on the bar actually changes the playback position.
        seekBar.setOnKeyListener((v, keyCode, event) -> {
            boolean seekKey = keyCode == KeyEvent.KEYCODE_DPAD_LEFT
                || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
                || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND
                || keyCode == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD;
            if (!seekKey) return false;
            int direction = (keyCode == KeyEvent.KEYCODE_DPAD_LEFT || keyCode == KeyEvent.KEYCODE_MEDIA_REWIND)
                ? -1
                : 1;
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) startSeekHold(direction);
                return true;
            }
            if (event.getAction() == KeyEvent.ACTION_UP) {
                stopSeekHold();
                return true;
            }
            return true;
        });
    }

    private void wirePlayerListener() {
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                boolean waitingToPlay = playbackState == Player.STATE_BUFFERING
                    || (playbackState == Player.STATE_READY && !player.isPlaying() && !userPaused
                        && !focusSuppressed());
                setBufferingVisible(waitingToPlay);
                if (playbackState == Player.STATE_READY) {
                    playbackError = false;
                    hideError();
                    hideBurnInProgress();
                    if (pendingSeekMs > 0 && !PlaybackUrls.isTranscodeUrl(currentUrl)) {
                        long seekTo = pendingSeekMs;
                        pendingSeekMs = 0;
                        player.seekTo(seekTo);
                    } else {
                        pendingSeekMs = 0;
                    }
                    reconcileTranscodeOrigin();
                    long landed = timelineOriginMs + Math.max(0, player.getCurrentPosition());
                    if (scrubTargetMs < 0 || Math.abs(landed - scrubTargetMs) < 2500) {
                        seekingUi = false;
                        scrubTargetMs = -1;
                    }
                    if (!userPaused) {
                        player.setPlayWhenReady(true);
                        try {
                            player.play();
                        } catch (Throwable ignored) {
                            /* ignore */
                        }
                        if (PlaybackUrls.isDirectPlayUrl(currentUrl)) applyAudioTrackPreference();
                        mainHandler.removeCallbacks(resumePlayKickRunnable);
                        resumeKickArmPosMs = contentPositionMs();
                        mainHandler.postDelayed(resumePlayKickRunnable, 2500);
                    }
                    if (player.isPlaying()) {
                        mainHandler.removeCallbacks(hideChromeRunnable);
                        mainHandler.postDelayed(hideChromeRunnable, 2500);
                    }
                    applyVideoZoom();
                }
                if (playbackState == Player.STATE_ENDED) {
                    playbackEnded = true;
                    if (sleepEndOfEpisode) {
                        clearSleepPrefs();
                        finishWithResult(true, false);
                        return;
                    }
                    if (repeatMode == Player.REPEAT_MODE_ONE
                        || (repeatMode == Player.REPEAT_MODE_ALL
                            && (nextRatingKey == null || nextRatingKey.isEmpty()))) {
                        playbackEnded = false;
                        player.seekTo(0);
                        player.setPlayWhenReady(true);
                        return;
                    }
                    if ((autoplayNext || repeatMode == Player.REPEAT_MODE_ALL)
                        && nextRatingKey != null && !nextRatingKey.isEmpty()) {
                        if (musicMode) requestPlayNextWithoutFinish();
                        else finishForPlayNext();
                    } else {
                        finishWithResult(true, false);
                    }
                }
                updatePlayPauseLabel();
            }

            @Override
            public void onRenderedFirstFrame() {
                resumeFrameSeen = true;
                View cover = findViewById(R.id.player_surface_cover);
                if (cover != null) cover.setVisibility(View.GONE);
                if (player != null && player.isPlaying()) setBufferingVisible(false);
                // Some TVs paint the first frame and never report isPlaying.
                // That used to leave resume stuck at the opening frame.
                armPlayThenSeek();
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                // Another app took audio focus for good, or headphones dropped. Treat it
                // as a user pause, or the resume kicks would start playback again.
                if (playWhenReady) return;
                if (reason != Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS
                    && reason != Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY) return;
                pausePositionMs = contentPositionMs();
                userPaused = true;
                mainHandler.removeCallbacks(playThenSeekRunnable);
                mainHandler.removeCallbacks(resumePlayKickRunnable);
                setBufferingVisible(false);
                updatePlayPauseLabel();
                if (!minimized) bumpChrome();
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) armPlayThenSeek();
                updatePlayPauseLabel();
                emitProgress(isPlaying ? "playing" : "paused");
            }

            @Override
            public void onVideoSizeChanged(VideoSize videoSize) {
                updateResolutionChip();
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                boolean hasVideo = false;
                boolean hasAudio = false;
                for (Tracks.Group group : tracks.getGroups()) {
                    if (!group.isSelected()) continue;
                    int type = group.getType();
                    if (type == C.TRACK_TYPE_VIDEO) hasVideo = true;
                    if (type == C.TRACK_TYPE_AUDIO) hasAudio = true;
                }
                if (!hasVideo && hasAudio) {
                    toast("Audio only — this file may need a transcode for this TV");
                }
                if (PlaybackUrls.isDirectPlayUrl(currentUrl)) {
                    applyAudioTrackPreference();
                    applyTextTrackPreference();
                } else if (sidecarSubtitleUrl != null && !sidecarSubtitleUrl.isEmpty()) {
                    applyTextTrackPreference();
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                Log.e(TAG, "ExoPlayer error " + error.getErrorCodeName(), error);
                if (trySeekRecovery(error)) return;
                if (tryStreamFallback(error)) return;
                playbackError = true;
                String message = "Playback error: " + error.getErrorCodeName();
                toast(message);
                showError(message);
                JSObject data = new JSObject();
                data.put("message", error.getErrorCodeName());
                PlayerBridge.get().emit("error", data);
                // Leave the dead player. Staying here traps the remote, and falling
                // through to the web player starts the same title again.
                // Give JS time to fetch an HLS URL (Direct Play → HLS) before closing.
                final int gen = errorGeneration;
                mainHandler.postDelayed(() -> {
                    if (finishing || gen != errorGeneration || !playbackError) return;
                    finishWithResult(false, false);
                }, 5000);
            }
        });
    }

    void applySessionJson(@Nullable String sessionJson) {
        if (sessionJson == null || sessionJson.trim().isEmpty()) return;
        try {
            JSONObject root = new JSONObject(sessionJson);
            // Not "previousRatingKey": that field is the previous episode for the ⏮ button.
            String ratingKeyBefore = ratingKey;
            ratingKey = root.optString("ratingKey", ratingKey);
            showKey = root.optString("showKey", showKey);
            String nextRating = root.optString("ratingKey", ratingKey);
            if (nextRating != null && !nextRating.equals(ratingKey)) watchCreditsChosen = false;
            ratingKey = nextRating;
            audioStreamId = root.optString("audioStreamId", audioStreamId);
            subtitleStreamId = root.optString("subtitleStreamId", subtitleStreamId);
            mediaIndex = root.optInt("mediaIndex", mediaIndex);
            durationHintMs = root.optLong("durationMs", durationHintMs);
            if (root.has("autoplayNext")) autoplayNext = root.optBoolean("autoplayNext", autoplayNext);
            if (root.has("autoSkipIntro")) autoSkipIntro = root.optBoolean("autoSkipIntro", autoSkipIntro);
            if (root.has("autoSkipCredits")) autoSkipCredits = root.optBoolean("autoSkipCredits", autoSkipCredits);
            if (root.has("skipIntroMode")) {
                skipIntroMode = normalizeSkipMode(root.optString("skipIntroMode", skipIntroMode), autoSkipIntro);
                autoSkipIntro = "auto".equals(skipIntroMode);
            } else if (root.has("autoSkipIntro")) {
                skipIntroMode = autoSkipIntro ? "auto" : "manual";
            }
            if (root.has("skipCreditsMode")) {
                skipCreditsMode = normalizeSkipMode(root.optString("skipCreditsMode", skipCreditsMode), autoSkipCredits);
                autoSkipCredits = "auto".equals(skipCreditsMode);
            } else if (root.has("autoSkipCredits")) {
                skipCreditsMode = autoSkipCredits ? "auto" : "manual";
            }
            if (root.has("rewindOnResumeSec")) {
                int n = root.optInt("rewindOnResumeSec", rewindOnResumeSec);
                if (n == 0 || n == 5 || n == 10 || n == 15 || n == 20 || n == 30) rewindOnResumeSec = n;
            }
            if (root.has("audioBoost")) {
                int n = root.optInt("audioBoost", audioBoost);
                if (n == 100 || n == 200 || n == 300) audioBoost = n;
            }
            if (root.has("burnSubtitles")) {
                String burn = root.optString("burnSubtitles", burnSubtitles);
                if ("always".equals(burn) || "image".equals(burn) || "auto".equals(burn)) burnSubtitles = burn;
            }
            if (root.has("subtitleDelayMs")) {
                subtitleDelayMs = Math.max(-5000, Math.min(5000, root.optInt("subtitleDelayMs", subtitleDelayMs)));
            }
            if (root.has("subtitleAutoSync")) subtitleAutoSync = root.optBoolean("subtitleAutoSync", subtitleAutoSync);
            if (root.has("subtitleAutoSyncAvailable")) {
                subtitleAutoSyncAvailable = root.optBoolean("subtitleAutoSyncAvailable", subtitleAutoSyncAvailable);
            }
            if (root.has("subtitleAutoSyncOffsetMs")) {
                subtitleAutoSyncOffsetMs = Math.max(-5000, Math.min(5000,
                    root.optInt("subtitleAutoSyncOffsetMs", subtitleAutoSyncOffsetMs)));
            }
            if (root.has("audioPassthrough")) audioPassthrough = root.optBoolean("audioPassthrough", audioPassthrough);
            if (root.has("autoQuality")) autoQuality = root.optBoolean("autoQuality", autoQuality);
            if (root.has("cinemaTrailerCount")) {
                cinemaTrailerCount = Math.max(0, Math.min(5, root.optInt("cinemaTrailerCount", cinemaTrailerCount)));
            }
            if (root.has("title")) {
                String nextTitleText = root.optString("title", "").trim();
                if (!nextTitleText.isEmpty()) titleText = nextTitleText;
            }
            if (root.has("subtitle")) {
                subtitleText = root.optString("subtitle", "").trim();
            }
            if (root.has("meta")) {
                metaText = root.optString("meta", "").trim();
            }
            if (root.has("logoUrl")) {
                logoUrl = root.optString("logoUrl", "").trim();
            }
            if (root.has("posterUrl")) {
                artUrl = root.optString("posterUrl", "").trim();
            }
            if (root.has("watchNext")) {
                applyWatchNextJson(root.optJSONObject("watchNext"));
            } else if (!String.valueOf(ratingKeyBefore).equals(String.valueOf(ratingKey))) {
                // A music / src update for another item without Watch Next data.
                applyWatchNextJson(null);
            }
            if (root.has("music")) {
                musicMode = root.optBoolean("music", musicMode);
            }

            JSONObject markers = root.optJSONObject("markers");
            if (markers != null) {
                JSONObject intro = markers.optJSONObject("intro");
                if (intro != null) {
                    introStartMs = intro.optLong("startMs", -1);
                    introEndMs = intro.optLong("endMs", -1);
                }
                JSONObject credits = markers.optJSONObject("credits");
                if (credits != null) {
                    creditsStartMs = credits.optLong("startMs", -1);
                    if (credits.has("endMs")) creditsEndMs = credits.optLong("endMs", -1);
                }
            }

            JSONObject next = root.optJSONObject("nextItem");
            if (next != null) {
                nextRatingKey = next.optString("ratingKey", "");
                nextTitle = next.optString("title", "");
                nextThumbUrl = next.optString("thumb", "");
            }
            JSONObject previous = root.optJSONObject("previousItem");
            if (previous != null) {
                previousRatingKey = previous.optString("ratingKey", "");
            }
            applyEpisodeNavButtons();
            String prevMode = streamMode;
            if (root.has("playbackMode")) streamMode = root.optString("playbackMode", streamMode);
            JSONObject source = root.optJSONObject("source");
            if (source != null) {
                streamWidth = source.optInt("width", streamWidth);
                streamHeight = source.optInt("height", streamHeight);
                streamBitrate = source.optInt("bitrate", streamBitrate);
                streamVideoCodec = source.optString("videoCodec", streamVideoCodec);
                streamAudioCodec = source.optString("audioCodec", streamAudioCodec);
                streamContainer = source.optString("container", streamContainer);
                streamResolution = source.optString("videoResolution", streamResolution);
            }
            if (root.has("relatedItems")) {
                relatedItems.clear();
                JSONArray related = root.optJSONArray("relatedItems");
                if (related != null) {
                    for (int i = 0; i < related.length() && relatedItems.size() < 5; i++) {
                        JSONObject row = related.optJSONObject(i);
                        if (row == null) continue;
                        String key = row.optString("ratingKey", "");
                        String label = row.optString("title", "");
                        if (key.isEmpty() || label.isEmpty()) continue;
                        relatedItems.add(new OptionItem(key, label));
                    }
                }
            }
            if (root.has("nightMode")) nightMode = root.optBoolean("nightMode", nightMode);
            if (root.has("matchFrameRate")) matchFrameRate = root.optBoolean("matchFrameRate", matchFrameRate);
            if (root.has("videoZoom")) videoZoom = (float) root.optDouble("videoZoom", videoZoom);
            if (root.has("videoFill")) videoFill = root.optBoolean("videoFill", videoFill);
            if (root.has("audioDelayMs")) audioDelayMs = Math.max(0, Math.min(1000, root.optInt("audioDelayMs", audioDelayMs)));
            if (root.has("playbackMode") && streamMode != null && !streamMode.equals(prevMode)) {
                flashModeChip();
            }
            if (root.has("repeatMode")) {
                String mode = root.optString("repeatMode", "");
                if ("one".equalsIgnoreCase(mode) || "1".equals(mode)) repeatMode = Player.REPEAT_MODE_ONE;
                else if ("all".equalsIgnoreCase(mode) || "2".equals(mode)) repeatMode = Player.REPEAT_MODE_ALL;
                else if ("off".equalsIgnoreCase(mode) || "0".equals(mode)) repeatMode = Player.REPEAT_MODE_OFF;
            }
            if (root.has("sidecarSubtitleUrl")) sidecarSubtitleUrl = root.optString("sidecarSubtitleUrl", sidecarSubtitleUrl);
            if (root.has("frameRate")) videoFrameRate = (float) root.optDouble("frameRate", videoFrameRate);
            previewThumbTemplate = root.optString("previewThumbTemplate", previewThumbTemplate);
            timelineReporter.applySessionTimeline(root.optJSONObject("timeline"));
            JSONObject subtitleStyle = root.optJSONObject("subtitleStyle");
            if (subtitleStyle != null) {
                subtitleSizePct = subtitleStyle.optInt("size", subtitleSizePct);
                subtitleColor = subtitleStyle.optString("color", subtitleColor);
                subtitleBackground = subtitleStyle.optString("background", subtitleBackground);
                subtitlePosition = subtitleStyle.optString("position", subtitlePosition);
            }
            if (root.has("chapters")) {
                chapters.clear();
                JSONArray chapterRows = root.optJSONArray("chapters");
                if (chapterRows != null) {
                    for (int i = 0; i < chapterRows.length(); i++) {
                        JSONObject row = chapterRows.optJSONObject(i);
                        if (row == null) continue;
                        long startMs = row.optLong("startMs", -1);
                        if (startMs < 0) continue;
                        String title = row.optString("title", "Chapter " + (i + 1));
                        chapters.add(new OptionItem(String.valueOf(startMs), title));
                    }
                }
            }

            if (root.has("qualities")) {
                qualities.clear();
                qualities.addAll(parseOptions(root.optJSONArray("qualities")));
            }
            if (root.has("audioTracks")) {
                audioTracks.clear();
                audioTracks.addAll(parseOptions(root.optJSONArray("audioTracks")));
            }
            if (root.has("subtitles")) {
                subtitles.clear();
                subtitles.addAll(parseOptions(root.optJSONArray("subtitles")));
            }
            if (root.has("versions")) {
                versions.clear();
                versions.addAll(parseOptions(root.optJSONArray("versions")));
            }
            JSONObject sidecarResolved = root.optJSONObject("sidecarResolved");
            runOnUiThread(() -> {
                if (sidecarResolved != null && pendingSidecarDownloadId != null
                    && pendingSidecarDownloadId.equals(sidecarResolved.optString("id", ""))) {
                    pendingSidecarDownloadId = null;
                    OptionItem picked = findSubtitleOption(sidecarResolved.optString("id", ""));
                    if (sidecarResolved.optBoolean("failed", false) || picked == null || picked.url.isEmpty()) {
                        toast(getString(R.string.player_subs_download_failed));
                    } else {
                        applySubtitleChoice(picked);
                    }
                }
                updateActionVisibility();
                updateChipLabels();
                applyTitleChrome();
                applyUpNextArt();
                if (statsVisible) refreshStatsOverlay();
                applyNightMode();
                applyRepeatMode();
                applyAudioDelay(false);
                applyVideoZoom();
                applySubtitleDelay();
                PlayerView view = findViewById(R.id.player_view);
                if (view != null) {
                    applySubtitleLook(view);
                    applyFrameRate(view);
                }
                if (subtitleAutoSync && subtitleAutoSyncAvailable && externalSrtSelected()
                    && subtitleAutoSyncOffsetMs == 0) {
                    requestSubtitleAutoSync();
                }
                if (subtitleSearchPending) {
                    subtitleSearchPending = false;
                    showSubtitleMenu();
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse sessionJson", e);
        }
    }

    private void applyTitleChrome() {
        if (titleView != null) {
            String line = titleText == null ? "" : titleText;
            if (musicMode && subtitleText != null && !subtitleText.trim().isEmpty()) {
                line = line.isEmpty() ? subtitleText.trim() : (line + "\n" + subtitleText.trim());
            }
            titleView.setText(line);
        }
        if (metaView != null) {
            String meta = musicMode ? "" : (metaText == null ? "" : metaText.trim());
            if (meta.isEmpty() && !musicMode && subtitleText != null && !subtitleText.trim().isEmpty()) {
                meta = subtitleText.trim();
            }
            metaView.setText(meta);
            metaView.setVisibility(meta.isEmpty() ? View.GONE : View.VISIBLE);
        }
        applyArtChrome();
        if (musicMode) {
            if (logoView != null) {
                logoView.setVisibility(View.GONE);
                logoView.setImageDrawable(null);
            }
            return;
        }
        if (logoView == null) return;
        String url = logoUrl == null ? "" : logoUrl.trim();
        if (url.isEmpty()) {
            logoLoadGeneration += 1;
            pendingLogoUrl = "";
            loadedLogoUrl = "";
            showTitleText();
            return;
        }
        if (url.equals(loadedLogoUrl) && logoView.getVisibility() == View.VISIBLE) {
            logoView.setContentDescription(titleText);
            return;
        }
        if (url.equals(pendingLogoUrl)) return;
        pendingLogoUrl = url;
        showTitleText();
        final int gen = ++logoLoadGeneration;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                if (bitmap != null) bitmap = trimTransparent(bitmap);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (gen != logoLoadGeneration || isFinishing()) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        pendingLogoUrl = "";
                        loadedLogoUrl = "";
                        showTitleText();
                        return;
                    }
                    logoView.setImageBitmap(ready);
                    logoView.setContentDescription(titleText);
                    logoView.setVisibility(View.VISIBLE);
                    if (titleView != null) titleView.setVisibility(View.GONE);
                    loadedLogoUrl = fetchUrl;
                    pendingLogoUrl = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Clear logo load skipped", e);
            pendingLogoUrl = "";
            showTitleText();
        }
    }

    private void applyArtChrome() {
        if (artView == null) return;
        String url = artUrl == null ? "" : artUrl.trim();
        if (!musicMode || url.isEmpty()) {
            artView.setVisibility(View.GONE);
            artView.setImageDrawable(null);
            loadedArtUrl = "";
            return;
        }
        if (url.equals(loadedArtUrl) && artView.getVisibility() == View.VISIBLE) return;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (isFinishing()) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        artView.setVisibility(View.GONE);
                        return;
                    }
                    artView.setImageBitmap(ready);
                    artView.setVisibility(View.VISIBLE);
                    loadedArtUrl = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Album art load skipped", e);
        }
    }

    private void applyUpNextArt() {
        if (upNextArt == null) return;
        String url = nextThumbUrl == null ? "" : nextThumbUrl.trim();
        if (url.isEmpty()) {
            upNextArt.setVisibility(View.GONE);
            upNextArt.setImageDrawable(null);
            loadedUpNextThumb = "";
            return;
        }
        if (url.equals(loadedUpNextThumb) && upNextArt.getVisibility() == View.VISIBLE) return;
        final String fetchUrl = url;
        final Map<String, String> imageHeaders = headersForImageUrl(fetchUrl);
        try {
            logoExecutor.execute(() -> {
                Bitmap bitmap = downloadLogoBitmap(fetchUrl, imageHeaders);
                final Bitmap ready = bitmap;
                mainHandler.post(() -> {
                    if (isFinishing() || upNextArt == null) return;
                    if (ready == null || ready.getWidth() < 8 || ready.getHeight() < 8) {
                        upNextArt.setVisibility(View.GONE);
                        return;
                    }
                    upNextArt.setImageBitmap(ready);
                    upNextArt.setVisibility(View.VISIBLE);
                    loadedUpNextThumb = fetchUrl;
                });
            });
        } catch (Exception e) {
            Log.w(TAG, "Up next art load skipped", e);
        }
    }

    private boolean isStatsKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_INFO
            || keyCode == KeyEvent.KEYCODE_F1
            || keyCode == KeyEvent.KEYCODE_WINDOW;
    }

    private void toggleStatsOverlay() {
        statsVisible = !statsVisible;
        if (statsView != null) statsView.setVisibility(statsVisible ? View.VISIBLE : View.GONE);
        if (statsVisible) refreshStatsOverlay();
    }

    private void hideStatsOverlay() {
        statsVisible = false;
        if (statsView != null) statsView.setVisibility(View.GONE);
    }

    private String playbackModeLabel() {
        String mode = streamMode == null ? "" : streamMode.trim();
        // The stream actually open decides: the JS mode stays "directPlay" when the player falls
        // back to HLS or a lower quality itself, which left the badge stuck on Direct Play.
        if (PlaybackUrls.isTranscodeUrl(currentUrl)) {
            if (!transcodeDetail.isEmpty() && currentUrl.equals(transcodeDetailUrl)) return transcodeDetail;
            return "directStream".equalsIgnoreCase(mode)
                ? getString(R.string.player_direct_stream)
                : getString(R.string.player_transcode);
        }
        if ("directPlay".equalsIgnoreCase(mode)) return getString(R.string.player_direct_play);
        if ("directStream".equalsIgnoreCase(mode)) return getString(R.string.player_direct_stream);
        if ("transcode".equalsIgnoreCase(mode) || PlaybackUrls.isTranscodeUrl(currentUrl)) {
            return getString(R.string.player_transcode);
        }
        if (currentUrl != null && (currentUrl.contains("/library/parts/") || currentUrl.contains("/file/"))) {
            return getString(R.string.player_direct_play);
        }
        return getString(R.string.player_direct_stream);
    }

    private String formatBitrateLabel(int bitrate) {
        if (bitrate <= 0) return "";
        double mbps = bitrate >= 100000 ? bitrate / 1_000_000.0 : bitrate / 1000.0;
        return String.format(Locale.US, "%.1f Mbps", mbps);
    }

    private String currentQualityLabel() {
        if (qualityId == null || qualityId.isEmpty()) return "";
        for (OptionItem row : qualities) {
            if (qualityId.equals(row.id)) return row.label;
        }
        return qualityId;
    }

    private String currentAudioLabel() {
        if (audioStreamId == null || audioStreamId.isEmpty()) return "";
        for (OptionItem row : audioTracks) {
            if (audioStreamId.equals(row.id)) return row.label;
        }
        return "";
    }

    private void refreshStatsOverlay() {
        if (statsView == null || !statsVisible) return;
        int width = streamWidth;
        int height = streamHeight;
        int bitrate = streamBitrate;
        String videoCodec = streamVideoCodec == null ? "" : streamVideoCodec.trim();
        String audioCodec = streamAudioCodec == null ? "" : streamAudioCodec.trim();
        if (player != null) {
            VideoSize size = player.getVideoSize();
            if (size != null) {
                if (size.width > 0) width = size.width;
                if (size.height > 0) height = size.height;
            }
            try {
                Tracks tracks = player.getCurrentTracks();
                for (Tracks.Group group : tracks.getGroups()) {
                    if (group.getType() != C.TRACK_TYPE_VIDEO && group.getType() != C.TRACK_TYPE_AUDIO) continue;
                    for (int i = 0; i < group.length; i++) {
                        if (!group.isTrackSelected(i)) continue;
                        Format format = group.getTrackFormat(i);
                        if (group.getType() == C.TRACK_TYPE_VIDEO) {
                            if (format.width > 0) width = format.width;
                            if (format.height > 0) height = format.height;
                            if (format.bitrate > 0) bitrate = format.bitrate;
                            if (format.sampleMimeType != null && videoCodec.isEmpty()) {
                                videoCodec = format.sampleMimeType.replace("video/", "");
                            }
                            if (format.codecs != null && !format.codecs.isEmpty()) videoCodec = format.codecs;
                        } else if (audioCodec.isEmpty()) {
                            if (format.sampleMimeType != null) audioCodec = format.sampleMimeType.replace("audio/", "");
                            if (format.codecs != null && !format.codecs.isEmpty()) audioCodec = format.codecs;
                        }
                    }
                }
            } catch (Throwable ignored) {
                /* tracks not ready */
            }
        }
        StringBuilder lines = new StringBuilder();
        lines.append(playbackModeLabel());
        String dims = "";
        if (width > 0 && height > 0) dims = width + "×" + height;
        else if (streamResolution != null && !streamResolution.trim().isEmpty()) dims = streamResolution.trim();
        if (!dims.isEmpty()) lines.append('\n').append(dims);
        String rate = formatBitrateLabel(bitrate);
        if (!rate.isEmpty()) lines.append('\n').append(rate);
        String codecs = "";
        if (!videoCodec.isEmpty() && !audioCodec.isEmpty()) codecs = videoCodec + " / " + audioCodec;
        else if (!videoCodec.isEmpty()) codecs = videoCodec;
        else if (!audioCodec.isEmpty()) codecs = audioCodec;
        if (!codecs.isEmpty()) lines.append('\n').append(codecs);
        if (streamContainer != null && !streamContainer.trim().isEmpty()) {
            lines.append('\n').append(streamContainer.trim().toUpperCase(Locale.US));
        }
        String quality = currentQualityLabel();
        if (!quality.isEmpty()) lines.append('\n').append(quality);
        String audio = currentAudioLabel();
        if (!audio.isEmpty()) lines.append('\n').append(audio);
        statsView.setText(lines.toString());
        statsView.setTypeface(Typeface.MONOSPACE);
    }

    private void showTitleText() {
        if (logoView != null) {
            logoView.setVisibility(View.GONE);
            logoView.setImageDrawable(null);
        }
        if (titleView != null) titleView.setVisibility(View.VISIBLE);
    }

    private Bitmap downloadLogoBitmap(String url, Map<String, String> headers) {
        HttpURLConnection conn = null;
        try {
            URL parsed = new URL(url);
            conn = (HttpURLConnection) parsed.openConnection();
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(12_000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("GET");
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    if (entry.getKey() != null && entry.getValue() != null) {
                        conn.setRequestProperty(entry.getKey(), entry.getValue());
                    }
                }
            }
            if (conn.getRequestProperty("Accept") == null) {
                conn.setRequestProperty("Accept", "image/*,*/*;q=0.8");
            }
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            try (InputStream in = conn.getInputStream();
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    if (out.size() > 4_000_000) return null;
                }
                byte[] data = out.toByteArray();
                if (data.length < 32) return null;
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                return BitmapFactory.decodeByteArray(data, 0, data.length, opts);
            }
        } catch (Exception e) {
            Log.w(TAG, "Clear logo download failed", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private Map<String, String> headersForImageUrl(String url) {
        Map<String, String> headers = headersWithCookies(url, PlaybackUrls.parseHeaders(headersJson));
        try {
            URI video = new URI(currentUrl);
            URI image = new URI(url);
            String videoHost = video.getHost();
            String imageHost = image.getHost();
            if (videoHost != null && imageHost != null && videoHost.equalsIgnoreCase(imageHost)) {
                return headers;
            }
        } catch (Exception ignored) {
            /* fall through */
        }
        Map<String, String> slim = new HashMap<>();
        slim.put("User-Agent", USER_AGENT);
        slim.put("Accept", "image/*,*/*;q=0.8");
        return slim;
    }

    private static Bitmap trimTransparent(Bitmap src) {
        if (src == null || !src.hasAlpha()) return src;
        int width = src.getWidth();
        int height = src.getHeight();
        if (width <= 2 || height <= 2) return src;
        int[] pixels = new int[width * height];
        src.getPixels(pixels, 0, width, 0, 0, width, height);
        int left = width;
        int top = height;
        int right = -1;
        int bottom = -1;
        for (int y = 0; y < height; y++) {
            int row = y * width;
            for (int x = 0; x < width; x++) {
                int alpha = (pixels[row + x] >>> 24) & 0xFF;
                if (alpha <= 20) continue;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
        if (right < left || bottom < top) return src;
        int pad = 2;
        left = Math.max(0, left - pad);
        top = Math.max(0, top - pad);
        right = Math.min(width - 1, right + pad);
        bottom = Math.min(height - 1, bottom + pad);
        int cropW = right - left + 1;
        int cropH = bottom - top + 1;
        if (cropW >= width - 1 && cropH >= height - 1) return src;
        try {
            return Bitmap.createBitmap(src, left, top, cropW, cropH);
        } catch (Exception ignored) {
            return src;
        }
    }

    private void applyNightMode() {
        applyPlaybackVolume();
    }

    private void applyPlaybackVolume() {
        if (player == null) return;
        float volume = nightMode ? 0.55f : 1f;
        if (!nightMode && audioBoost > 100) {
            // Soft nudge on Direct Play; real boost is the transcode audioBoost query.
            volume = Math.min(1.35f, audioBoost / 100f);
        }
        player.setVolume(volume);
    }

    private static String normalizeSkipMode(@Nullable String raw, boolean legacyAuto) {
        String mode = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if ("off".equals(mode) || "manual".equals(mode) || "auto".equals(mode)) return mode;
        return legacyAuto ? "auto" : "manual";
    }

    private String skipModeLabel(String mode) {
        if ("off".equals(mode)) return getString(R.string.player_skip_off);
        if ("auto".equals(mode)) return getString(R.string.player_skip_auto);
        return getString(R.string.player_skip_manual);
    }

    private void emitSettings() {
        JSObject data = new JSObject();
        data.put("skipIntroMode", skipIntroMode);
        data.put("skipCreditsMode", skipCreditsMode);
        data.put("autoSkipIntro", "auto".equals(skipIntroMode));
        data.put("autoSkipCredits", "auto".equals(skipCreditsMode));
        data.put("rewindOnResumeSec", rewindOnResumeSec);
        data.put("audioBoost", audioBoost);
        data.put("burnSubtitles", burnSubtitles);
        data.put("subtitleDelayMs", subtitleDelayMs);
        data.put("subtitleAutoSync", subtitleAutoSync);
        data.put("audioPassthrough", audioPassthrough);
        data.put("cinemaTrailerCount", cinemaTrailerCount);
        data.put("cinemaTrailers", cinemaTrailerCount > 0);
        data.put("autoplayNext", autoplayNext);
        data.put("nightMode", nightMode);
        data.put("matchFrameRate", matchFrameRate);
        data.put("subtitleSize", subtitleSizePct);
        data.put("subtitleColor", subtitleColor);
        data.put("subtitleBackground", subtitleBackground);
        data.put("subtitlePosition", subtitlePosition);
        PlayerBridge.get().emit("settings", data);
    }

    private void rebuildStreamAfterSettings() {
        mainHandler.postDelayed(
            () -> requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex),
            60
        );
    }

    private boolean subtitlesCurrentlyBurned() {
        if (subtitleStreamId == null || subtitleStreamId.isEmpty()) return false;
        if (sidecarSubtitleUrl != null && !sidecarSubtitleUrl.isEmpty()) return false;
        OptionItem row = findSubtitleOption(subtitleStreamId);
        return subtitleCodecNeedsBurn(row == null ? null : row.codec);
    }

    private void applySubtitleLook(PlayerView playerView) {
        if (playerView == null) return;
        SubtitleView subtitleView = playerView.getSubtitleView();
        if (subtitleView == null) return;
        int fg;
        try {
            fg = Color.parseColor(subtitleColor);
        } catch (Exception ignored) {
            fg = Color.WHITE;
        }
        int windowColor = Color.TRANSPARENT;
        if ("dim".equals(subtitleBackground)) windowColor = Color.argb(110, 0, 0, 0);
        else if ("solid".equals(subtitleBackground)) windowColor = Color.argb(220, 0, 0, 0);
        CaptionStyleCompat style = new CaptionStyleCompat(
            fg,
            Color.TRANSPARENT,
            windowColor,
            CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW,
            Color.BLACK,
            // System sans-serif (Roboto) at regular weight, like Plex's player. Bold read
            // heavier than people were used to. ASS/SSA styling and <b> tags still apply.
            Typeface.create("sans-serif", Typeface.NORMAL)
        );
        subtitleView.setStyle(style);
        subtitleView.setFractionalTextSize(0.0533f * (Math.max(50, Math.min(200, subtitleSizePct)) / 100f));
        if ("top".equals(subtitlePosition)) {
            subtitleView.setBottomPaddingFraction(0.72f);
        } else if ("middle".equals(subtitlePosition)) {
            subtitleView.setBottomPaddingFraction(0.42f);
        } else {
            subtitleView.setBottomPaddingFraction(0.08f);
        }
    }

    private void applyFrameRate(PlayerView playerView) {
        if (playerView == null) return;
        boolean match = matchFrameRate && videoFrameRate > 0;
        if (Build.VERSION.SDK_INT < 31) {
            // Android 6–11 (most Fire TV sticks run Fire OS 7 = Android 9): ask the
            // window for a display mode instead. Surface.setFrameRate is 11+ only.
            if (Build.VERSION.SDK_INT >= 23) applyDisplayModeForFrameRate(match ? videoFrameRate : 0f);
            return;
        }
        View surfaceView = playerView.getVideoSurfaceView();
        if (!(surfaceView instanceof SurfaceView)) return;
        Surface surface = ((SurfaceView) surfaceView).getHolder().getSurface();
        if (surface == null || !surface.isValid()) return;
        try {
            if (match) {
                // The 2-arg call only switches when seamless, and 60→24Hz never is on a
                // TV — films kept juddering. ALWAYS allows the HDMI mode change.
                surface.setFrameRate(videoFrameRate, Surface.FRAME_RATE_COMPATIBILITY_FIXED_SOURCE,
                    Surface.CHANGE_FRAME_RATE_ALWAYS);
            } else {
                surface.setFrameRate(0f, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT,
                    Surface.CHANGE_FRAME_RATE_ONLY_IF_SEAMLESS);
            }
        } catch (Throwable ignored) {
            /* older devices */
        }
    }

    /** Pick a mode at the current resolution whose refresh is a whole multiple of fps. 0 = system default. */
    private void applyDisplayModeForFrameRate(float fps) {
        if (Build.VERSION.SDK_INT < 23) return;
        try {
            Window window = getWindow();
            Display display = getWindowManager().getDefaultDisplay();
            if (window == null || display == null) return;
            int wanted = 0;
            if (fps > 0) {
                wanted = DisplayModeMatcher.pickModeId(
                    fps,
                    DisplayModeMatcher.Mode.of(display.getMode()),
                    DisplayModeMatcher.of(display.getSupportedModes())
                );
            }
            WindowManager.LayoutParams params = window.getAttributes();
            if (params.preferredDisplayModeId == wanted) return;
            params.preferredDisplayModeId = wanted;
            window.setAttributes(params);
        } catch (Throwable ignored) {
            /* display mode switching is best-effort */
        }
    }

    /** Playback is held by a short audio focus loss (Assistant, notification), not stuck. */
    private boolean focusSuppressed() {
        return player != null
            && player.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS;
    }

    private interface OptionPick {
        void onPick(int index);
    }

    private boolean isOptionDialogShowing() {
        return menuScrim != null && menuScrim.getVisibility() == View.VISIBLE;
    }

    private void setChromeSubtreeFocusable(boolean focusable) {
        View[] bars = { chrome, topBar, findViewById(R.id.player_top_end), skipRow };
        for (View bar : bars) {
            if (!(bar instanceof ViewGroup)) continue;
            ((ViewGroup) bar).setDescendantFocusability(
                focusable ? ViewGroup.FOCUS_AFTER_DESCENDANTS : ViewGroup.FOCUS_BLOCK_DESCENDANTS
            );
        }
    }

    private boolean focusSkipChipIfVisible() {
        if (skipIntroChipActive && skipIntroBtn != null && skipIntroBtn.getVisibility() == View.VISIBLE) {
            return skipIntroBtn.requestFocus();
        }
        if (skipCreditsChipActive && skipCreditsBtn != null && skipCreditsBtn.getVisibility() == View.VISIBLE) {
            return skipCreditsBtn.requestFocus();
        }
        return false;
    }

    private void hideOptionSheet() {
        menuNav.reset();
        View focused = getCurrentFocus();
        if (focused != null && isDescendantOf(focused, menuScrim)) {
            focused.clearFocus();
        }
        if (menuList != null) menuList.removeAllViews();
        if (menuScrim != null) {
            menuScrim.setVisibility(View.GONE);
            menuScrim.clearFocus();
        }
        setChromeSubtreeFocusable(true);
        if (!finishing && !isFinishing() && !isDestroyed()) {
            bumpChrome();
            restoreChromeFocusAfterMenu();
        }
    }

    private static boolean isDescendantOf(@Nullable View child, @Nullable View ancestor) {
        return PlayerMenuRows.isDescendantOf(child, ancestor);
    }

    private void restoreChromeFocusAfterMenu() {
        final View target = settingsBtn != null && settingsBtn.getVisibility() == View.VISIBLE
            ? settingsBtn
            : playPauseBtn;
        if (target == null) return;
        // Menu rows are removed before this runs; wait a frame so Leanback can
        // attach focus to chrome controls again.
        target.post(() -> {
            if (finishing || isFinishing() || isDestroyed() || isOptionDialogShowing()) return;
            setChromeSubtreeFocusable(true);
            if (!target.requestFocus() && playPauseBtn != null && playPauseBtn != target) {
                playPauseBtn.requestFocus();
            }
        });
    }

    private void popMenuOrClose() {
        String top = menuNav.pop();
        if (top == null) {
            hideOptionSheet();
            return;
        }
        if ("settings".equals(top)) {
            showSettingsRoot();
        } else if ("playback".equals(top)) {
            showPlaybackOptionsMenu();
        } else if ("subtitle".equals(top)) {
            showSubtitlesRoot();
        } else if ("subAppear".equals(top)) {
            showSubtitleAppearanceMenu();
        } else if ("subSync".equals(top)) {
            showSubtitleSyncMenu();
        } else {
            hideOptionSheet();
        }
    }

    private void showSettingsRoot() {
        // Keep focus/scroll when rebuilding after an in-place toggle (not a fresh open).
        final boolean retainPosition = isOptionDialogShowing()
            && menuNav.topIs(PlayerMenuNav.SETTINGS);
        final String retainFocusLabel = retainPosition ? currentMenuFocusLabel() : null;
        final int retainScrollY = retainPosition && menuScroll != null ? menuScroll.getScrollY() : 0;

        bumpChrome();
        menuNav.openSettingsRoot();
        if (menuScrim == null || menuList == null) return;
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(R.string.player_settings);
        menuList.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);

        addSettingsRow(inflater, getString(R.string.player_quality), currentQualityLabel(),
            qualities.size() > 1 || !currentQualityLabel().isEmpty(),
            () -> {
                menuNav.push("quality");
                showOptionMenu(R.string.player_quality, "quality", qualities, qualityId);
            });
        String subId = subtitleStreamId == null ? "" : subtitleStreamId;
        String subLabel = subId.isEmpty() ? getString(R.string.player_subs_off) : labelFor(subtitles, subId);
        addSettingsRow(inflater, getString(R.string.player_subs), subLabel, !musicMode, () -> {
            menuNav.push("subtitle");
            showSubtitlesRoot();
        });
        addSettingsRow(inflater, getString(R.string.player_audio),
            labelFor(audioTracks, audioStreamId == null ? "" : audioStreamId),
            audioTracks.size() > 0,
            () -> {
                menuNav.push("audio");
                showOptionMenu(R.string.player_audio, "audio", audioTracks, audioStreamId == null ? "" : audioStreamId);
            });
        if (!musicMode && versions.size() > 1) {
            addSettingsRow(inflater, getString(R.string.player_version),
                labelFor(versions, String.valueOf(mediaIndex)), true, () -> {
                    menuNav.push("version");
                    showOptionMenu(R.string.player_version, "version", versions, String.valueOf(mediaIndex));
                });
        }

        addSettingsRow(inflater, getString(R.string.player_speed),
            String.format(Locale.US, "%.2g×", playbackSpeed), true, () -> {
                menuNav.push("speed");
                showSpeedMenu();
            });
        if (!musicMode) {
            String zoomLabel = videoFill
                ? getString(R.string.player_zoom_fill)
                : (Math.abs(videoZoom - 1f) < 0.01f
                    ? getString(R.string.player_zoom_fit)
                    : String.format(Locale.US, "%.2g×", videoZoom));
            addSettingsRow(inflater, getString(R.string.player_zoom), zoomLabel, true, () -> {
                menuNav.push("zoom");
                showZoomMenu();
            });
            addSettingsRow(inflater, getString(R.string.player_delay),
                audioDelayMs <= 0 ? getString(R.string.player_delay_off) : audioDelayMs + " ms",
                true, () -> {
                    menuNav.push("delay");
                    showDelayMenu();
                });
            addSettingsRow(inflater, getString(R.string.player_audio_boost),
                audioBoost + "%", true, () -> {
                    menuNav.push("boost");
                    showAudioBoostMenu();
                });
            addSettingsRow(inflater, getString(R.string.player_night_mode),
                nightMode ? getString(R.string.player_on) : getString(R.string.player_off),
                true, () -> {
                    nightMode = !nightMode;
                    applyNightMode();
                    emitSettings();
                    showSettingsRoot();
                });
            addSettingsRow(inflater, getString(R.string.player_audio_passthrough),
                audioPassthrough ? getString(R.string.player_on) : getString(R.string.player_off),
                true, () -> {
                    audioPassthrough = !audioPassthrough;
                    emitSettings();
                    rebuildStreamAfterSettings();
                    showSettingsRoot();
                });
            addSettingsRow(inflater, getString(R.string.player_match_frame_rate),
                matchFrameRate ? getString(R.string.player_on) : getString(R.string.player_off),
                true, () -> {
                    matchFrameRate = !matchFrameRate;
                    PlayerView view = findViewById(R.id.player_view);
                    if (view != null) applyFrameRate(view);
                    emitSettings();
                    showSettingsRoot();
                });
            addSettingsRow(inflater, getString(R.string.player_skip_intro_mode),
                skipModeLabel(skipIntroMode), true, () -> {
                    menuNav.push("skipIntro");
                    showSkipModeMenu(true);
                });
            addSettingsRow(inflater, getString(R.string.player_skip_credits_mode),
                skipModeLabel(skipCreditsMode), true, () -> {
                    menuNav.push("skipCredits");
                    showSkipModeMenu(false);
                });
            String rewindLabel = rewindOnResumeSec <= 0
                ? getString(R.string.player_rewind_off)
                : rewindOnResumeSec + "s";
            addSettingsRow(inflater, getString(R.string.player_rewind_resume), rewindLabel, true, () -> {
                menuNav.push("rewind");
                showRewindOnResumeMenu();
            });
            addSettingsRow(inflater, getString(R.string.player_autoplay_next),
                autoplayNext ? getString(R.string.player_on) : getString(R.string.player_off),
                true, () -> {
                    autoplayNext = !autoplayNext;
                    emitSettings();
                    showSettingsRoot();
                });
            addSettingsRow(inflater, getString(R.string.player_cinema_trailers),
                cinemaTrailerCount <= 0 ? getString(R.string.player_off) : String.valueOf(cinemaTrailerCount),
                true, () -> {
                    menuNav.push("cinema");
                    showCinemaTrailersMenu();
                });
        }
        int repeatRes = repeatMode == Player.REPEAT_MODE_ONE ? R.string.player_repeat_one
            : repeatMode == Player.REPEAT_MODE_ALL ? R.string.player_repeat_all
            : R.string.player_repeat_off;
        addSettingsRow(inflater, getString(R.string.player_repeat), getString(repeatRes), true, () -> {
            menuNav.push("repeat");
            showRepeatMenu();
        });
        addSettingsRow(inflater, getString(R.string.player_sleep), currentSleepLabel(), true, () -> {
            menuNav.push("sleep");
            showSleepMenu();
        });
        if (!chapters.isEmpty()) {
            addSettingsRow(inflater, getString(R.string.player_chapters),
                String.valueOf(chapters.size()), true, () -> {
                    menuNav.push("chapters");
                    showChaptersMenu();
                });
        }
        if (!musicMode) {
            addSettingsRow(inflater, getString(R.string.player_media_info),
                statsVisible ? getString(R.string.player_on) : getString(R.string.player_off),
                true, () -> {
                    toggleStatsOverlay();
                    showSettingsRoot();
                });
        }
        if (!isTelevision()) {
            addSettingsRow(inflater, getString(R.string.player_external), "", true, () -> {
                hideOptionSheet();
                openExternalPlayer();
            });
        }
        if (pipBtn != null && pipBtn.getVisibility() == View.VISIBLE) {
            addSettingsRow(inflater, getString(R.string.player_pip), "", true, () -> {
                hideOptionSheet();
                enterPip();
            });
        }

        menuScrim.setVisibility(View.VISIBLE);
        if (retainFocusLabel != null && !retainFocusLabel.isEmpty()) {
            focusMenuRow(retainFocusLabel, retainScrollY);
        } else {
            focusFirstMenuRow();
        }
    }

    /** Back-stack alias — settings are flat on the root list now. */
    private void showPlaybackOptionsMenu() {
        showSettingsRoot();
    }

    @Nullable
    private String currentMenuFocusLabel() {
        return PlayerMenuRows.focusedRowLabel(menuList, getCurrentFocus());
    }

    private void focusMenuRow(@Nullable String label, int fallbackScrollY) {
        PlayerMenuRows.focusRow(menuList, menuScroll, label, fallbackScrollY);
    }

    private String currentSleepLabel() {
        if (sleepUntilElapsedRealtime > 0) {
            long left = sleepUntilElapsedRealtime - SystemClock.elapsedRealtime();
            if (left > 40 * 60_000L) return getString(R.string.player_sleep_45);
            if (left > 25 * 60_000L) return getString(R.string.player_sleep_30);
            if (left > 10 * 60_000L) return getString(R.string.player_sleep_15);
        }
        if (sleepEndOfEpisode) return getString(R.string.player_sleep_end);
        if (sleepEpisodeLimit && sleepEpisodesRemaining == 1) return getString(R.string.player_sleep_after_1);
        if (sleepEpisodeLimit && sleepEpisodesRemaining >= 2) return getString(R.string.player_sleep_after_2);
        if (sleepAtCredits) return getString(R.string.player_sleep_credits);
        return getString(R.string.player_sleep_off);
    }

    private void addSettingsRow(LayoutInflater inflater, String label, String value, boolean enabled, Runnable onClick) {
        addSettingsRow(inflater, label, value, enabled, /* selectable= */ enabled, onClick);
    }

    private void addSettingsRow(
        LayoutInflater inflater,
        String label,
        String value,
        boolean visible,
        boolean selectable,
        Runnable onClick
    ) {
        PlayerMenuRows.addSettingsRow(menuList, inflater, label, value, visible, selectable, onClick);
    }

    private void focusFirstMenuRow() {
        PlayerMenuRows.focusFirstRow(menuList, menuScroll);
    }

    private void afterMenuLeafPick(PlayerMenuNav.Return menuReturn) {
        updateChipLabels();
        if (menuReturn == PlayerMenuNav.Return.PLAYBACK) {
            showSettingsRoot();
            return;
        }
        if (menuReturn == PlayerMenuNav.Return.SUBTITLES) {
            menuNav.trimToSubtitles();
            showSubtitlesRoot();
            return;
        }
        if (menuReturn == PlayerMenuNav.Return.SETTINGS_ROOT || (menuNav.settingsTreeActive() && menuReturn == PlayerMenuNav.Return.CLOSE)) {
            showSettingsRoot();
            return;
        }
        hideOptionSheet();
    }

    private PlayerMenuNav.Return leafReturnTarget() {
        return menuNav.leafReturnTarget();
    }

    private void showOptionSheet(CharSequence title, String[] labels, int checkedIndex, OptionPick onPick) {
        showOptionSheet(title, labels, checkedIndex, onPick, leafReturnTarget());
    }

    private void showOptionSheet(CharSequence title, String[] labels, int checkedIndex, OptionPick onPick, PlayerMenuNav.Return menuReturn) {
        if (menuScrim == null || menuList == null || labels == null || labels.length == 0) {
            toast(getString(R.string.player_no_options));
            return;
        }
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(title);
        menuList.removeAllViews();
        int focusIndex = Math.max(0, Math.min(checkedIndex, labels.length - 1));
        LayoutInflater inflater = LayoutInflater.from(this);
        Button focusRow = null;
        for (int i = 0; i < labels.length; i++) {
            Button row = (Button) inflater.inflate(R.layout.player_menu_row, menuList, false);
            boolean selected = i == focusIndex;
            String label = labels[i] == null ? "" : labels[i].trim();
            row.setText(selected ? "✓  " + label : label);
            row.setSelected(selected);
            if (Build.VERSION.SDK_INT >= 26) row.setDefaultFocusHighlightEnabled(false);
            final int index = i;
            row.setOnClickListener(v -> {
                if (onPick != null) onPick.onPick(index);
                if (subtitleSearchPending || !isOptionDialogShowing()) {
                    if (subtitleSearchPending) hideOptionSheet();
                    return;
                }
                afterMenuLeafPick(menuReturn);
            });
            menuList.addView(row);
            if (selected) focusRow = row;
        }
        menuScrim.setVisibility(View.VISIBLE);
        final Button toFocus = focusRow != null ? focusRow : (Button) menuList.getChildAt(0);
        if (toFocus != null) {
            toFocus.post(() -> {
                if (menuScroll != null) {
                    menuScroll.scrollTo(0, Math.max(0, toFocus.getTop() - 24));
                }
                toFocus.requestFocus();
            });
        }
    }

    private void showChaptersMenu() {
        if (chapters.isEmpty()) {
            toast(getString(R.string.player_no_options));
            menuNav.dropEmptyLeaf();
            return;
        }
        String[] labels = new String[chapters.size()];
        for (int i = 0; i < chapters.size(); i++) {
            labels[i] = chapters.get(i).label;
        }
        showOptionSheet(getString(R.string.player_chapters), labels, 0, which -> {
            try {
                long startMs = Long.parseLong(chapters.get(which).id);
                seekToContent(startMs, true);
            } catch (Exception ignored) {
                /* ignore */
            }
        });
    }

    private void skipChapter(int direction) {
        if (chapters.isEmpty()) return;
        long pos = contentPositionMs();
        long target = -1;
        if (direction > 0) {
            for (OptionItem chapter : chapters) {
                try {
                    long startMs = Long.parseLong(chapter.id);
                    if (startMs > pos + 1200) {
                        target = startMs;
                        break;
                    }
                } catch (Exception ignored) {
                    /* skip */
                }
            }
        } else {
            for (int i = chapters.size() - 1; i >= 0; i--) {
                try {
                    long startMs = Long.parseLong(chapters.get(i).id);
                    if (startMs < pos - 1200) {
                        target = startMs;
                        break;
                    }
                } catch (Exception ignored) {
                    /* skip */
                }
            }
            if (target < 0) target = 0;
        }
        if (target >= 0) seekToContent(target, true);
        bumpChrome();
    }

    private void showSeekPreview(long positionMs) {
        if (seekPreview == null) return;
        if (previewThumbTemplate == null || previewThumbTemplate.isEmpty()) {
            seekPreview.setVisibility(View.GONE);
            return;
        }
        seekPreview.setVisibility(View.VISIBLE);
        final int gen = ++previewGeneration;
        final String url = previewThumbTemplate.replace("__OFFSET__", String.valueOf(Math.max(0, positionMs)));
        logoExecutor.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(2500);
                conn.setReadTimeout(2500);
                conn.setInstanceFollowRedirects(true);
                InputStream in = conn.getInputStream();
                bitmap = BitmapFactory.decodeStream(in);
                in.close();
            } catch (Exception ignored) {
                /* ignore */
            } finally {
                if (conn != null) conn.disconnect();
            }
            final Bitmap ready = bitmap;
            mainHandler.post(() -> {
                if (gen != previewGeneration || seekPreview == null) {
                    if (ready != null) ready.recycle();
                    return;
                }
                if (ready != null) seekPreview.setImageBitmap(ready);
            });
        });
    }

    private void hideSeekPreview() {
        previewGeneration += 1;
        if (seekPreview != null) seekPreview.setVisibility(View.GONE);
    }

    private void updateActionVisibility() {
        boolean tv = isTelevision();
        setVisible(qualityBtn, !musicMode && qualities.size() > 1);
        setVisible(audioBtn, audioTracks.size() > 1);
        setVisible(subsBtn, !musicMode);
        setVisible(versionBtn, !musicMode && versions.size() > 1);
        setVisible(speedBtn, true);
        setVisible(zoomBtn, !musicMode);
        setVisible(delayBtn, !musicMode);
        setVisible(repeatBtn, true);
        setVisible(sleepBtn, true);
        setVisible(externalBtn, !tv);
        setVisible(chaptersBtn, !chapters.isEmpty());
        updatePipVisibility();
    }

    private void setVisible(@Nullable View view, boolean visible) {
        if (view != null) {
            view.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private void updateChipLabels() {
        setChipLabel(qualityBtn, R.string.player_quality, labelFor(qualities, qualityId));
        setChipLabel(audioBtn, R.string.player_audio, labelFor(audioTracks, audioStreamId));
        String subId = subtitleStreamId == null ? "" : subtitleStreamId;
        String subLabel = subId.isEmpty() ? getString(R.string.player_subs_off) : labelFor(subtitles, subId);
        setChipLabel(subsBtn, R.string.player_subs, subLabel);
        setChipLabel(versionBtn, R.string.player_version, labelFor(versions, String.valueOf(mediaIndex)));
        if (speedBtn != null) {
            speedBtn.setText(getString(R.string.player_speed) + " · "
                + String.format(Locale.US, "%.2g×", playbackSpeed));
        }
        if (zoomBtn != null) {
            String zoomLabel = videoFill
                ? getString(R.string.player_zoom_fill)
                : (Math.abs(videoZoom - 1f) < 0.01f
                    ? getString(R.string.player_zoom_fit)
                    : String.format(Locale.US, "%.2g×", videoZoom));
            setChipLabel(zoomBtn, R.string.player_zoom, zoomLabel);
        }
        if (delayBtn != null) {
            setChipLabel(delayBtn, R.string.player_delay, audioDelayMs <= 0
                ? getString(R.string.player_delay_off)
                : audioDelayMs + " ms");
        }
        if (repeatBtn != null) {
            int repeatRes = repeatMode == Player.REPEAT_MODE_ONE ? R.string.player_repeat_one
                : repeatMode == Player.REPEAT_MODE_ALL ? R.string.player_repeat_all
                : R.string.player_repeat_off;
            setChipLabel(repeatBtn, R.string.player_repeat, getString(repeatRes));
        }
        updateModeChip();
    }

    private static String labelFor(List<OptionItem> items, String id) {
        if (id == null) return "";
        for (OptionItem item : items) {
            if (item.id.equals(id)) return item.label;
        }
        return "";
    }

    private void setChipLabel(@Nullable Button button, int titleRes, @Nullable String detail) {
        if (button == null) return;
        String base = getString(titleRes);
        if (detail != null && !detail.isEmpty()) {
            String shortDetail = detail.length() > 28 ? detail.substring(0, 25) + "…" : detail;
            button.setText(base + " · " + shortDetail);
        } else {
            button.setText(base);
        }
    }

    private List<OptionItem> parseOptions(@Nullable JSONArray arr) {
        List<OptionItem> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject row = arr.optJSONObject(i);
            if (row == null) continue;
            String id = row.optString("id", "");
            String label = row.optString("label", id);
            if (id.isEmpty() && row.has("mediaIndex")) {
                id = String.valueOf(row.optInt("mediaIndex", i));
            }
            if (!label.isEmpty()) {
                String language = row.optString("languageTag", "");
                if (language.isEmpty()) language = row.optString("language", "");
                String codec = row.optString("codec", "");
                OptionItem item = new OptionItem(id, label, row.optString("url", ""), language, codec);
                item.embeddedOrdinal = row.optInt("embeddedOrdinal", -1);
                item.downloadKey = row.optString("downloadKey", "");
                out.add(item);
            }
        }
        return out;
    }

    void applyUpdateSrc(String url, @Nullable String nextHeadersJson, long offsetMs) {
        applyUpdateSrc(url, nextHeadersJson, offsetMs, true);
    }

    void applyUpdateSrc(String url, @Nullable String nextHeadersJson, long offsetMs, boolean resetFallbackLadder) {
        if (player == null || url == null || url.trim().isEmpty()) return;
        errorGeneration++;
        final String previousUrl = currentUrl;
        currentUrl = url.trim();
        absorbTimelineFromUrl(currentUrl);
        // A new stream: the badge re-reads what it is (Direct Play / Direct Stream / Transcoding …).
        updateModeChip();
        if (nextHeadersJson != null && !nextHeadersJson.isEmpty()) {
            headersJson = nextHeadersJson;
        }
        if (httpFactory != null) {
            httpFactory.setDefaultRequestProperties(headersWithCookies(currentUrl, PlaybackUrls.parseHeaders(headersJson)));
        }
        pendingSeekMs = 0;
        scrubTargetMs = -1;
        seekingUi = false;
        // Intentional JS rebuild resets the ladder; native DP→HLS→1080 must keep its stage.
        if (resetFallbackLadder) streamFallbackStage = 0;
        streamSwapInFlight = false;
        mainHandler.removeCallbacks(clearSwapRunnable);
        skippedIntro = false;
        skippedCredits = false;
        clearSkipChips();
        playbackEnded = false;
        playbackError = false;
        hideError();
        // Keep burn overlay up until STATE_READY so the user still sees Cancel while PMS spins.
        clearSubtitleCues();
        applyAudioTrackPreference();
        applyTextTrackPreference();
        // HLS↔Direct Play needs a hard media reset — setMediaItem alone can leave Exo
        // buffering on the old HLS pipeline after Original is selected again.
        final boolean crossDelivery = (previousUrl != null && !previousUrl.isEmpty())
            && (PlaybackUrls.isTranscodeUrl(previousUrl) != PlaybackUrls.isTranscodeUrl(currentUrl));
        // stop() only when something is loaded — idle+stop left some TVs unable to play().
        if (player.getPlaybackState() != Player.STATE_IDLE || player.getMediaItemCount() > 0) {
            try {
                player.stop();
            } catch (Throwable ignored) {
                /* Media3 stop is best-effort before replacing the item. */
            }
        }
        if (crossDelivery) {
            try {
                player.clearMediaItems();
            } catch (Throwable ignored) {
                /* best-effort before queueStartPosition */
            }
        }
        queueStartPosition(currentUrl, offsetMs);
        player.setPlayWhenReady(!userPaused);
        player.prepare();
        if (!userPaused && offsetMs >= 5000) {
            mainHandler.removeCallbacks(resumePlayKickRunnable);
            resumeKickArmPosMs = offsetMs;
            mainHandler.postDelayed(resumePlayKickRunnable, 2500);
        }
        // Re-apply after prepare so Exo picks the intended audio/text tracks.
        applyAudioTrackPreference();
        applyTextTrackPreference();
        if (!minimized) bumpChrome();
        // Seek pressed during the swap — fire one coalesced restart, not a stack of sessions.
        if (pendingTranscodeSeekMs >= 0 && shouldRestartForSeek()) {
            mainHandler.removeCallbacks(transcodeSeekRunnable);
            mainHandler.postDelayed(transcodeSeekRunnable, 120);
        }
    }

    void applySeek(long positionMs) {
        seekToContent(positionMs, true);
    }

    void applySpeed(float speed) {
        playbackSpeed = Math.max(0.25f, Math.min(2f, speed));
        if (player != null) {
            player.setPlaybackParameters(new PlaybackParameters(playbackSpeed));
        }
        if (speedLabel != null) {
            speedLabel.setText(String.format(Locale.US, "%.2g×", playbackSpeed));
        }
        updateChipLabels();
    }

    private void showOptionMenu(int titleRes, String kind, List<OptionItem> items, String selectedId) {
        bumpChrome();
        if (items.isEmpty()) {
            toast(getString(R.string.player_no_options));
            menuNav.dropEmptyLeaf();
            return;
        }
        String currentLabel = labelFor(items, selectedId);
        if (currentLabel == null || currentLabel.isEmpty()) {
            if ("subtitle".equals(kind) && (selectedId == null || selectedId.isEmpty())) {
                currentLabel = getString(R.string.player_subs_off);
            }
        }
        String[] labels = new String[items.size()];
        int checked = 0;
        for (int i = 0; i < items.size(); i++) {
            OptionItem item = items.get(i);
            boolean selected = item.id.equals(selectedId == null ? "" : selectedId);
            labels[i] = selected ? ("✓  " + item.label) : ("    " + item.label);
            labels[i] = item.label;
            if (item.id.equals(selectedId == null ? "" : selectedId)) checked = i;
        }
        CharSequence title = currentLabel == null || currentLabel.isEmpty()
            ? getString(titleRes)
            : getString(titleRes) + "  ·  " + currentLabel;
        showOptionSheet(title, labels, checked, which -> {
            OptionItem picked = items.get(which);
            if ("version".equals(kind)) {
                try {
                    mediaIndex = Integer.parseInt(picked.id);
                } catch (Exception ignored) {
                    mediaIndex = which;
                }
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("quality".equals(kind)) {
                qualityId = picked.id;
                saveAvPrefs();
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("audio".equals(kind)) {
                audioStreamId = picked.id;
                saveAvPrefs();
                requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
            } else if ("subtitle".equals(kind)) {
                if (SUBTITLE_SEARCH_ID.equals(picked.id)) {
                    requestSubtitleSearch();
                    return;
                }
                applySubtitleChoice(picked);
            }
            updateChipLabels();
        });
    }

    private void showSpeedMenu() {
        bumpChrome();
        final float[] speeds = {0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f};
        String[] labels = new String[speeds.length];
        int checked = 2;
        for (int i = 0; i < speeds.length; i++) {
            labels[i] = String.format(Locale.US, "%.2gx", speeds[i]);
            if (Math.abs(speeds[i] - playbackSpeed) < 0.01f) checked = i;
        }
        showOptionSheet(getString(R.string.player_speed), labels, checked, which -> {
            applySpeed(speeds[which]);
            updateChipLabels();
            JSObject data = new JSObject();
            data.put("speed", playbackSpeed);
            PlayerBridge.get().emit("speed", data);
        });
    }

    private void showSubtitlesRoot() {
        bumpChrome();
        menuNav.openSubtitlesRoot();
        if (menuScrim == null || menuList == null) return;
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(R.string.player_subs);
        menuList.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        String subId = subtitleStreamId == null ? "" : subtitleStreamId;
        String subLabel = subId.isEmpty() ? getString(R.string.player_subs_off) : labelFor(subtitles, subId);
        addSettingsRow(inflater, getString(R.string.player_subs_tracks), subLabel, true, () -> {
            menuNav.push("subTracks");
            showSubtitleMenu();
        });
        addSettingsRow(inflater, getString(R.string.player_subs_appearance), "", true, () -> {
            menuNav.push("subAppear");
            showSubtitleAppearanceMenu();
        });
        String delayLabel = subtitlesCurrentlyBurned()
            ? getString(R.string.player_subs_delay_burned)
            : (subtitleDelayMs == 0 ? getString(R.string.player_delay_off) : subtitleDelayMs + " ms");
        addSettingsRow(inflater, getString(R.string.player_subs_sync), delayLabel, true, () -> {
            menuNav.push("subSync");
            showSubtitleSyncMenu();
        });
        String burnLabel = "always".equals(burnSubtitles)
            ? getString(R.string.player_burn_always)
            : ("image".equals(burnSubtitles)
                ? getString(R.string.player_burn_image)
                : getString(R.string.player_burn_auto));
        addSettingsRow(inflater, getString(R.string.player_subs_burn), burnLabel, true, () -> {
            menuNav.push("subBurn");
            showBurnSubtitlesMenu();
        });
        menuScrim.setVisibility(View.VISIBLE);
        focusFirstMenuRow();
    }

    private void showSubtitleMenu() {
        List<OptionItem> withOff = new ArrayList<>();
        withOff.add(new OptionItem("", getString(R.string.player_subs_off)));
        withOff.add(new OptionItem(SUBTITLE_SEARCH_ID, getString(R.string.player_subs_search)));
        withOff.addAll(subtitles);
        showOptionMenu(R.string.player_subs, "subtitle", withOff, subtitleStreamId == null ? "" : subtitleStreamId);
    }

    private void showSubtitleAppearanceMenu() {
        bumpChrome();
        if (menuScrim == null || menuList == null) return;
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(R.string.player_subs_appearance);
        menuList.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        addSettingsRow(inflater, getString(R.string.player_subs_size), subtitleSizePct + "%", true, () -> {
            menuNav.push("subSize");
            showSubtitleSizeMenu();
        });
        addSettingsRow(inflater, getString(R.string.player_subs_color), subtitleColor, true, () -> {
            menuNav.push("subColor");
            showSubtitleColorMenu();
        });
        String bg = "dim".equals(subtitleBackground)
            ? getString(R.string.player_bg_dim)
            : ("solid".equals(subtitleBackground)
                ? getString(R.string.player_bg_solid)
                : getString(R.string.player_bg_none));
        addSettingsRow(inflater, getString(R.string.player_subs_background), bg, true, () -> {
            menuNav.push("subBg");
            showSubtitleBackgroundMenu();
        });
        String pos = "top".equals(subtitlePosition)
            ? getString(R.string.player_pos_top)
            : ("middle".equals(subtitlePosition)
                ? getString(R.string.player_pos_middle)
                : getString(R.string.player_pos_bottom));
        addSettingsRow(inflater, getString(R.string.player_subs_position), pos, true, () -> {
            menuNav.push("subPos");
            showSubtitlePositionMenu();
        });
        menuScrim.setVisibility(View.VISIBLE);
        focusFirstMenuRow();
    }

    private void showSubtitleSizeMenu() {
        // Keep in sync with PLAYER_SUBTITLE_SIZES (client/media-player/playerSettings.ts).
        final int[] sizes = {50, 60, 75, 100, 125, 150, 200};
        String[] labels = new String[sizes.length];
        int checked = 3;
        for (int i = 0; i < sizes.length; i++) {
            labels[i] = sizes[i] + "%";
            if (sizes[i] == subtitleSizePct) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_size), labels, checked, which -> {
            subtitleSizePct = sizes[which];
            PlayerView view = findViewById(R.id.player_view);
            if (view != null) applySubtitleLook(view);
            emitSettings();
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showSubtitleColorMenu() {
        final String[] colors = {"#ffffff", "#ffff00", "#00ffff", "#00ff00", "#ff9f1a", "#ff4d6d"};
        String[] labels = {"White", "Yellow", "Cyan", "Green", "Orange", "Pink"};
        int checked = 0;
        for (int i = 0; i < colors.length; i++) {
            if (colors[i].equalsIgnoreCase(subtitleColor)) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_color), labels, checked, which -> {
            subtitleColor = colors[which];
            PlayerView view = findViewById(R.id.player_view);
            if (view != null) applySubtitleLook(view);
            emitSettings();
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showSubtitleBackgroundMenu() {
        final String[] values = {"none", "dim", "solid"};
        String[] labels = {
            getString(R.string.player_bg_none),
            getString(R.string.player_bg_dim),
            getString(R.string.player_bg_solid),
        };
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            if (values[i].equals(subtitleBackground)) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_background), labels, checked, which -> {
            subtitleBackground = values[which];
            PlayerView view = findViewById(R.id.player_view);
            if (view != null) applySubtitleLook(view);
            emitSettings();
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showSubtitlePositionMenu() {
        final String[] values = {"bottom", "middle", "top"};
        String[] labels = {
            getString(R.string.player_pos_bottom),
            getString(R.string.player_pos_middle),
            getString(R.string.player_pos_top),
        };
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            if (values[i].equals(subtitlePosition)) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_position), labels, checked, which -> {
            subtitlePosition = values[which];
            PlayerView view = findViewById(R.id.player_view);
            if (view != null) applySubtitleLook(view);
            emitSettings();
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showSubtitleSyncMenu() {
        final boolean retainPosition = isOptionDialogShowing()
            && menuNav.topIs("subSync");
        final String retainFocusLabel = retainPosition ? currentMenuFocusLabel() : null;
        final int retainScrollY = retainPosition && menuScroll != null ? menuScroll.getScrollY() : 0;

        bumpChrome();
        if (menuScrim == null || menuList == null) return;
        mainHandler.removeCallbacks(hideChromeRunnable);
        setChromeVisible(true);
        setChromeSubtreeFocusable(false);
        menuTitle.setText(R.string.player_subs_sync);
        menuList.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        boolean burned = subtitlesCurrentlyBurned();
        if (burned) {
            addSettingsRow(inflater, getString(R.string.player_subs_delay),
                getString(R.string.player_subs_delay_burned), true, () ->
                    toast(getString(R.string.player_subs_delay_burned)));
        } else {
            String delayLabel = subtitleDelayMs == 0
                ? getString(R.string.player_delay_off)
                : subtitleDelayMs + " ms";
            addSettingsRow(inflater, getString(R.string.player_subs_delay), delayLabel, true, () -> {
                menuNav.push("subDelay");
                showSubtitleDelayMenu();
            });
        }
        boolean autoOk = subtitleAutoSyncAvailable && externalSrtSelected();
        String autoLabel = !subtitleAutoSyncAvailable
            ? getString(R.string.player_subs_auto_sync_unavailable)
            : (!externalSrtSelected()
                ? getString(R.string.player_subs_auto_sync_needs_srt)
                : (subtitleAutoSync ? getString(R.string.player_on) : getString(R.string.player_off)));
        addSettingsRow(inflater, getString(R.string.player_subs_auto_sync), autoLabel, true, autoOk, () -> {
            if (!subtitleAutoSyncAvailable) {
                toast(getString(R.string.player_subs_auto_sync_unavailable));
                return;
            }
            if (!externalSrtSelected()) {
                toast(getString(R.string.player_subs_auto_sync_needs_srt));
                return;
            }
            subtitleAutoSync = !subtitleAutoSync;
            if (subtitleAutoSync) {
                requestSubtitleAutoSync();
            } else {
                subtitleAutoSyncOffsetMs = 0;
                applySubtitleDelay();
            }
            emitSettings();
            showSubtitleSyncMenu();
        });
        menuScrim.setVisibility(View.VISIBLE);
        if (retainFocusLabel != null && !retainFocusLabel.isEmpty()) {
            focusMenuRow(retainFocusLabel, retainScrollY);
        } else {
            focusFirstMenuRow();
        }
    }

    private boolean externalSrtSelected() {
        if (sidecarSubtitleUrl != null && !sidecarSubtitleUrl.isEmpty()) return true;
        if (subtitleStreamId == null || subtitleStreamId.isEmpty()) return false;
        if (subtitlesCurrentlyBurned()) return false;
        OptionItem row = findSubtitleOption(subtitleStreamId);
        if (row == null) return false;
        String codec = row.codec == null ? "" : row.codec.trim().toLowerCase(Locale.US);
        return codec.contains("srt") || codec.contains("subrip") || codec.equals("webvtt") || codec.equals("vtt");
    }

    private void requestSubtitleAutoSync() {
        JSObject data = new JSObject();
        data.put("ratingKey", ratingKey == null ? "" : ratingKey);
        data.put("subtitleStreamId", subtitleStreamId == null ? "" : subtitleStreamId);
        data.put("sidecarUrl", sidecarSubtitleUrl == null ? "" : sidecarSubtitleUrl);
        PlayerBridge.get().emit("subtitleAutoSync", data);
        toast(getString(R.string.player_subs_auto_sync_working));
    }

    private void showSubtitleDelayMenu() {
        if (subtitlesCurrentlyBurned()) {
            toast(getString(R.string.player_subs_delay_burned));
            return;
        }
        final int[] delays = {-5000, -4000, -3000, -2000, -1000, -500, 0, 500, 1000, 2000, 3000, 4000, 5000};
        String[] labels = new String[delays.length];
        int checked = 6;
        for (int i = 0; i < delays.length; i++) {
            labels[i] = delays[i] == 0 ? getString(R.string.player_delay_off) : delays[i] + " ms";
            if (delays[i] == subtitleDelayMs) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_delay), labels, checked, which -> {
            subtitleDelayMs = delays[which];
            applySubtitleDelay();
            emitSettings();
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showBurnSubtitlesMenu() {
        final String[] values = {"auto", "always", "image"};
        String[] labels = {
            getString(R.string.player_burn_auto),
            getString(R.string.player_burn_always),
            getString(R.string.player_burn_image),
        };
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            if (values[i].equals(burnSubtitles)) checked = i;
        }
        showOptionSheet(getString(R.string.player_subs_burn), labels, checked, which -> {
            burnSubtitles = values[which];
            emitSettings();
            if (subtitleStreamId != null && !subtitleStreamId.isEmpty()) {
                rebuildStreamAfterSettings();
            }
        }, PlayerMenuNav.Return.SUBTITLES);
    }

    private void showAudioBoostMenu() {
        final int[] values = {100, 200, 300};
        String[] labels = {"100%", "200%", "300%"};
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            if (values[i] == audioBoost) checked = i;
        }
        showOptionSheet(getString(R.string.player_audio_boost), labels, checked, which -> {
            int previous = audioBoost;
            audioBoost = values[which];
            applyPlaybackVolume();
            emitSettings();
            if (audioBoost != previous && PlaybackUrls.isTranscodeUrl(currentUrl)) {
                rebuildStreamAfterSettings();
            }
        });
    }

    private void showSkipModeMenu(boolean intro) {
        final String[] values = {"off", "manual", "auto"};
        String[] labels = {
            getString(R.string.player_skip_off),
            getString(R.string.player_skip_manual),
            getString(R.string.player_skip_auto),
        };
        String current = intro ? skipIntroMode : skipCreditsMode;
        int checked = 1;
        for (int i = 0; i < values.length; i++) {
            if (values[i].equals(current)) checked = i;
        }
        showOptionSheet(
            getString(intro ? R.string.player_skip_intro_mode : R.string.player_skip_credits_mode),
            labels,
            checked,
            which -> {
                if (intro) {
                    skipIntroMode = values[which];
                    autoSkipIntro = "auto".equals(skipIntroMode);
                } else {
                    skipCreditsMode = values[which];
                    autoSkipCredits = "auto".equals(skipCreditsMode);
                }
                emitSettings();
            }
        );
    }

    private void showRewindOnResumeMenu() {
        final int[] values = {0, 5, 10, 15, 20, 30};
        String[] labels = new String[values.length];
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            labels[i] = values[i] <= 0 ? getString(R.string.player_rewind_off) : values[i] + "s";
            if (values[i] == rewindOnResumeSec) checked = i;
        }
        showOptionSheet(getString(R.string.player_rewind_resume), labels, checked, which -> {
            rewindOnResumeSec = values[which];
            emitSettings();
        });
    }

    private void showCinemaTrailersMenu() {
        final int[] values = {0, 1, 2, 3, 4, 5};
        String[] labels = new String[values.length];
        int checked = 0;
        for (int i = 0; i < values.length; i++) {
            labels[i] = values[i] <= 0 ? getString(R.string.player_off) : String.valueOf(values[i]);
            if (values[i] == cinemaTrailerCount) checked = i;
        }
        showOptionSheet(getString(R.string.player_cinema_trailers), labels, checked, which -> {
            cinemaTrailerCount = values[which];
            emitSettings();
        });
    }

    private int effectiveSubtitleDelayMs() {
        int auto = (subtitleAutoSync && subtitleAutoSyncAvailable) ? subtitleAutoSyncOffsetMs : 0;
        return Math.max(-5000, Math.min(5000, subtitleDelayMs + auto));
    }

    private void applySubtitleDelay() {
        long offsetUs = effectiveSubtitleDelayMs() * 1000L;
        long previous = subtitleDecoderFactory.offsetUs();
        subtitleDecoderFactory.setOffsetUs(offsetUs);
        if (player == null || previous == offsetUs) return;
        // Flush text decoder so the new offset applies without a full stream rebuild.
        try {
            long pos = Math.max(0, contentPositionMs() - timelineOriginMs);
            player.seekTo(pos);
        } catch (Throwable ignored) {
            /* ignore */
        }
    }

    private void requestSubtitleSearch() {
        subtitleSearchPending = true;
        JSObject data = new JSObject();
        data.put("ratingKey", ratingKey == null ? "" : ratingKey);
        PlayerBridge.get().emit("subtitleSearch", data);
        toast(getString(R.string.player_subs_search));
    }

    private void applySubtitleChoice(OptionItem picked) {
        if (picked.id != null && picked.id.startsWith("os:") && picked.url.isEmpty()) {
            if (picked.downloadKey.isEmpty()) return;
            // PMS downloads the hit first; JS answers with sessionJson.sidecarResolved.
            pendingSidecarDownloadId = picked.id;
            JSObject data = new JSObject();
            data.put("ratingKey", ratingKey == null ? "" : ratingKey);
            data.put("id", picked.id);
            data.put("key", picked.downloadKey);
            PlayerBridge.get().emit("subtitleDownload", data);
            toast(getString(R.string.player_subs_downloading));
            return;
        }
        String previousSidecar = sidecarSubtitleUrl;
        String previousSubtitleId = subtitleStreamId == null ? "" : subtitleStreamId;
        subtitleStreamId = picked.id == null ? "" : picked.id;
        boolean sidecar = picked.id != null && picked.id.startsWith("os:") && !picked.url.isEmpty();
        sidecarSubtitleUrl = sidecar ? picked.url : "";
        sidecarSubtitleCodec = sidecar ? picked.codec : "";
        saveAvPrefs();
        updateChipLabels();
        if (sidecar) {
            applyTextTrackPreference();
            reloadCurrentMedia();
            notifyTracksOnlyChange();
            return;
        }
        if (!previousSidecar.isEmpty()) reloadCurrentMedia();
        boolean off = subtitleStreamId.isEmpty();
        boolean burn = !off && subtitleCodecNeedsBurn(picked.codec);
        // Text / off on Direct Play: swap ExoPlayer text track — keep seekable bitstream.
        if (!burn && PlaybackUrls.isDirectPlayUrl(currentUrl)) {
            hideBurnInProgress();
            applyTextTrackPreference();
            notifyTracksOnlyChange();
            return;
        }
        if (burn) {
            // Cancel restores the track we had before this burn-in pick.
            showBurnInProgress(previousSubtitleId);
        } else {
            hideBurnInProgress();
        }
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
    }

    private void showBurnInProgress(@Nullable String cancelToSubtitleId) {
        burnInProgress = true;
        burnCancelSubtitleId = cancelToSubtitleId == null ? "" : cancelToSubtitleId;
        if (burnOverlay != null) burnOverlay.setVisibility(View.VISIBLE);
        setBufferingVisible(true);
        toast(getString(R.string.player_burning_subs));
        if (burnCancelBtn != null) burnCancelBtn.requestFocus();
    }

    private void hideBurnInProgress() {
        burnInProgress = false;
        burnCancelSubtitleId = null;
        if (burnOverlay != null) burnOverlay.setVisibility(View.GONE);
    }

    private void cancelBurnInSubtitles() {
        if (!burnInProgress) return;
        String restore = burnCancelSubtitleId == null ? "" : burnCancelSubtitleId;
        hideBurnInProgress();
        subtitleStreamId = restore;
        sidecarSubtitleUrl = "";
        saveAvPrefs();
        updateChipLabels();
        // Rebuild without image burn (Off or prior text track).
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex);
    }

    @Nullable
    private OptionItem findSubtitleOption(@Nullable String id) {
        if (id == null || id.isEmpty()) return null;
        for (OptionItem row : subtitles) {
            if (id.equals(row.id)) return row;
        }
        return null;
    }

    @Nullable
    private OptionItem findAudioOption(@Nullable String id) {
        if (id == null || id.isEmpty()) return null;
        for (OptionItem row : audioTracks) {
            if (id.equals(row.id)) return row;
        }
        return null;
    }

    private boolean subtitleCodecNeedsBurn(@Nullable String codec) {
        return TrackRules.subtitleCodecNeedsBurn(codec, burnSubtitles);
    }

    @Nullable
    private String preferredTextLanguage() {
        OptionItem row = findSubtitleOption(subtitleStreamId);
        if (row == null) return null;
        if (row.language != null && !row.language.trim().isEmpty()) {
            String lang = row.language.trim();
            int dash = lang.indexOf('-');
            return dash > 0 ? lang.substring(0, dash) : lang;
        }
        String label = row.label == null ? "" : row.label.trim();
        if (label.length() >= 2 && label.length() <= 3 && label.chars().allMatch(Character::isLetter)) {
            return label.toLowerCase(Locale.US);
        }
        // "English (SRT)" / "eng · Forced"
        String head = label.split("[·(\\[]")[0].trim();
        if (head.length() >= 2 && head.length() <= 3 && head.chars().allMatch(Character::isLetter)) {
            return head.toLowerCase(Locale.US);
        }
        return null;
    }

    /**
     * Direct Play serves the whole file — Exo must pick the same audio we decided was
     * Direct Play–safe (e.g. AC3 instead of default TrueHD). Official Plex does this too.
     */
    private void applyAudioTrackPreference() {
        if (player == null || applyingAudioTracks) return;
        TrackSelector selector = player.getTrackSelector();
        if (!(selector instanceof DefaultTrackSelector)) return;
        DefaultTrackSelector dts = (DefaultTrackSelector) selector;
        OptionItem want = findAudioOption(audioStreamId);
        String wantLang = want != null ? TrackRules.normalizeLangTag(want.language) : "";
        String wantCodec = want != null && want.codec != null
            ? want.codec.trim().toLowerCase(Locale.US)
            : "";
        if (wantLang.isEmpty() && want != null && want.label != null) {
            String head = want.label.split("[·(\\[]")[0].trim();
            if (head.length() >= 2 && head.length() <= 3 && head.chars().allMatch(Character::isLetter)) {
                wantLang = head.toLowerCase(Locale.US);
            }
        }
        Tracks tracks = player.getCurrentTracks();
        TrackSelectionParameters.Builder builder = dts.getParameters().buildUpon();
        builder.clearOverridesOfType(C.TRACK_TYPE_AUDIO);
        if (!wantLang.isEmpty()) builder.setPreferredAudioLanguage(wantLang);

        int bestGroup = -1;
        int bestIndex = -1;
        int bestScore = -1;
        List<Tracks.Group> groups = tracks.getGroups();
        for (int g = 0; g < groups.size(); g++) {
            Tracks.Group group = groups.get(g);
            if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i, false)) continue;
                Format format = group.getTrackFormat(i);
                String fmtCodec = TrackRules.formatAudioCodec(format);
                String fmtLang = TrackRules.normalizeLangTag(format.language);
                int score = 0;
                if (!wantCodec.isEmpty() && TrackRules.audioCodecMatches(fmtCodec, wantCodec)) score += 20;
                if (!wantLang.isEmpty() && !fmtLang.isEmpty() && fmtLang.equals(wantLang)) score += 10;
                // Prefer decoded/compatible tracks over bitstream when we asked for AC3/AAC.
                if (!wantCodec.isEmpty() && !TrackRules.isBitstreamAudioCodec(wantCodec) && TrackRules.isBitstreamAudioCodec(fmtCodec)) {
                    score -= 15;
                }
                if (wantCodec.isEmpty() && TrackRules.isBitstreamAudioCodec(fmtCodec)) score -= 5;
                if (score > bestScore) {
                    bestScore = score;
                    bestGroup = g;
                    bestIndex = i;
                }
            }
        }
        if (bestGroup >= 0 && bestIndex >= 0 && bestScore > 0) {
            Tracks.Group group = groups.get(bestGroup);
            builder.setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), bestIndex));
        }
        applyingAudioTracks = true;
        try {
            dts.setParameters(builder.build());
        } catch (Throwable ignored) {
            /* track override is best-effort */
        } finally {
            applyingAudioTracks = false;
        }
    }

    private void clearSubtitleCues() {
        PlayerView playerView = findViewById(R.id.player_view);
        if (playerView == null) return;
        SubtitleView subtitleView = playerView.getSubtitleView();
        if (subtitleView != null) subtitleView.setCues(null);
    }

    private void applyTextTrackPreference() {
        if (player == null || applyingTextTracks) return;
        TrackSelector selector = player.getTrackSelector();
        if (!(selector instanceof DefaultTrackSelector)) return;
        DefaultTrackSelector dts = (DefaultTrackSelector) selector;
        TrackSelectionParameters.Builder builder = dts.getParameters().buildUpon();
        builder.clearOverridesOfType(C.TRACK_TYPE_TEXT);
        boolean sidecar = sidecarSubtitleUrl != null && !sidecarSubtitleUrl.trim().isEmpty();
        boolean off = subtitleStreamId == null || subtitleStreamId.isEmpty() || subtitleStreamId.startsWith("os:");
        OptionItem subRow = findSubtitleOption(subtitleStreamId);
        boolean burn = !off && subRow != null && subtitleCodecNeedsBurn(subRow.codec);
        // HLS / burn-in already paints captions in-frame — keep Exo text off or they stack.
        if ((PlaybackUrls.isTranscodeUrl(currentUrl) && !sidecar) || burn) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
        } else if (off && !sidecar) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
        } else if (!off && !sidecar) {
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
            builder.setSelectUndeterminedTextLanguage(true);
            String lang = preferredTextLanguage();
            if (lang != null && !lang.isEmpty()) {
                builder.setPreferredTextLanguage(lang);
            }
            // Language alone can't tell "Signs & Songs" from "Full" (common with ASS) and
            // skips non-default tracks — pin the exact in-file track like audio does.
            TrackSelectionOverride exact = embeddedTextOverride(subRow);
            if (exact != null) builder.setOverrideForType(exact);
        } else {
            // Sidecar SubtitleConfiguration owns captions — pin it over any embedded text.
            builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false);
            TrackSelectionOverride side = sidecarTextOverride();
            if (side != null) builder.setOverrideForType(side);
        }
        applyingTextTracks = true;
        try {
            dts.setParameters(builder.build());
        } finally {
            applyingTextTracks = false;
        }
    }

    @Nullable
    private TrackSelectionOverride sidecarTextOverride() {
        if (player == null) return null;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                String id = group.getTrackFormat(i).id;
                if (id != null && id.endsWith(SIDECAR_TEXT_ID) && group.isTrackSupported(i, false)) {
                    return new TrackSelectionOverride(group.getMediaTrackGroup(), i);
                }
            }
        }
        return null;
    }

    /** Exo text track at the Plex row's in-file position, or null when it can't be trusted. */
    @Nullable
    private TrackSelectionOverride embeddedTextOverride(@Nullable OptionItem row) {
        if (player == null || row == null || row.embeddedOrdinal < 0) return null;
        int seen = 0;
        for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
            if (group.getType() != C.TRACK_TYPE_TEXT) continue;
            for (int i = 0; i < group.length; i++) {
                if (seen++ != row.embeddedOrdinal) continue;
                if (!group.isTrackSupported(i, false)) return null;
                String want = TrackRules.normalizeLangTag(row.language);
                String have = TrackRules.normalizeLangTag(group.getTrackFormat(i).language);
                boolean langClash = !want.isEmpty() && !have.isEmpty() && !"und".equals(have)
                    && !want.startsWith(have) && !have.startsWith(want);
                return langClash ? null : new TrackSelectionOverride(group.getMediaTrackGroup(), i);
            }
        }
        return null;
    }

    private void notifyTracksOnlyChange() {
        JSObject data = new JSObject();
        data.put("qualityId", qualityId == null ? "" : qualityId);
        data.put("audioStreamId", audioStreamId == null ? "" : audioStreamId);
        data.put("subtitleStreamId", subtitleStreamId == null ? "" : subtitleStreamId);
        data.put("mediaIndex", mediaIndex);
        data.put("positionMs", Math.max(0, contentPositionMs()));
        data.put("reason", "tracks");
        PlayerBridge.get().emit("streamChange", data);
    }

    private void showZoomMenu() {
        bumpChrome();
        final float[] zooms = {1f, 1.1f, 1.25f, 1.5f, 2f};
        String[] labels = new String[zooms.length + 1];
        int checked = 0;
        labels[0] = getString(R.string.player_zoom_fit);
        if (!videoFill && Math.abs(videoZoom - 1f) < 0.01f) checked = 0;
        for (int i = 0; i < zooms.length; i++) {
            if (i == 0) continue;
            labels[i] = String.format(Locale.US, "%.2g×", zooms[i]);
            if (!videoFill && Math.abs(videoZoom - zooms[i]) < 0.01f) checked = i;
        }
        labels[zooms.length] = getString(R.string.player_zoom_fill);
        if (videoFill) checked = zooms.length;
        showOptionSheet(getString(R.string.player_zoom), labels, checked, which -> {
            videoFill = which == zooms.length;
            videoZoom = videoFill ? 1f : zooms[Math.min(which, zooms.length - 1)];
            applyVideoZoom();
            savePlayerLookPrefs();
            updateChipLabels();
        });
    }

    private void showDelayMenu() {
        bumpChrome();
        final int[] delays = {0, 25, 50, 75, 100, 150, 200, 250, 400, 500};
        String[] labels = new String[delays.length];
        int checked = 0;
        for (int i = 0; i < delays.length; i++) {
            labels[i] = delays[i] <= 0 ? getString(R.string.player_delay_off) : delays[i] + " ms";
            if (delays[i] == audioDelayMs) checked = i;
        }
        showOptionSheet(getString(R.string.player_delay), labels, checked, which -> {
            audioDelayMs = delays[which];
            applyAudioDelay(true);
            savePlayerLookPrefs();
            saveAvPrefs();
            updateChipLabels();
        });
    }

    private void showRepeatMenu() {
        bumpChrome();
        final int[] modes = {Player.REPEAT_MODE_OFF, Player.REPEAT_MODE_ONE, Player.REPEAT_MODE_ALL};
        String[] labels = {
            getString(R.string.player_repeat_off),
            getString(R.string.player_repeat_one),
            getString(R.string.player_repeat_all),
        };
        int checked = 0;
        for (int i = 0; i < modes.length; i++) {
            if (modes[i] == repeatMode) checked = i;
        }
        showOptionSheet(getString(R.string.player_repeat), labels, checked, which -> {
            repeatMode = modes[which];
            applyRepeatMode();
            savePlayerLookPrefs();
            updateChipLabels();
        });
    }

    private void applyVideoZoom() {
        PlayerView view = findViewById(R.id.player_view);
        if (player != null) {
            player.setVideoScalingMode(videoFill
                ? C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
                : C.VIDEO_SCALING_MODE_SCALE_TO_FIT);
        }
        if (view == null) return;
        View surface = view.getVideoSurfaceView();
        if (surface == null) return;
        float zoom = videoFill ? 1f : Math.max(1f, Math.min(2f, videoZoom));
        surface.setScaleX(zoom);
        surface.setScaleY(zoom);
        surface.setPivotX(surface.getWidth() / 2f);
        surface.setPivotY(surface.getHeight() / 2f);
    }

    private void applyAudioDelay(boolean flush) {
        delayAudioProcessor.setDelayMs(audioDelayMs);
        if (flush && player != null) {
            long pos = contentPositionMs();
            player.seekTo(Math.max(0, pos - timelineOriginMs));
        }
    }

    private void applyRepeatMode() {
        if (player == null) return;
        player.setRepeatMode(repeatMode == Player.REPEAT_MODE_ONE
            ? Player.REPEAT_MODE_ONE
            : Player.REPEAT_MODE_OFF);
    }

    private void reloadCurrentMedia() {
        if (player == null || currentUrl == null || currentUrl.isEmpty()) return;
        long offset = contentPositionMs();
        if (player.getPlaybackState() != Player.STATE_IDLE || player.getMediaItemCount() > 0) {
            try {
                player.stop();
            } catch (Throwable ignored) {
                /* best-effort before replacing the item */
            }
        }
        queueStartPosition(currentUrl, PlaybackUrls.isTranscodeUrl(currentUrl) ? 0 : offset);
        player.setPlayWhenReady(!userPaused);
        player.prepare();
    }

    private void savePlayerLookPrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putFloat("videoZoom", videoZoom)
            .putBoolean("videoFill", videoFill)
            .putInt("audioDelayMs", audioDelayMs)
            .putInt("repeatMode", repeatMode)
            .apply();
    }

    private void showSleepMenu() {
        bumpChrome();
        String[] labels = {
            getString(R.string.player_sleep_off),
            getString(R.string.player_sleep_15),
            getString(R.string.player_sleep_30),
            getString(R.string.player_sleep_45),
            getString(R.string.player_sleep_end),
            getString(R.string.player_sleep_after_1),
            getString(R.string.player_sleep_after_2),
            getString(R.string.player_sleep_credits),
        };
        int checked = 0;
        if (sleepUntilElapsedRealtime > 0) {
            long left = sleepUntilElapsedRealtime - SystemClock.elapsedRealtime();
            if (left > 40 * 60_000L) checked = 3;
            else if (left > 25 * 60_000L) checked = 2;
            else if (left > 10 * 60_000L) checked = 1;
        }         else if (sleepEndOfEpisode) checked = 4;
        else if (sleepEpisodeLimit && sleepEpisodesRemaining == 1) checked = 5;
        else if (sleepEpisodeLimit && sleepEpisodesRemaining >= 2) checked = 6;
        else if (sleepAtCredits) checked = 7;
        showOptionSheet(getString(R.string.player_sleep), labels, checked, which -> {
            sleepEndOfEpisode = false;
            sleepUntilElapsedRealtime = 0;
            sleepEpisodesRemaining = 0;
            sleepEpisodeLimit = false;
            sleepAtCredits = false;
            if (which == 1) sleepUntilElapsedRealtime = SystemClock.elapsedRealtime() + 15 * 60_000L;
            else if (which == 2) sleepUntilElapsedRealtime = SystemClock.elapsedRealtime() + 30 * 60_000L;
            else if (which == 3) sleepUntilElapsedRealtime = SystemClock.elapsedRealtime() + 45 * 60_000L;
            else if (which == 4) sleepEndOfEpisode = true;
            else if (which == 5) {
                sleepEpisodeLimit = true;
                sleepEpisodesRemaining = 1;
            } else if (which == 6) {
                sleepEpisodeLimit = true;
                sleepEpisodesRemaining = 2;
            } else if (which == 7) sleepAtCredits = true;
            persistSleepPrefs();
            toast(labels[which]);
        });
    }

    private void requestStreamChange(String q, String a, String s, int mi) {
        requestStreamChange(q, a, s, mi, contentPositionMs());
    }

    private void requestStreamChange(String q, String a, String s, int mi, long positionMs) {
        requestStreamChange(q, a, s, mi, positionMs, null);
    }

    private void requestStreamChange(String q, String a, String s, int mi, long positionMs, @Nullable String reason) {
        // A Direct Play seek must not open a new PMS session. That rebuild is what
        // stacks transcodes until the server falls over.
        if ("seek".equals(reason) && !PlaybackUrls.isTranscodeUrl(currentUrl)) return;
        // Coalesce with in-flight seek/quality rebuilds so PMS doesn't mint ghost sessions.
        markStreamSwap();
        JSObject data = new JSObject();
        data.put("qualityId", q == null ? "" : q);
        data.put("audioStreamId", a == null ? "" : a);
        data.put("subtitleStreamId", s == null ? "" : s);
        data.put("mediaIndex", mi);
        data.put("positionMs", Math.max(0, positionMs));
        if (reason != null && !reason.isEmpty()) data.put("reason", reason);
        PlayerBridge.get().emit("streamChange", data);
        setBufferingVisible(true);
    }

    private void openExternalPlayer() {
        bumpChrome();
        if (currentUrl == null || currentUrl.isEmpty()) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(currentUrl), "video/*");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(intent, getString(R.string.player_external));
            startActivity(chooser);
            emitProgress("paused");
        } catch (Exception e) {
            toast("No external player found");
        }
    }

    private void enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (isTelevision()) return;
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;
        try {
            PictureInPictureParams params = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .build();
            enterPictureInPictureMode(params);
            setChromeVisible(false);
        } catch (Exception e) {
            toast("PiP unavailable");
        }
    }

    private void updatePipVisibility() {
        boolean show = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !isTelevision()
            && getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        if (pipBtn != null) pipBtn.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private boolean isTelevision() {
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        return ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    private void togglePlayPause() {
        if (player == null) return;
        // Debounce OK/click double-delivery on Android TV remotes.
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - lastToggleElapsedMs < 280) return;
        lastToggleElapsedMs = now;
        // Use playWhenReady — isPlaying is false while buffering and made Play a no-op/double-toggle.
        applyPlayPause(!player.getPlayWhenReady());
    }

    void applyPlayPause(boolean play) {
        if (player == null) return;
        if (!play) {
            if (android.os.SystemClock.elapsedRealtime() < suppressPauseUntilElapsed) return;
            pausePositionMs = contentPositionMs();
            userPaused = true;
            mainHandler.removeCallbacks(playThenSeekRunnable);
            player.setPlayWhenReady(false);
            try {
                player.pause();
            } catch (Throwable ignored) {
                /* setPlayWhenReady is the source of truth */
            }
        } else {
            if (userPaused && rewindOnResumeSec > 0 && pausePositionMs >= 0) {
                long target = Math.max(0, pausePositionMs - (rewindOnResumeSec * 1000L));
                pausePositionMs = -1;
                seekToContent(target, true);
            } else {
                pausePositionMs = -1;
            }
            userPaused = false;
            player.setPlayWhenReady(true);
            try {
                player.play();
            } catch (Throwable ignored) {
                /* some TVs ignore setPlayWhenReady until play() */
            }
            if (player.getPlaybackState() == Player.STATE_IDLE && player.getMediaItemCount() > 0) {
                try {
                    player.prepare();
                } catch (Throwable ignored) {
                    /* prepare after stop/idle is best-effort */
                }
            }
        }
        updatePlayPauseLabel();
        if (!minimized) bumpChrome();
    }

    private void seekBy(long deltaMs) {
        seekToContent(contentPositionMs() + deltaMs, false);
        bumpChrome();
    }

    private void seekByWithFlash(long deltaMs) {
        seekBy(deltaMs);
        flashSeek(deltaMs < 0 ? -1 : 1);
    }

    private void flashSeek(int direction) {
        if (seekFlashView == null) return;
        bumpChrome();
        seekFlashView.animate().cancel();
        seekFlashView.setAlpha(1f);
        seekFlashView.setText(direction < 0 ? "−10" : "+10");
        seekFlashView.setVisibility(View.VISIBLE);
        mainHandler.removeCallbacks(hideSeekFlashRunnable);
        mainHandler.postDelayed(hideSeekFlashRunnable, 650);
    }

    private void previewSeekBy(long deltaMs) {
        long duration = contentDurationMs();
        long base = scrubTargetMs >= 0 ? scrubTargetMs : contentPositionMs();
        long target = Math.max(0, base + deltaMs);
        if (duration > 0) target = Math.min(target, Math.max(0, duration - 1500));
        scrubTargetMs = target;
        seekingUi = true;
        scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 1600;
        if (duration > 0 && seekBar != null) {
            seekBar.setProgress((int) Math.min(1000, Math.max(0, (target * 1000L) / duration)));
        }
        setTimeLabels(target, Math.max(0, duration));
        bumpChrome();
        // Move the picture on each step. Direct Play only — no new server session.
        if (!shouldRestartForSeek()) {
            lastSeekTargetMs = target;
            lastSeekAtMs = android.os.SystemClock.elapsedRealtime();
            if (!streamSwapInFlight) seekRecoveryUsed = false;
            mainHandler.removeCallbacks(directSeekRunnable);
            mainHandler.postDelayed(directSeekRunnable, 160);
        }
    }

    private void startSeekHold(int direction) {
        seekHoldDirection = direction < 0 ? -1 : 1;
        previewSeekBy(seekHoldDirection * 10_000L);
        flashSeek(seekHoldDirection);
        mainHandler.removeCallbacks(seekHoldRunnable);
        mainHandler.postDelayed(seekHoldRunnable, 420);
    }

    private void stopSeekHold() {
        int direction = seekHoldDirection;
        seekHoldDirection = 0;
        mainHandler.removeCallbacks(seekHoldRunnable);
        if (direction != 0 && scrubTargetMs >= 0 && player != null && !finishing) {
            seekToContent(scrubTargetMs, true);
        }
    }

    private void setTimeLabels(long pos, long duration) {
        if (timeView != null) timeView.setText(formatClock(pos));
        long remaining = Math.max(0, duration - pos);
        if (remainingView != null) {
            remainingView.setText(duration > 0 ? ("-" + formatClock(remaining)) : "");
        }
        if (endsAtView != null) {
            if (duration <= 0 || remaining <= 0) {
                endsAtView.setVisibility(View.GONE);
            } else {
                endsAtView.setText(getString(R.string.player_ends_at, formatEndsAt(remaining)));
                endsAtView.setVisibility(View.VISIBLE);
            }
        }
        if (speedLabel != null) {
            boolean showSpeed = Math.abs(playbackSpeed - 1f) > 0.01f;
            speedLabel.setVisibility(showSpeed ? View.VISIBLE : View.GONE);
            if (showSpeed) {
                speedLabel.setText(String.format(Locale.US, "%.2g×", playbackSpeed));
            }
        }
    }

    private static String formatEndsAt(long remainingMs) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(System.currentTimeMillis() + Math.max(0, remainingMs));
        int hour = cal.get(Calendar.HOUR);
        if (hour == 0) hour = 12;
        int minute = cal.get(Calendar.MINUTE);
        String amPm = cal.get(Calendar.AM_PM) == Calendar.AM ? "AM" : "PM";
        return String.format(Locale.US, "%d:%02d %s", hour, minute, amPm);
    }

    private void doSkipIntro() {
        if (introEndMs < 0) return;
        seekToContent(introEndMs, true);
        skippedIntro = true;
        dismissSkipIntroChip();
        emitProgress("playing");
    }

    private void doSkipCredits() {
        skippedCredits = true;
        dismissSkipCreditsChip();
        if (autoplayNext && nextRatingKey != null && !nextRatingKey.isEmpty()) {
            finishForPlayNext();
        } else {
            finishWithResult(true, false);
        }
    }

    private void clearSkipChips() {
        mainHandler.removeCallbacks(hideSkipIntroChipRunnable);
        mainHandler.removeCallbacks(hideSkipCreditsChipRunnable);
        skipIntroPromptOffered = false;
        skipCreditsPromptOffered = false;
        skipIntroChipActive = false;
        skipCreditsChipActive = false;
        applySkipChipVisibility(false, false);
    }

    private void dismissSkipIntroChip() {
        mainHandler.removeCallbacks(hideSkipIntroChipRunnable);
        skipIntroChipActive = false;
        applySkipChipVisibility(false, skipCreditsChipActive);
    }

    private void dismissSkipCreditsChip() {
        mainHandler.removeCallbacks(hideSkipCreditsChipRunnable);
        skipCreditsChipActive = false;
        applySkipChipVisibility(skipIntroChipActive, false);
    }

    private void applySkipChipVisibility(boolean showIntro, boolean showCredits) {
        if (skipIntroBtn != null) skipIntroBtn.setVisibility(showIntro ? View.VISIBLE : View.GONE);
        if (skipCreditsBtn != null) skipCreditsBtn.setVisibility(showCredits ? View.VISIBLE : View.GONE);
        if (skipRow != null) {
            skipRow.setVisibility((showIntro || showCredits) ? View.VISIBLE : View.GONE);
        }
    }

    private void armSkipIntroChip() {
        if (skipIntroPromptOffered) return;
        skipIntroPromptOffered = true;
        skipIntroChipActive = true;
        mainHandler.removeCallbacks(hideSkipIntroChipRunnable);
        mainHandler.postDelayed(hideSkipIntroChipRunnable, SKIP_CHIP_VISIBLE_MS);
        applySkipChipVisibility(true, skipCreditsChipActive);
        if (skipIntroBtn != null && !isOptionDialogShowing()) {
            skipIntroBtn.requestFocus();
        }
    }

    private void armSkipCreditsChip() {
        if (skipCreditsPromptOffered) return;
        skipCreditsPromptOffered = true;
        skipCreditsChipActive = true;
        mainHandler.removeCallbacks(hideSkipCreditsChipRunnable);
        mainHandler.postDelayed(hideSkipCreditsChipRunnable, SKIP_CHIP_VISIBLE_MS);
        applySkipChipVisibility(skipIntroChipActive, true);
        if (skipCreditsBtn != null && !isOptionDialogShowing() && !skipIntroChipActive) {
            skipCreditsBtn.requestFocus();
        }
    }

    private boolean inIntroRange() {
        if (skippedIntro || introStartMs < 0 || introEndMs <= introStartMs) return false;
        long pos = contentPositionMs();
        return pos >= introStartMs && pos < introEndMs;
    }

    private boolean inCreditsRange() {
        if (skippedCredits || creditsStartMs < 0) return false;
        return contentPositionMs() >= creditsStartMs;
    }

    private boolean trySkipFromRemote() {
        if (inIntroRange()) {
            doSkipIntro();
            return true;
        }
        if (inCreditsRange()) {
            doSkipCredits();
            return true;
        }
        return false;
    }

    private void maybeAutoSkip() {
        if (player == null) return;
        long pos = contentPositionMs();
        boolean introAuto = "auto".equals(skipIntroMode) || autoSkipIntro;
        boolean creditsAuto = "auto".equals(skipCreditsMode) || autoSkipCredits;
        boolean introOff = "off".equals(skipIntroMode);
        boolean creditsOff = "off".equals(skipCreditsMode);
        if (introAuto && !skippedIntro && introStartMs >= 0 && introEndMs > introStartMs
            && pos >= introStartMs && pos < introEndMs) {
            doSkipIntro();
        }
        if (creditsAuto && !skippedCredits && creditsStartMs >= 0 && pos >= creditsStartMs) {
            doSkipCredits();
        }
        boolean inIntro = !introOff && inIntroRange();
        boolean inCredits = !creditsOff && inCreditsRange();
        // Show for 10s from first entry, or until the skip window ends — whichever is sooner.
        // Chips live outside chrome so they remain visible with OSD hidden.
        if (inIntro) {
            armSkipIntroChip();
        } else {
            if (skipIntroChipActive) dismissSkipIntroChip();
            skipIntroPromptOffered = false;
        }
        if (inCredits) {
            armSkipCreditsChip();
        } else {
            if (skipCreditsChipActive) dismissSkipCreditsChip();
            skipCreditsPromptOffered = false;
        }
    }

    private void maybeShowUpNext() {
        if (upNextRow == null) return;
        long pos = contentPositionMs();
        long duration = contentDurationMs();
        boolean nearEnd = duration > 0 && pos >= Math.max(0, duration - 30_000);
        boolean inCredits = creditsStartMs >= 0 && pos >= creditsStartMs;
        boolean showWindow = nearEnd || inCredits;
        boolean hasNext = nextRatingKey != null && !nextRatingKey.isEmpty();
        boolean showNext = showWindow && hasNext && !watchCreditsChosen;
        boolean showRelated = showWindow && !relatedItems.isEmpty() && (!hasNext || watchCreditsChosen);
        boolean show = showNext || showRelated;
        boolean wasHidden = upNextRow.getVisibility() != View.VISIBLE;
        upNextRow.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show) return;
        if (showRelated) {
            OptionItem first = relatedItems.get(0);
            if (upNextKicker != null) upNextKicker.setText(R.string.player_more_like_this);
            if (upNextLabel != null) upNextLabel.setText(first.label);
            if (upNextArt != null) upNextArt.setVisibility(View.GONE);
            if (upNextCountdown != null) upNextCountdown.setVisibility(View.GONE);
            if (upNextCreditsBtn != null) {
                upNextCreditsBtn.setVisibility(relatedItems.size() > 1 ? View.VISIBLE : View.GONE);
                upNextCreditsBtn.setText(R.string.player_more_like_this);
                upNextCreditsBtn.setOnClickListener(v -> showRelatedMenu());
            }
            if (upNextPlayBtn != null) {
                upNextPlayBtn.setText(R.string.player_play_now);
                upNextPlayBtn.setOnClickListener(v -> playRelatedItem(first.id));
            }
        } else {
            if (upNextKicker != null) upNextKicker.setText(R.string.player_up_next);
            if (upNextLabel != null) {
                upNextLabel.setText(nextTitle.isEmpty() ? getString(R.string.player_up_next) : nextTitle);
            }
            applyUpNextArt();
            if (upNextCountdown != null) {
                int seconds = duration > pos ? (int) Math.max(1, Math.ceil((duration - pos) / 1000.0)) : 0;
                if (autoplayNext && seconds > 0) {
                    upNextCountdown.setVisibility(View.VISIBLE);
                    upNextCountdown.setText(getString(R.string.player_up_next_in, seconds));
                } else {
                    upNextCountdown.setVisibility(View.GONE);
                }
            }
            if (upNextCreditsBtn != null) {
                upNextCreditsBtn.setVisibility(View.VISIBLE);
                upNextCreditsBtn.setText(R.string.player_watch_credits);
                upNextCreditsBtn.setOnClickListener(v -> dismissUpNextWatchCredits());
            }
            if (upNextPlayBtn != null) {
                upNextPlayBtn.setText(R.string.player_play_now);
                upNextPlayBtn.setOnClickListener(v -> finishForPlayNext());
            }
        }
        if (wasHidden) {
            // Keep the card usable: hide OSD so D-pad does not open chrome, and focus Play now.
            setChromeVisible(false);
            focusUpNextControls();
        } else if (isUpNextVisible() && !isUpNextFocused()) {
            focusUpNextControls();
        }
    }

    private boolean isUpNextVisible() {
        return upNextRow != null && upNextRow.getVisibility() == View.VISIBLE;
    }

    private boolean isUpNextFocused() {
        View focus = getCurrentFocus();
        return focus != null && (focus == upNextPlayBtn || focus == upNextCreditsBtn);
    }

    private void focusUpNextControls() {
        if (!isUpNextVisible()) return;
        if (upNextPlayBtn != null && upNextPlayBtn.getVisibility() == View.VISIBLE) {
            upNextPlayBtn.requestFocus();
            return;
        }
        if (upNextCreditsBtn != null && upNextCreditsBtn.getVisibility() == View.VISIBLE) {
            upNextCreditsBtn.requestFocus();
        }
    }

    private void showRelatedMenu() {
        if (relatedItems.isEmpty()) return;
        bumpChrome();
        String[] labels = new String[relatedItems.size()];
        for (int i = 0; i < relatedItems.size(); i++) labels[i] = relatedItems.get(i).label;
        showOptionSheet(getString(R.string.player_more_like_this), labels, 0, which -> {
            if (which >= 0 && which < relatedItems.size()) {
                playRelatedItem(relatedItems.get(which).id);
            }
        });
    }

    private void playRelatedItem(String ratingKey) {
        if (ratingKey == null || ratingKey.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("ratingKey", ratingKey);
        PlayerBridge.get().emit("playRelated", data);
        finishWithResult(true, false);
    }

    private void dismissUpNextWatchCredits() {
        watchCreditsChosen = true;
        autoplayNext = false;
        if (upNextRow != null) upNextRow.setVisibility(View.GONE);
        // Re-evaluate so More like this can replace Up Next while credits roll.
        maybeShowUpNext();
    }

    private void maybeSleepTimer() {
        if (sleepAtCredits && inCreditsRange()) {
            clearSleepPrefs();
            if (player != null) player.pause();
            toast(getString(R.string.player_sleep_fired));
            finishWithResult(true, false);
            return;
        }
        if (sleepEndOfEpisode) return;
        if (sleepUntilElapsedRealtime <= 0) return;
        if (SystemClock.elapsedRealtime() >= sleepUntilElapsedRealtime) {
            clearSleepPrefs();
            if (player != null) player.pause();
            toast(getString(R.string.player_sleep_fired));
            finishWithResult(false, false);
        }
    }

    /** After N more: remaining=1 allows one play-next, then stops when that episode ends. */
    private boolean shouldStopForSleepEpisodes() {
        if (!sleepEpisodeLimit) return false;
        if (sleepEpisodesRemaining <= 0) return true;
        sleepEpisodesRemaining -= 1;
        return false;
    }

    private void updateProgressUi() {
        if (player == null) return;
        reconcileTranscodeOrigin();
        if (scrubTargetMs >= 0) {
            long playerPos = Math.max(0, timelineOriginMs + Math.max(0, player.getCurrentPosition()));
            boolean caughtUp = Math.abs(playerPos - scrubTargetMs) < 1500;
            boolean holding = android.os.SystemClock.elapsedRealtime() < scrubHoldUntilMs;
            if (seekHoldDirection != 0 || (!caughtUp && holding)) {
                long duration = contentDurationMs();
                if (duration > 0 && seekBar != null) {
                    seekBar.setProgress((int) Math.min(1000, Math.max(0, (scrubTargetMs * 1000L) / duration)));
                }
                if (timeView != null || remainingView != null || endsAtView != null) {
                    setTimeLabels(scrubTargetMs, Math.max(0, duration));
                }
                return;
            }
            scrubTargetMs = -1;
            seekingUi = false;
        } else if (seekingUi) {
            return;
        }
        long pos = contentPositionMs();
        long duration = contentDurationMs();
        if (duration > 0) {
            int progress = (int) Math.min(1000, Math.max(0, (pos * 1000L) / duration));
            seekBar.setProgress(progress);
        }
        setTimeLabels(pos, Math.max(0, duration));
        updatePlayPauseLabel();
    }

    private void updatePlayPauseLabel() {
        if (playPauseBtn == null || player == null) return;
        // Show Pause whenever we intend to play (incl. buffering), not only when frames advance.
        boolean playing = player.getPlayWhenReady() && !userPaused;
        playPauseBtn.setImageResource(playing ? R.drawable.ic_player_pause : R.drawable.ic_player_play);
        playPauseBtn.setContentDescription(getString(playing ? R.string.player_pause : R.string.player_play));
    }

    private void emitProgress(String state) {
        boolean seekBuffer = "buffering".equals(state)
            && (seekingUi || android.os.SystemClock.elapsedRealtime() - lastSeekAtMs < 4_000);
        if (!seekBuffer) pingPlexTimeline(state);
        if (player == null) return;
        JSObject data = new JSObject();
        data.put("state", state);
        data.put("positionMs", contentPositionMs());
        long duration = contentDurationMs();
        data.put("durationMs", Math.max(0, duration));
        data.put("ratingKey", ratingKey);
        PlayerBridge.get().emit("progress", data);
        maybeUpdateWatchNext(state);
    }

    private void applyWatchNextJson(@Nullable JSONObject json) {
        lastWatchNextAtMs = 0;
        lastWatchNextPosMs = -1;
        watchNextRemoved = false;
        if (json == null) {
            watchNextEntry = null;
            return;
        }
        WatchNext.Entry entry = new WatchNext.Entry();
        entry.ratingKey = ratingKey == null ? "" : ratingKey;
        entry.serverId = json.optString("serverId", "").trim();
        entry.episode = "episode".equals(json.optString("type", ""));
        entry.title = json.optString("title", "").trim();
        entry.episodeTitle = json.optString("episodeTitle", "").trim();
        entry.seasonNumber = json.optInt("seasonNumber", 0);
        entry.episodeNumber = json.optInt("episodeNumber", 0);
        entry.artUrl = json.optString("artUrl", "").trim();
        JSONObject headers = json.optJSONObject("artHeaders");
        if (headers != null) {
            Map<String, String> map = new HashMap<>();
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                map.put(key, headers.optString(key, ""));
            }
            entry.artHeaders = map;
        }
        watchNextEntry = entry.title.isEmpty() || entry.ratingKey.isEmpty() ? null : entry;
    }

    /**
     * Keep the TV home "Continue Watching" row in step: write on pause / stop and
     * once a minute while playing; drop the title once it counts as watched (90%,
     * the same line Plex uses).
     */
    private void maybeUpdateWatchNext(String state) {
        WatchNext.Entry entry = watchNextEntry;
        if (entry == null || musicMode || player == null) return;
        long duration = contentDurationMs();
        if (duration <= 0) return;
        long position = contentPositionMs();
        if (playbackEnded || position >= duration * 9 / 10) {
            if (!watchNextRemoved) {
                watchNextRemoved = true;
                WatchNext.remove(this, entry.serverId, entry.ratingKey);
            }
            return;
        }
        if (position < 30_000) return;
        boolean settled = "paused".equals(state) || "stopped".equals(state);
        long now = android.os.SystemClock.elapsedRealtime();
        // The 1s tick re-sends "paused" while paused. Only write when the spot moved.
        if (Math.abs(position - lastWatchNextPosMs) < 5_000) return;
        if (!settled && lastWatchNextAtMs > 0 && now - lastWatchNextAtMs < 60_000) return;
        lastWatchNextAtMs = now;
        lastWatchNextPosMs = position;
        watchNextRemoved = false;
        entry.positionMs = position;
        entry.durationMs = duration;
        WatchNext.publish(this, entry);
    }

    private void absorbTimelineFromUrl(String url) {
        timelineReporter.absorbFromUrl(url);
    }

    private boolean shouldMarkWatched(long positionMs, boolean ended) {
        if (ended || playbackEnded) return true;
        long durationMs = 0L;
        try {
            durationMs = contentDurationMs();
        } catch (Throwable ignored) {
            durationMs = Math.max(0L, durationHintMs);
        }
        return PlexTimelineReporter.isWatchedPosition(positionMs, durationMs, creditsStartMs);
    }

    private void scrobbleWatched() {
        absorbTimelineFromUrl(currentUrl);
        try {
            final String pingUrl = timelineReporter.buildScrobbleUrl(ratingKey);
            if (pingUrl == null) return;
            TIMELINE_EXECUTOR.execute(() -> timelineReporter.httpPing(pingUrl, null, "GET"));
        } catch (Throwable e) {
            Log.w(TAG, "Plex scrobble skipped", e);
        }
    }

    private void pingPlexTimeline(String rawState) {
        pingPlexTimeline(rawState, -1L);
    }

    private void pingPlexTimeline(String rawState, long positionOverrideMs) {
        String state = PlexTimelineReporter.normalizeState(rawState);
        if (!timelineReporter.shouldPing(state, SystemClock.elapsedRealtime())) return;
        absorbTimelineFromUrl(currentUrl);
        if (ratingKey == null || ratingKey.trim().isEmpty()) return;
        long positionMs = 0L;
        long durationMs = Math.max(0L, durationHintMs);
        if (player != null) {
            try {
                positionMs = Math.max(0L, contentPositionMs());
                durationMs = Math.max(durationMs, contentDurationMs());
            } catch (Throwable ignored) {
                /* player tearing down */
            }
        }
        if (positionOverrideMs >= 0L) positionMs = positionOverrideMs;
        final String pingState = state;
        final long pingPosition = positionMs;
        final long pingDuration = durationMs;
        if (timelineReporter.hasPmsCredentials()) {
            final String pingUrl = timelineReporter.buildPmsTimelineUrl(
                ratingKey, pingState, pingPosition, pingDuration, musicMode, audioStreamId, subtitleStreamId);
            if (pingUrl != null) {
                TIMELINE_EXECUTOR.execute(() -> timelineReporter.httpPing(pingUrl, null, "GET"));
                return;
            }
        }
        final String portalUrl = PlexTimelineReporter.buildPortalTimelineUrl(currentUrl);
        if (portalUrl == null) return;
        final String body = timelineReporter.buildPortalTimelineBody(
            ratingKey, pingState, pingPosition, pingDuration, audioStreamId, subtitleStreamId);
        if (body == null) return;
        TIMELINE_EXECUTOR.execute(() -> timelineReporter.httpPing(portalUrl, body, "POST"));
    }

    private void toggleChrome() {
        setChromeVisible(!chromeVisible);
        if (chromeVisible) bumpChrome();
    }

    private void setChromeVisible(boolean visible) {
        boolean wasHidden = chrome == null || chrome.getVisibility() != View.VISIBLE;
        chromeVisible = visible;
        int vis = visible ? View.VISIBLE : View.GONE;
        if (chrome != null) chrome.setVisibility(vis);
        if (topBar != null) topBar.setVisibility(vis);
        View topEnd = findViewById(R.id.player_top_end);
        if (topEnd != null) topEnd.setVisibility(vis);
        setClockVisible(visible);
        if (visible && wasHidden && playPauseBtn != null && seekHoldDirection == 0) {
            // Up-next owns the remote while visible — do not steal focus to Play/Pause.
            // A seek-hold must keep the key, or the repeat is eaten as focus movement.
            if (!isUpNextVisible()) playPauseBtn.requestFocus();
        } else if (!visible && !isOptionDialogShowing()) {
            if (isUpNextVisible()) {
                focusUpNextControls();
            } else if (!focusSkipChipIfVisible()) {
                View root = findViewById(R.id.player_root);
                if (root != null) root.requestFocus();
            }
        }
    }

    private void setBufferingVisible(boolean visible) {
        if (bufferingView != null) {
            bufferingView.setVisibility(visible ? View.VISIBLE : View.GONE);
        }
    }

    private void showError(String message) {
        if (errorView == null) return;
        hideBurnInProgress();
        errorView.setText(message);
        errorView.setVisibility(View.VISIBLE);
        setBufferingVisible(false);
        setChromeVisible(true);
        // No close button any more (Back closes the player); keep the remote on the controls.
        if (playPauseBtn != null) playPauseBtn.requestFocus();
    }

    private void hideError() {
        if (errorView != null) errorView.setVisibility(View.GONE);
    }

    private Map<String, String> headersWithCookies(String url, Map<String, String> incoming) {
        Map<String, String> headers = incoming == null ? new HashMap<>() : new HashMap<>(incoming);
        if (!headers.containsKey("User-Agent")) {
            headers.put("User-Agent", USER_AGENT);
        }
        if (!headers.containsKey("Accept-Encoding")) {
            headers.put("Accept-Encoding", "identity");
        }
        try {
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) {
                headers.put("Cookie", cookie);
            }
        } catch (Throwable ignored) {
            /* CookieManager not ready */
        }
        return headers;
    }

    private void bumpChrome() {
        setChromeVisible(true);
        mainHandler.removeCallbacks(hideChromeRunnable);
        mainHandler.postDelayed(hideChromeRunnable, 5000);
    }

    private void restoreAvPrefs() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        videoZoom = prefs.getFloat("videoZoom", videoZoom);
        videoFill = prefs.getBoolean("videoFill", videoFill);
        audioDelayMs = prefs.getInt("audioDelayMs", audioDelayMs);
        repeatMode = prefs.getInt("repeatMode", repeatMode);
        if (ratingKey == null || ratingKey.isEmpty()) return;
        String key = prefsKey();
        if (prefs.contains(key + ":delay")) {
            audioDelayMs = Math.max(0, Math.min(1000, prefs.getInt(key + ":delay", audioDelayMs)));
        }
        String savedAudio = prefs.getString(key + ":audio", null);
        String savedSub = prefs.getString(key + ":sub", null);
        String savedAudioLang = prefs.getString(key + ":audioLang", "");
        String savedSubLang = prefs.getString(key + ":subLang", null);
        String matchedAudio = matchTrackIdByLang(audioTracks, savedAudioLang);
        if (matchedAudio != null) audioStreamId = matchedAudio;
        if (savedSubLang != null) {
            if (savedSubLang.isEmpty() || "off".equalsIgnoreCase(savedSubLang)) {
                subtitleStreamId = "";
            } else {
                String matchedSub = matchTrackIdByLang(subtitles, savedSubLang);
                if (matchedSub != null) subtitleStreamId = matchedSub;
            }
        }
    }

    private void saveAvPrefs() {
        if (ratingKey == null || ratingKey.isEmpty()) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String key = prefsKey();
        prefs.edit()
            .putString(key + ":audio", audioStreamId == null ? "" : audioStreamId)
            .putString(key + ":sub", subtitleStreamId == null ? "" : subtitleStreamId)
            .putString(key + ":audioLang", TrackRules.trackLangKey(labelFor(audioTracks, audioStreamId)))
            .putString(key + ":subLang", subtitleStreamId == null || subtitleStreamId.isEmpty()
                ? "off"
                : TrackRules.trackLangKey(labelFor(subtitles, subtitleStreamId)))
            .putInt(key + ":delay", audioDelayMs)
            .apply();
    }

    private void persistSleepPrefs() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putLong("sleepUntil", sleepUntilElapsedRealtime)
            .putBoolean("sleepEndOfEpisode", sleepEndOfEpisode)
            .putInt("sleepEpisodesRemaining", sleepEpisodesRemaining)
            .putBoolean("sleepEpisodeLimit", sleepEpisodeLimit)
            .putBoolean("sleepAtCredits", sleepAtCredits)
            .apply();
    }

    private void restoreSleepPrefs() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        sleepUntilElapsedRealtime = prefs.getLong("sleepUntil", 0);
        if (sleepUntilElapsedRealtime > 0 && SystemClock.elapsedRealtime() >= sleepUntilElapsedRealtime) {
            sleepUntilElapsedRealtime = 0;
        }
        sleepEndOfEpisode = prefs.getBoolean("sleepEndOfEpisode", false);
        sleepEpisodesRemaining = prefs.getInt("sleepEpisodesRemaining", 0);
        sleepEpisodeLimit = prefs.getBoolean("sleepEpisodeLimit", false);
        sleepAtCredits = prefs.getBoolean("sleepAtCredits", false);
    }

    private void clearSleepPrefs() {
        sleepUntilElapsedRealtime = 0;
        sleepEndOfEpisode = false;
        sleepEpisodesRemaining = 0;
        sleepEpisodeLimit = false;
        sleepAtCredits = false;
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .remove("sleepUntil")
            .remove("sleepEndOfEpisode")
            .remove("sleepEpisodesRemaining")
            .remove("sleepEpisodeLimit")
            .remove("sleepAtCredits")
            .apply();
    }

    private void flashModeChip() {
        updateModeChip();
    }

    /**
     * Ask PMS what this HLS session transcodes (GET /transcode/sessions, JSON), then show it on
     * the badge: "Transcoding video, audio, subs", or "Direct Stream" when everything is copied.
     * A session can take a moment to appear, so it retries a few times.
     */
    private void refreshTranscodeDetail() {
        final String url = currentUrl;
        if (!PlaybackUrls.isTranscodeUrl(url) || url.equals(transcodeDetailUrl)) return;
        transcodeDetailUrl = url;
        transcodeDetail = "";
        final int gen = ++transcodeDetailGen;
        final Uri parsed;
        try {
            parsed = Uri.parse(url);
        } catch (RuntimeException ignored) {
            return;
        }
        final String token = firstNonEmpty(parsed.getQueryParameter("X-Plex-Token"), parsed.getQueryParameter("access_token"));
        final String session = firstNonEmpty(parsed.getQueryParameter("session"), parsed.getQueryParameter("X-Plex-Session-Identifier"));
        if (token.isEmpty() || session.isEmpty() || parsed.getScheme() == null || parsed.getAuthority() == null) return;
        final String sessionsUrl = parsed.getScheme() + "://" + parsed.getAuthority()
            + "/transcode/sessions?X-Plex-Token=" + Uri.encode(token);
        fetchTranscodeDetail(sessionsUrl, session, gen, 0);
    }

    private void fetchTranscodeDetail(String sessionsUrl, String session, int gen, int attempt) {
        TIMELINE_EXECUTOR.execute(() -> {
            String label = null;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(sessionsUrl).openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setRequestProperty("Accept", "application/json");
                InputStream in = conn.getInputStream();
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                label = transcodeDetailLabel(new JSONObject(out.toString("UTF-8")), session);
            } catch (Exception ignored) {
                /* unknown: keep the generic badge */
            } finally {
                if (conn != null) conn.disconnect();
            }
            final String found = label;
            mainHandler.post(() -> {
                if (gen != transcodeDetailGen) return;
                if (found != null) {
                    transcodeDetail = found;
                    updateModeChip();
                } else if (attempt < 4) {
                    mainHandler.postDelayed(() -> {
                        if (gen == transcodeDetailGen) fetchTranscodeDetail(sessionsUrl, session, gen, attempt + 1);
                    }, 2500);
                }
            });
        });
    }

    /** Badge text for our session in a /transcode/sessions response, or null when it is not listed yet. */
    @Nullable
    private String transcodeDetailLabel(JSONObject root, String session) {
        JSONObject container = root.optJSONObject("MediaContainer");
        JSONArray rows = container == null ? null : container.optJSONArray("TranscodeSession");
        if (rows == null) return null;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row == null) continue;
            String key = row.optString("key", "");
            if (!key.endsWith("/" + session) && !key.equals(session)) continue;
            List<String> parts = new ArrayList<>();
            if ("transcode".equalsIgnoreCase(row.optString("videoDecision", ""))) parts.add(getString(R.string.player_transcode_video));
            if ("transcode".equalsIgnoreCase(row.optString("audioDecision", ""))) parts.add(getString(R.string.player_transcode_audio));
            String subs = row.optString("subtitleDecision", "");
            if ("burn".equalsIgnoreCase(subs) || "transcode".equalsIgnoreCase(subs)) parts.add(getString(R.string.player_transcode_subs));
            if (parts.isEmpty()) return getString(R.string.player_direct_stream);
            return getString(R.string.player_transcoding_parts, TextUtils.join(", ", parts));
        }
        return null;
    }

    private static String firstNonEmpty(@Nullable String a, @Nullable String b) {
        if (a != null && !a.trim().isEmpty()) return a.trim();
        if (b != null && !b.trim().isEmpty()) return b.trim();
        return "";
    }

    /** Persistent OSD badge: Direct Play / Direct Stream / Transcode (+ quality). */
    private void updateModeChip() {
        if (modeChipView == null) return;
        refreshTranscodeDetail();
        if (musicMode) {
            modeChipView.setVisibility(View.GONE);
            return;
        }
        String label = playbackModeLabel();
        if (label == null || label.trim().isEmpty()) {
            modeChipView.setVisibility(View.GONE);
            return;
        }
        String quality = currentQualityLabel();
        // Keep the pill short on the transport row — mode only; quality lives in Settings.
        modeChipView.setText(label);
        modeChipView.setVisibility(View.VISIBLE);
        modeChipView.setContentDescription(quality.isEmpty() ? label : (label + " · " + quality));
        updateResolutionChip();
    }

    /** Badge beside the delivery mode: resolution of the video actually playing (4K, 1080p, …). */
    private void updateResolutionChip() {
        if (resolutionChipView == null) return;
        String label = musicMode || player == null ? "" : resolutionLabel(player.getVideoSize());
        boolean modeShown = modeChipView != null && modeChipView.getVisibility() == View.VISIBLE;
        if (label.isEmpty()) {
            resolutionChipView.setVisibility(View.GONE);
            return;
        }
        resolutionChipView.setText(label);
        resolutionChipView.setVisibility(View.VISIBLE);
        // No gap to the left when it is the only badge.
        ViewGroup.LayoutParams params = resolutionChipView.getLayoutParams();
        if (params instanceof ViewGroup.MarginLayoutParams) {
            int start = modeShown ? Math.round(8 * getResources().getDisplayMetrics().density) : 0;
            ((ViewGroup.MarginLayoutParams) params).setMarginStart(start);
            resolutionChipView.setLayoutParams(params);
        }
    }

    /** Wide frames (1920x800 scope) go by width, 4:3 HD (1440x1080) by height. */
    static String resolutionLabel(@Nullable VideoSize size) {
        if (size == null || size.width <= 0 || size.height <= 0) return "";
        int w = size.width;
        int h = size.height;
        if (w >= 3200 || h >= 1800) return "4K";
        if (w >= 2200 || h >= 1300) return "1440p";
        if (w >= 1700 || h >= 900) return "1080p";
        if (w >= 1100 || h >= 650) return "720p";
        if (h >= 540) return "576p";
        return "SD";
    }

    @Nullable
    private String nextLowerQualityId() {
        String current = qualityId == null || qualityId.isEmpty() ? "original" : qualityId.trim();
        int idx = -1;
        for (int i = 0; i < QUALITY_LADDER.length; i++) {
            if (QUALITY_LADDER[i].equalsIgnoreCase(current)) {
                idx = i;
                break;
            }
        }
        if (idx < 0) {
            // Unknown / auto — first step down from original.
            return "1080-12";
        }
        if (idx >= QUALITY_LADDER.length - 1) return null;
        return QUALITY_LADDER[idx + 1];
    }

    private String qualityLadderLabel(String id) {
        if (id == null || id.isEmpty()) return "";
        for (OptionItem row : qualities) {
            if (id.equals(row.id)) return row.label;
        }
        if ("original".equalsIgnoreCase(id)) return getString(R.string.player_direct_play);
        return id.replace("-", " · ");
    }

    private void maybeQualityNudge() {
        if (musicMode || player == null) return;
        if (qualityNudgeOffered && !autoQuality) return;
        // A seek buffer is not a reason to drop quality or start a transcode.
        if (seekingUi || android.os.SystemClock.elapsedRealtime() - lastSeekAtMs < 12_000) {
            bufferingStreakSec = 0;
            return;
        }
        if (streamSwapInFlight || userPaused || !player.getPlayWhenReady()
            || player.getPlaybackState() != Player.STATE_BUFFERING) {
            bufferingStreakSec = 0;
            return;
        }
        bufferingStreakSec += 1;
        if (autoQuality) {
            maybeAutoLowerQuality();
            return;
        }
        if (bufferingStreakSec < 10) return;
        String next = nextLowerQualityId();
        if (next == null || next.equalsIgnoreCase(qualityId)) {
            qualityNudgeOffered = true;
            return;
        }
        qualityNudgeOffered = true;
        bufferingStreakSec = 0;
        final String dropTo = next;
        String label = qualityLadderLabel(dropTo);
        String[] choices = {
            getString(R.string.player_quality_nudge_yes),
            getString(R.string.player_quality_nudge_no),
        };
        toast(getString(R.string.player_quality_nudge_body, label));
        showOptionSheet(
            getString(R.string.player_quality_nudge_title),
            choices,
            0,
            which -> {
                if (which != 0) return;
                qualityId = dropTo;
                updateChipLabels();
                flashModeChip();
                requestStreamChange(dropTo, audioStreamId, subtitleStreamId, mediaIndex);
            }
        );
    }

    /**
     * Auto-lower quality: after ~6s stuck buffering, drop one step on the ladder without
     * asking. A cooldown lets the new stream settle before it can step down again.
     */
    private void maybeAutoLowerQuality() {
        if (bufferingStreakSec < 6) return;
        long now = android.os.SystemClock.elapsedRealtime();
        if (lastAutoQualityDropAt > 0 && now - lastAutoQualityDropAt < AUTO_QUALITY_COOLDOWN_MS) return;
        String next = nextLowerQualityId();
        if (next == null || next.equalsIgnoreCase(qualityId)) return;
        lastAutoQualityDropAt = now;
        bufferingStreakSec = 0;
        qualityId = next;
        updateChipLabels();
        flashModeChip();
        toast(getString(R.string.player_quality_auto_lowered, qualityLadderLabel(next)));
        requestStreamChange(next, audioStreamId, subtitleStreamId, mediaIndex);
    }

    private static String matchTrackIdByLang(List<OptionItem> tracks, String langKey) {
        String want = TrackRules.trackLangKey(langKey);
        if (want.isEmpty() || tracks == null || tracks.isEmpty()) return null;
        for (OptionItem track : tracks) {
            if (want.equals(TrackRules.trackLangKey(track.label))) return track.id;
        }
        return null;
    }

    private String prefsKey() {
        return (showKey != null && !showKey.isEmpty()) ? ("show:" + showKey) : ("item:" + ratingKey);
    }

    private long contentPositionMs() {
        if (scrubTargetMs >= 0) return scrubTargetMs;
        long pos = player != null ? Math.max(0, player.getCurrentPosition()) : 0;
        return Math.max(0, timelineOriginMs + pos);
    }

    private long contentDurationMs() {
        if (durationHintMs > 0) return durationHintMs;
        long playerDuration = player != null ? player.getDuration() : 0;
        if (playerDuration > 0) return timelineOriginMs + playerDuration;
        return 0;
    }

    private boolean shouldRestartForSeek() {
        // Direct Play seeks inside the open file. Rebuilding the session on each
        // scrub starts another transcode and is what takes the server down.
        return PlaybackUrls.isTranscodeUrl(currentUrl);
    }

    /**
     * Some Plex playlists already report the resume time as the player position.
     * Adding that same offset again shows 58:14 when the title was stopped at 29:07.
     */
    private void reconcileTranscodeOrigin() {
        if (transcodeAnchorMs < 5000 || player == null || !PlaybackUrls.isTranscodeUrl(currentUrl)) return;
        long playerPos = Math.max(0, player.getCurrentPosition());
        long anchor = transcodeAnchorMs;
        if (playerPos + 3000 < anchor) return;
        transcodeAnchorMs = 0;
        if (playerPos > anchor + anchor / 2) {
            timelineOriginMs = 0;
            lastSeekTargetMs = anchor;
            lastSeekAtMs = android.os.SystemClock.elapsedRealtime();
            seekRecoveryUsed = false;
            player.seekTo(anchor);
            return;
        }
        timelineOriginMs = 0;
    }

    private void markStreamSwap() {
        streamSwapInFlight = true;
        mainHandler.removeCallbacks(clearSwapRunnable);
        mainHandler.postDelayed(clearSwapRunnable, 8000);
    }

    private boolean isSeekIoError(PlaybackException error) {
        int code = error.errorCode;
        return code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
            || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || code == PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE;
    }

    /**
     * A seek that hits a rejected range or a dead transcode segment reloads
     * once at that timestamp. Errors from the stream being replaced are ignored.
     */
    private boolean trySeekRecovery(PlaybackException error) {
        if (!isSeekIoError(error)) return false;
        if (streamSwapInFlight && PlaybackUrls.isTranscodeUrl(currentUrl)) return true;
        if (lastSeekTargetMs < 0 || player == null) return false;
        if (android.os.SystemClock.elapsedRealtime() - lastSeekAtMs > 12000) return false;
        playbackError = false;
        hideError();
        if (!PlaybackUrls.isTranscodeUrl(currentUrl)) {
            // Stay on the file already open. A second session is what crashes PMS.
            if (!seekRecoveryUsed) {
                seekRecoveryUsed = true;
                long target = Math.max(0, lastSeekTargetMs - timelineOriginMs);
                player.setSeekParameters(SeekParameters.CLOSEST_SYNC);
                player.seekTo(target);
                try {
                    player.prepare();
                } catch (Throwable ignored) {
                    /* already prepared */
                }
                if (!userPaused) {
                    player.setPlayWhenReady(true);
                    try {
                        player.play();
                    } catch (Throwable ignored) {
                        /* ignore */
                    }
                }
            }
            return true;
        }
        if (seekRecoveryUsed) return true;
        seekRecoveryUsed = true;
        long target = lastSeekTargetMs;
        scrubTargetMs = target;
        scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 8000;
        markStreamSwap();
        requestStreamChange(qualityId, audioStreamId, subtitleStreamId, mediaIndex, target, "seek");
        return true;
    }

    private void seekToContent(long contentMs, boolean immediate) {
        long duration = contentDurationMs();
        long target = Math.max(0, contentMs);
        if (duration > 0) target = Math.min(target, Math.max(0, duration - 1500));
        scrubTargetMs = target;
        lastSeekTargetMs = target;
        lastSeekAtMs = android.os.SystemClock.elapsedRealtime();
        if (!streamSwapInFlight) seekRecoveryUsed = false;
        seekingUi = true;
        if (duration > 0 && seekBar != null) {
            seekBar.setProgress((int) Math.min(1000, Math.max(0, (target * 1000L) / duration)));
        }
        if (timeView != null) {
            setTimeLabels(target, Math.max(0, duration));
        }
        bumpChrome();
        if (shouldRestartForSeek()) {
            scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 8000;
            pendingTranscodeSeekMs = target;
            mainHandler.removeCallbacks(transcodeSeekRunnable);
            // Never stack stream rebuilds while one is in flight — that mints ghost
            // Now Playing sessions on PMS. Coalesce to the latest target instead.
            if (streamSwapInFlight) return;
            // Debounce even "immediate" scrub releases so rapid seeks share one restart.
            mainHandler.postDelayed(transcodeSeekRunnable, immediate ? 180 : 400);
            return;
        }
        scrubHoldUntilMs = android.os.SystemClock.elapsedRealtime() + 1600;
        mainHandler.removeCallbacks(directSeekRunnable);
        if (immediate) directSeekRunnable.run();
        else mainHandler.postDelayed(directSeekRunnable, 200);
    }

    /** Seek the already-open file to the resume point. One arm only. */
    private void armPlayThenSeek() {
        if (player == null || finishing || userPaused) return;
        if (playThenSeekMs <= 1500 || playThenSeekArmed) return;
        playThenSeekArmed = true;
        mainHandler.removeCallbacks(playThenSeekRunnable);
        mainHandler.postDelayed(playThenSeekRunnable, 350);
    }

    private void queueStartPosition(String url, long offsetMs) {
        if (player == null) return;
        MediaItem item = buildMediaItem(url);
        long start = Math.max(0, offsetMs);
        if (PlaybackUrls.isTranscodeUrl(url)) {
            playThenSeekMs = -1;
            playThenSeekArmed = false;
            resumeFrameSeen = false;
            mainHandler.removeCallbacks(playThenSeekRunnable);
            timelineOriginMs = start;
            transcodeAnchorMs = start;
            player.setMediaItem(item);
            return;
        }
        timelineOriginMs = 0;
        transcodeAnchorMs = 0;
        playThenSeekMs = -1;
        playThenSeekArmed = false;
        resumeFrameSeen = false;
        mainHandler.removeCallbacks(playThenSeekRunnable);
        // One range, at the resume offset. Opening at 0 and then seeking aborts
        // that read and starts another; the player then treats the glitch as a
        // failed Direct Play and opens a transcode on top of it. That second
        // session is what crashes PMS.
        if (start > 0) player.setMediaItem(item, start);
        else player.setMediaItem(item);
    }

    private MediaItem buildMediaItem(String url) {
        MediaItem.Builder builder = new MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMediaMetadata(sessionMetadata());
        String lower = url.toLowerCase(Locale.US);
        if (lower.contains(".m3u8") || lower.contains("/hls/")) {
            builder.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        if (sidecarSubtitleUrl != null && !sidecarSubtitleUrl.trim().isEmpty()) {
            String codec = sidecarSubtitleCodec == null ? "" : sidecarSubtitleCodec.toLowerCase(Locale.US);
            String mime = sidecarSubtitleUrl.toLowerCase(Locale.US).contains(".vtt") || codec.equals("vtt") || codec.equals("webvtt")
                ? MimeTypes.TEXT_VTT
                : (codec.equals("ass") || codec.equals("ssa") ? MimeTypes.TEXT_SSA : MimeTypes.APPLICATION_SUBRIP);
            builder.setSubtitleConfigurations(Collections.singletonList(
                new MediaItem.SubtitleConfiguration.Builder(Uri.parse(sidecarSubtitleUrl))
                    .setId(SIDECAR_TEXT_ID)
                    .setMimeType(mime)
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                    .build()
            ));
        }
        return builder.build();
    }

    private MediaMetadata sessionMetadata() {
        return PlayerSessionController.metadata(titleText, subtitleText, artUrl);
    }

    /**
     * ExoPlayer reports ERROR_CODE_IO_BAD_HTTP_STATUS when the portal returns JSON
     * (409 Direct Play refused, 502 transcode). Switch file→HLS, then Original→1080p.
     * plexDirect Direct Play uses /library/parts/ — rewrite that to a PMS HLS session.
     */
    private boolean tryStreamFallback(PlaybackException error) {
        int code = error.errorCode;
        boolean io = code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
            || code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            || code == PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE
            || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED
            || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED
            || code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
            || code == PlaybackException.ERROR_CODE_DECODING_FAILED;
        if (!io || currentUrl == null || currentUrl.isEmpty()) return false;
        // Direct Play stays on the open file. A decoder or seek glitch must not
        // open /video/:/transcode/universal/start.m3u8 — that second session
        // crashes PMS. Only an HTTP refusal (the server rejected the file) may
        // move to HLS, and applyUpdateSrc stops the file read first.
        if (!PlaybackUrls.isTranscodeUrl(currentUrl) && code != PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            return false;
        }
        String next = null;
        if (currentUrl.contains("/library/parts/") && streamFallbackStage < 1) {
            streamFallbackStage = 1;
            next = partsUrlToPmsHls(currentUrl, ratingKey, mediaIndex, contentPositionMs());
        } else if (currentUrl.contains("/file/") && streamFallbackStage < 1) {
            streamFallbackStage = 1;
            next = PlaybackUrls.fileUrlToHls(currentUrl);
        } else if ((currentUrl.contains("/hls/") || currentUrl.contains(".m3u8")) && streamFallbackStage < 2) {
            streamFallbackStage = 2;
            next = PlaybackUrls.withHlsQuality(currentUrl, "1080-12");
        }
        // Already on a PMS transcode playlist with nowhere left to go.
        if (next == null && currentUrl.contains("/video/:/transcode/")) return false;
        if (next == null || next.equals(currentUrl)) return false;
        Log.w(TAG, "Stream fallback → " + PlaybackUrls.summarizeUrl(next));
        long offset = contentPositionMs();
        applyUpdateSrc(next, headersJson, offset, false);
        return true;
    }

    /** Direct Play fallback to PMS HLS with this session's timeline credentials. See PlaybackUrls. */
    @Nullable
    private String partsUrlToPmsHls(String partUrl, String key, int mediaIdx, long offsetMs) {
        return PlaybackUrls.partsUrlToPmsHls(
            partUrl, key, mediaIdx, offsetMs,
            timelineReporter.origin, timelineReporter.token, timelineReporter.clientId,
            timelineReporter.sessionId, audioStreamId
        );
    }

    private static String formatClock(long ms) {
        long totalSec = Math.max(0, ms / 1000);
        long h = totalSec / 3600;
        long m = (totalSec % 3600) / 60;
        long s = totalSec % 60;
        if (h > 0) return String.format(Locale.US, "%d:%02d:%02d", h, m, s);
        return String.format(Locale.US, "%d:%02d", m, s);
    }

    private void updateWallClock() {
        if (clockView == null) return;
        Calendar cal = Calendar.getInstance();
        int hour = cal.get(Calendar.HOUR);
        if (hour == 0) hour = 12;
        int minute = cal.get(Calendar.MINUTE);
        String amPm = cal.get(Calendar.AM_PM) == Calendar.AM ? "AM" : "PM";
        String label = String.format(Locale.US, "%d:%02d %s", hour, minute, amPm);
        if (label.equals(lastClockLabel)) return;
        lastClockLabel = label;
        clockView.setText(label);
    }

    private boolean inPictureInPicture() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode();
    }

    private void setClockVisible(boolean visible) {
        if (clockView == null) return;
        clockView.setVisibility(visible && !inPictureInPicture() ? View.VISIBLE : View.GONE);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode);
        setClockVisible(chromeVisible && !isInPictureInPictureMode);
    }

    private void toast(String msg) {
        try {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {
            /* ignore */
        }
    }

    private void finishForPlayNext() {
        if (nextRatingKey == null || nextRatingKey.isEmpty()) return;
        if (shouldStopForSleepEpisodes()) {
            clearSleepPrefs();
            finishWithResult(true, false);
            return;
        }
        persistSleepPrefs();
        finishWithResult(true, true);
    }

    private void finishForPlayPrevious() {
        if (previousRatingKey == null || previousRatingKey.isEmpty()) return;
        finishWithResult(false, false, true);
    }

    private void applyEpisodeNavButtons() {
        boolean hasPrev = previousRatingKey != null && !previousRatingKey.isEmpty();
        boolean hasNext = nextRatingKey != null && !nextRatingKey.isEmpty();
        if (prevEpisodeBtn != null) {
            prevEpisodeBtn.setVisibility(hasPrev ? View.VISIBLE : View.GONE);
            prevEpisodeBtn.setEnabled(hasPrev);
        }
        if (nextEpisodeBtn != null) {
            nextEpisodeBtn.setVisibility(hasNext ? View.VISIBLE : View.GONE);
            nextEpisodeBtn.setEnabled(hasNext);
        }
        if (playPauseBtn != null) {
            playPauseBtn.setNextFocusLeftId(hasPrev ? R.id.player_prev_episode : View.NO_ID);
            playPauseBtn.setNextFocusRightId(hasNext ? R.id.player_next_episode : R.id.player_settings);
        }
        if (settingsBtn != null) {
            settingsBtn.setNextFocusLeftId(hasNext ? R.id.player_next_episode : R.id.player_play_pause);
        }
    }

    private void requestPlayNextWithoutFinish() {
        if (nextRatingKey == null || nextRatingKey.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("ratingKey", nextRatingKey);
        PlayerBridge.get().emit("playNext", data);
    }

    void skipNextFromPlugin() {
        if (nextRatingKey == null || nextRatingKey.isEmpty()) return;
        if (musicMode) requestPlayNextWithoutFinish();
        else finishForPlayNext();
    }

    boolean isMinimized() {
        return minimized;
    }

    void minimizeToBrowse() {
        if (!musicMode) {
            finishWithResult(false, false);
            return;
        }
        minimized = true;
        PlayerBridge.get().setPlayerForeground(false);
        JSObject data = new JSObject();
        data.put("positionMs", contentPositionMs());
        data.put("durationMs", contentDurationMs());
        data.put("state", player != null && player.isPlaying() ? "playing" : "paused");
        data.put("ratingKey", ratingKey);
        data.put("title", titleText);
        data.put("subtitle", subtitleText);
        PlayerBridge.get().emit("minimized", data);
        try {
            Intent home = new Intent(this, MainActivity.class);
            home.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(home);
        } catch (Throwable ignored) {
            minimized = false;
            finishWithResult(false, false);
        }
    }

    void markRestored() {
        minimized = false;
        PlayerBridge.get().setPlayerForeground(true);
        JSObject data = new JSObject();
        data.put("state", player != null && player.isPlaying() ? "playing" : "paused");
        PlayerBridge.get().emit("restored", data);
    }

    void finishFromPlugin() {
        finishWithResult(false, false);
    }

    private void finishWithResult(boolean ended, boolean playNext) {
        finishWithResult(ended, playNext, false);
    }

    private void finishWithResult(boolean ended, boolean playNext, boolean playPrevious) {
        if (finishing) return;
        finishing = true;
        mainHandler.removeCallbacks(tickRunnable);
        mainHandler.removeCallbacks(progressEmitRunnable);
        hideStatsOverlay();
        mainHandler.removeCallbacks(hideChromeRunnable);
        long positionMs = 0L;
        if (player != null) {
            try {
                positionMs = contentPositionMs();
                emitProgress("stopped");
                player.setPlayWhenReady(false);
            } catch (Throwable ignored) {
                /* player already torn down */
            }
        }
        boolean endedOut = ended || playbackEnded;
        boolean errorOut = playbackError && !ended && !playbackEnded;

        JSObject closed = new JSObject();
        closed.put("ended", endedOut);
        closed.put("positionMs", positionMs);
        closed.put("error", errorOut);
        closed.put("playNext", playNext);
        if (playNext && nextRatingKey != null && !nextRatingKey.isEmpty()) {
            closed.put("nextRatingKey", nextRatingKey);
        }
        closed.put("playPrevious", playPrevious);
        if (playPrevious && previousRatingKey != null && !previousRatingKey.isEmpty()) {
            closed.put("previousRatingKey", previousRatingKey);
        }
        PlayerBridge.get().setPlayerForeground(false);
        PlayerBridge.get().keepHostWebViewAlive();
        PlayerBridge.get().emit("closed", closed);
        if (shouldMarkWatched(positionMs, endedOut)) {
            scrobbleWatched();
            pingPlexTimeline("stopped", 0L);
        } else {
            pingPlexTimeline("stopped");
        }

        // Hide the surface immediately so the WebView behind is visible while
        // Android tears this activity down — otherwise the user sees a lingering
        // black screen for up to a second on TV.
        PlayerView playerView = findViewById(R.id.player_view);
        if (playerView != null) playerView.setVisibility(View.GONE);
        View root = findViewById(android.R.id.content);
        if (root != null) root.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        try {
            getWindow().getDecorView().setBackgroundColor(android.graphics.Color.TRANSPARENT);
        } catch (Throwable ignored) { /* ignore */ }

        Intent data = new Intent();
        data.putExtra(EXTRA_ENDED, endedOut);
        data.putExtra(EXTRA_POSITION_MS, positionMs);
        data.putExtra(EXTRA_ERROR, errorOut);
        data.putExtra(EXTRA_PLAY_NEXT, playNext);
        if (playNext && nextRatingKey != null) {
            data.putExtra(EXTRA_NEXT_RATING_KEY, nextRatingKey);
        }
        data.putExtra(EXTRA_PLAY_PREVIOUS, playPrevious);
        if (playPrevious && previousRatingKey != null) {
            data.putExtra(EXTRA_PREVIOUS_RATING_KEY, previousRatingKey);
        }
        setResult(RESULT_OK, data);

        // Always bring the WebView host forward before teardown — including
        // autoplay-next — so binge chains are not stuck on a black player
        // window while JS starts the next episode (Back was dead during that gap).
        if (!musicMode) {
            try {
                Intent home = new Intent(this, MainActivity.class);
                home.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(home);
            } catch (Throwable ignored) {
                /* host may already be finishing */
            }
        }

        finish();
        try {
            overridePendingTransition(0, 0);
        } catch (Throwable ignored) {
            /* some TV firmwares reject this */
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        PlayerKeyHandler.Result result = keyHandler.dispatchKeyEvent(event);
        if (result == PlayerKeyHandler.Result.SUPER) return super.dispatchKeyEvent(event);
        return result == PlayerKeyHandler.Result.HANDLED;
    }

    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        PlayerKeyHandler.Result result = keyHandler.onKeyLongPress(keyCode);
        if (result == PlayerKeyHandler.Result.SUPER) return super.onKeyLongPress(keyCode, event);
        return result == PlayerKeyHandler.Result.HANDLED;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        PlayerKeyHandler.Result result = keyHandler.onKeyDown(keyCode, event);
        if (result == PlayerKeyHandler.Result.SUPER) return super.onKeyDown(keyCode, event);
        return result == PlayerKeyHandler.Result.HANDLED;
    }

    private boolean isPlaybackConfirmTarget() {
        View focus = getCurrentFocus();
        if (focus == playPauseBtn || focus == seekBar) return true;
        if (focus == null) return true;
        int id = focus.getId();
        return id == R.id.player_root || id == R.id.player_view;
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        PlayerKeyHandler.Result result = keyHandler.onKeyUp(keyCode);
        if (result == PlayerKeyHandler.Result.SUPER) return super.onKeyUp(keyCode, event);
        return result == PlayerKeyHandler.Result.HANDLED;
    }

    @Override
    protected void onStart() {
        super.onStart();
        PlayerBridge.get().keepHostWebViewAlive();
        if (player != null && !userPaused) player.setPlayWhenReady(true);
        if (finishing) return;
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null && !finishing && !minimized && !isInPictureInPictureMode()) {
            try {
                player.pause();
                emitProgress("paused");
            } catch (Throwable ignored) {
                /* ignore */
            }
        }
    }

    @Override
    protected void onDestroy() {
        PlayerBridge.get().detachActivity(this);
        logoLoadGeneration += 1;
        pendingLogoUrl = "";
        loadedLogoUrl = "";
        try {
            logoExecutor.shutdownNow();
        } catch (Throwable ignored) {
            /* ignore */
        }
        mainHandler.removeCallbacksAndMessages(null);
        sessionController.release();
        PlayerView playerView = findViewById(R.id.player_view);
        if (playerView != null) playerView.setPlayer(null);
        if (menuScrim != null) menuScrim.setVisibility(View.GONE);
        if (menuList != null) menuList.removeAllViews();
        final ExoPlayer exiting = player;
        player = null;
        super.onDestroy();
        if (exiting != null) {
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    exiting.release();
                } catch (Throwable ignored) {
                    /* ignore */
                }
            });
        }
    }
}
