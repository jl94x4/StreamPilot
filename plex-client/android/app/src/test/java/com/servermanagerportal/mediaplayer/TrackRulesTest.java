package com.servermanagerportal.mediaplayer;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;

import org.junit.Test;

public class TrackRulesTest {

    @Test
    public void autoBurnsImageAndStyledSubtitlesButNotText() {
        assertTrue(TrackRules.subtitleCodecNeedsBurn("pgs", null));
        assertTrue(TrackRules.subtitleCodecNeedsBurn("VobSub", "auto"));
        assertTrue(TrackRules.subtitleCodecNeedsBurn("dvdsub", "auto"));
        assertTrue(TrackRules.subtitleCodecNeedsBurn("ass", "auto"));
        assertFalse(TrackRules.subtitleCodecNeedsBurn("srt", "auto"));
        assertFalse(TrackRules.subtitleCodecNeedsBurn("subrip", null));
        assertFalse(TrackRules.subtitleCodecNeedsBurn(" ", "always"));
        assertFalse(TrackRules.subtitleCodecNeedsBurn(null, "always"));
    }

    @Test
    public void burnPolicyAlwaysAndImageOnly() {
        assertTrue(TrackRules.subtitleCodecNeedsBurn("srt", "always"));
        assertTrue(TrackRules.subtitleCodecNeedsBurn("pgs", "image"));
        assertFalse(TrackRules.subtitleCodecNeedsBurn("ass", "image"));
        assertFalse(TrackRules.subtitleCodecNeedsBurn("srt", "image"));
    }

    @Test
    public void bitstreamAudioIsTrueHdAndDtsFamilies() {
        assertTrue(TrackRules.isBitstreamAudioCodec("truehd"));
        assertTrue(TrackRules.isBitstreamAudioCodec("DTSHD"));
        assertTrue(TrackRules.isBitstreamAudioCodec("dca"));
        assertFalse(TrackRules.isBitstreamAudioCodec("eac3"));
        assertFalse(TrackRules.isBitstreamAudioCodec("aac"));
        assertFalse(TrackRules.isBitstreamAudioCodec(null));
    }

    @Test
    public void normalizeLangTagKeepsTheLanguagePart() {
        assertEquals("en", TrackRules.normalizeLangTag(" en-GB "));
        assertEquals("pt", TrackRules.normalizeLangTag("pt_BR"));
        assertEquals("eng", TrackRules.normalizeLangTag("ENG"));
        assertEquals("", TrackRules.normalizeLangTag(null));
        assertEquals("", TrackRules.normalizeLangTag("  "));
    }

    @Test
    public void formatAudioCodecNamesTheCodecFromMimeOrCodecs() {
        assertEquals("eac3", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_E_AC3, null)));
        assertEquals("ac3", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_AC3, null)));
        // Current behaviour: Media3's TrueHD mime is audio/true-hd, which none of the
        // checks match, so it falls through to "true-hd" (not "truehd").
        assertEquals("true-hd", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_TRUEHD, null)));
        assertEquals("truehd", TrackRules.formatAudioCodec(audio("audio/x-matroska", "truehd")));
        assertEquals("dts", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_DTS_HD, null)));
        assertEquals("aac", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_AAC, "mp4a.40.2")));
        assertEquals("flac", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_FLAC, null)));
        assertEquals("vorbis", TrackRules.formatAudioCodec(audio(MimeTypes.AUDIO_VORBIS, null)));
        assertEquals("", TrackRules.formatAudioCodec(null));
    }

    @Test
    public void audioCodecMatchesAliases() {
        assertTrue(TrackRules.audioCodecMatches("eac3", "EC-3"));
        assertTrue(TrackRules.audioCodecMatches("ac3", "ac-3"));
        assertTrue(TrackRules.audioCodecMatches("truehd", "truehd"));
        assertTrue(TrackRules.audioCodecMatches("dts", "dca"));
        assertTrue(TrackRules.audioCodecMatches("aac", "mp4a"));
        assertFalse(TrackRules.audioCodecMatches("aac", "flac"));
        assertFalse(TrackRules.audioCodecMatches("", "aac"));
        assertFalse(TrackRules.audioCodecMatches("opus", null));
    }

    @Test
    public void audioCodecMatchesCurrentlyTreatsAc3AndEac3AsTheSame() {
        // The final substring check ("eac3".contains("ac3")) overrides the ac3-only rule.
        assertTrue(TrackRules.audioCodecMatches("eac3", "ac3"));
        assertTrue(TrackRules.audioCodecMatches("ac3", "eac3"));
        // And the "true-hd" name from formatAudioCodec does not match a "truehd" request.
        assertFalse(TrackRules.audioCodecMatches("true-hd", "truehd"));
    }

    @Test
    public void trackLangKeyIsTheFirstWordOfTheLabel() {
        assertEquals("english", TrackRules.trackLangKey("English · AC3 5.1"));
        assertEquals("français", TrackRules.trackLangKey(" Français (Forced)"));
        assertEquals("deutsch", TrackRules.trackLangKey("Deutsch|SDH"));
        assertEquals("", TrackRules.trackLangKey(null));
        assertEquals("", TrackRules.trackLangKey("   "));
    }

    private static Format audio(String mime, String codecs) {
        return new Format.Builder().setSampleMimeType(mime).setCodecs(codecs).build();
    }
}
