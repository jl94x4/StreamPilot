package com.servermanagerportal.mediaplayer;

import androidx.annotation.Nullable;
import androidx.media3.common.Format;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Audio / subtitle track rules for {@link PlayerActivity}: burn-in, codec and language matching. */
final class TrackRules {
    private TrackRules() {}

    private static final Pattern LABEL_FORMAT = Pattern.compile("\\(([^)]+)\\)\\s*$");

    /** Short OSD name for a Plex subtitle codec, matching the web subtitleFormatName list. */
    static String subtitleFormatBadge(@Nullable String codec, @Nullable String label) {
        String named = subtitleFormatName(codec);
        if (!named.isEmpty()) return named;
        if (label == null) return "";
        Matcher match = LABEL_FORMAT.matcher(label.trim());
        if (!match.find()) return "";
        String inner = match.group(1).trim();
        if (inner.isEmpty()) return "";
        String first = inner.split("\\s+")[0];
        named = subtitleFormatName(first);
        if (!named.isEmpty()) return named;
        return inner.length() <= 10 ? inner.toUpperCase(Locale.US) : "";
    }

    static String subtitleFormatName(@Nullable String codec) {
        if (codec == null) return "";
        String raw = codec.trim().toLowerCase(Locale.US).replace('-', '_');
        if (raw.isEmpty()) return "";
        if (raw.contains("pgs") || raw.equals("hdmv") || raw.equals("hdmv_pgs_subtitle")) return "PGS";
        if (raw.equals("srt") || raw.equals("subrip") || raw.contains("utf8") || raw.contains("utf_8")) return "SRT";
        if (raw.equals("ass")) return "ASS";
        if (raw.equals("ssa")) return "SSA";
        if (raw.contains("vobsub") || raw.equals("dvd") || raw.equals("dvdsub") || raw.equals("dvd_subtitle")) return "VOBSUB";
        if (raw.equals("mov_text") || raw.equals("tx3g")) return "TX3G";
        if (raw.equals("webvtt") || raw.equals("vtt")) return "VTT";
        if (raw.equals("smi")) return "SMI";
        if (raw.contains("eia_608") || raw.contains("eia_708") || raw.equals("eia608") || raw.equals("eia708")) return "CC";
        if (raw.contains("dvb")) return "DVB";
        return "";
    }

    static boolean isImageSubtitle(@Nullable String codec) {
        if (codec == null) return false;
        return codec.trim().matches("(?i)pgs|hdmv|hdmv_pgs_subtitle|vobsub|dvd|dvdsub|dvd_subtitle|image|bluray|dvbsub|dvb_subtitle|xsub");
    }

    /**
     * "auto": ExoPlayer draws text (SRT, ASS/SSA) and in-file PGS / VobSub / DVB itself, like
     * Plex's own Android apps, so only the picture formats it can't draw are burned in.
     * "image" burns every picture format; "always" burns everything.
     */
    static boolean subtitleCodecNeedsBurn(@Nullable String codec, @Nullable String burnSubtitles) {
        if (codec == null || codec.trim().isEmpty()) return false;
        String policy = burnSubtitles == null ? "auto" : burnSubtitles;
        if ("always".equals(policy)) return true;
        boolean image = isImageSubtitle(codec);
        if ("image".equals(policy)) return image;
        boolean exoDraws = codec.trim().matches("(?i)pgs|hdmv|hdmv_pgs_subtitle|vobsub|dvd|dvdsub|dvd_subtitle|bluray|dvbsub|dvb_subtitle");
        return image && !exoDraws;
    }

    static boolean isBitstreamAudioCodec(@Nullable String codec) {
        if (codec == null || codec.trim().isEmpty()) return false;
        return codec.matches("(?i)truehd|mlp|dca|dts|dtsc|dtsh|dtshd|dtsma|dtsl");
    }

    static String normalizeLangTag(@Nullable String raw) {
        if (raw == null) return "";
        String lang = raw.trim().toLowerCase(Locale.US);
        if (lang.isEmpty()) return "";
        int dash = lang.indexOf('-');
        int under = lang.indexOf('_');
        int cut = dash > 0 ? dash : (under > 0 ? under : -1);
        return cut > 0 ? lang.substring(0, cut) : lang;
    }

    static String formatAudioCodec(@Nullable Format format) {
        if (format == null) return "";
        String mime = format.sampleMimeType == null ? "" : format.sampleMimeType.toLowerCase(Locale.US);
        String codecs = format.codecs == null ? "" : format.codecs.toLowerCase(Locale.US);
        String blob = mime + " " + codecs;
        // Media3 names TrueHD audio/true-hd; Plex and MKV codec ids say truehd.
        if (blob.contains("truehd") || blob.contains("true-hd") || blob.contains("mlp")) return "truehd";
        if (blob.contains("eac3") || blob.contains("ec-3") || blob.contains("ec+3")) return "eac3";
        if (blob.contains("ac3") || blob.contains("ac-3")) return "ac3";
        if (blob.contains("dts") || blob.contains("dca")) return "dts";
        if (blob.contains("flac")) return "flac";
        if (blob.contains("opus")) return "opus";
        if (blob.contains("mp4a") || blob.contains("aac")) return "aac";
        if (blob.contains("mp3") || blob.contains("mpeg")) return "mp3";
        return codecs.isEmpty() ? mime.replace("audio/", "") : codecs.split("[.,\\s]")[0];
    }

    /** OSD pill for the audio being decoded or passed through: AC3, EAC3 Atmos, TrueHD, DTS-HD … */
    static String audioCodecBadge(@Nullable Format format) {
        if (format == null) return "";
        String mime = format.sampleMimeType == null ? "" : format.sampleMimeType.toLowerCase(Locale.US);
        String codecs = format.codecs == null ? "" : format.codecs.toLowerCase(Locale.US);
        String codec = formatAudioCodec(format);
        switch (codec) {
            case "truehd": return "TrueHD";
            case "eac3": return mime.contains("joc") || codecs.contains("joc") ? "EAC3 Atmos" : "EAC3";
            case "ac3": return "AC3";
            case "dts":
                if (mime.contains("dts.uhd")) return "DTS:X";
                return mime.contains("dts.hd") ? "DTS-HD" : "DTS";
            case "flac": return "FLAC";
            case "opus": return "Opus";
            case "aac": return "AAC";
            case "mp3": return "MP3";
            default:
                if (mime.contains("raw") || mime.contains("pcm")) return "PCM";
                return codec.toUpperCase(Locale.US);
        }
    }

    /** OSD pill for the video being decoded: HEVC, H264, AV1, VP9, DV HEVC … */
    static String videoCodecBadge(@Nullable Format format) {
        if (format == null) return "";
        String mime = format.sampleMimeType == null ? "" : format.sampleMimeType.toLowerCase(Locale.US);
        String codecs = format.codecs == null ? "" : format.codecs.toLowerCase(Locale.US);
        if (mime.contains("dolby-vision")) {
            if (codecs.startsWith("dav1")) return "DV AV1";
            if (codecs.startsWith("dvav") || codecs.startsWith("dva1")) return "DV H264";
            return "DV HEVC";
        }
        if (mime.contains("hevc")) return "HEVC";
        if (mime.contains("avc")) return "H264";
        if (mime.contains("av01")) return "AV1";
        if (mime.contains("vp9")) return "VP9";
        if (mime.contains("vp8")) return "VP8";
        if (mime.contains("mpeg2")) return "MPEG2";
        if (mime.contains("mp4v")) return "MPEG4";
        if (mime.contains("vc1") || mime.contains("wvc1")) return "VC1";
        return mime.startsWith("video/") ? mime.substring(6).toUpperCase(Locale.US) : "";
    }

    static boolean audioCodecMatches(String formatCodec, String wantCodec) {
        String a = (formatCodec == null ? "" : formatCodec).toLowerCase(Locale.US);
        String b = (wantCodec == null ? "" : wantCodec).toLowerCase(Locale.US)
            .replace("ac-3", "ac3")
            .replace("ec-3", "eac3")
            .replace("ec+3", "eac3")
            .replace("mp4a", "aac")
            .replace("dca", "dts")
            .replace("true-hd", "truehd");
        if (a.isEmpty() || b.isEmpty()) return false;
        if (a.equals(b)) return true;
        if (b.startsWith("eac3") && a.contains("eac3")) return true;
        if (b.startsWith("ac3") && a.contains("ac3") && !a.contains("eac3")) return true;
        if (b.startsWith("truehd") && (a.contains("truehd") || a.contains("mlp"))) return true;
        if (b.startsWith("dts") && (a.contains("dts") || a.contains("dca"))) return true;
        // Dolby Digital (AC3) and Digital Plus (EAC3) are different tracks. Without this
        // the substring check below matches them, since "eac3" contains "ac3".
        if (a.contains("ac3") && b.contains("ac3") && a.contains("eac3") != b.contains("eac3")) return false;
        return a.contains(b) || b.contains(a);
    }

    /** Language part of a track label: "English · AC3 5.1" → "english". */
    static String trackLangKey(String label) {
        if (label == null) return "";
        String text = label.trim().toLowerCase(Locale.US);
        if (text.isEmpty()) return "";
        int cut = text.length();
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == ' ' || ch == '·' || ch == '(' || ch == '|' || ch == '/') {
                cut = i;
                break;
            }
        }
        return text.substring(0, cut).trim();
    }
}
