package com.servermanagerportal.mediaplayer;

import androidx.annotation.Nullable;
import androidx.media3.common.Format;

import java.util.Locale;

/** Audio / subtitle track rules for {@link PlayerActivity}: burn-in, codec and language matching. */
final class TrackRules {
    private TrackRules() {}

    /**
     * Whether a subtitle codec has to be burned in by the server.
     * burnSubtitles is the user policy: "always", "image" or "auto" (null = auto).
     */
    static boolean subtitleCodecNeedsBurn(@Nullable String codec, @Nullable String burnSubtitles) {
        if (codec == null || codec.trim().isEmpty()) return false;
        String policy = burnSubtitles == null ? "auto" : burnSubtitles;
        if ("always".equals(policy)) return true;
        boolean image = codec.matches("(?i)pgs|vobsub|dvd|dvdsub|image|bluray|dvbsub|xsub");
        if ("image".equals(policy)) return image;
        return image || codec.matches("(?i)ass|ssa");
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
