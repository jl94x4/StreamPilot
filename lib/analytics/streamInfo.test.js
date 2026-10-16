import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTautulliStreamData } from './streamInfo.js';

test('mapTautulliStreamData builds Tautulli-style source vs stream rows', () => {
    const out = mapTautulliStreamData({
        bitrate: 2072,
        video_full_resolution: '1080p',
        quality_profile: 'Original',
        container: 'mkv',
        video_codec: 'hevc',
        video_bitrate: 1816,
        video_width: 1920,
        video_height: 1080,
        video_framerate: '24p',
        video_dynamic_range: 'SDR',
        aspect_ratio: '1.78',
        audio_codec: 'eac3',
        audio_bitrate: 256,
        audio_channels: 6,
        audio_language: '',
        stream_bitrate: 2072,
        stream_video_full_resolution: '1080p',
        stream_container_decision: 'direct play',
        stream_container: 'mkv',
        stream_video_decision: 'direct play',
        stream_video_codec: 'hevc',
        stream_video_bitrate: 1816,
        stream_video_width: 1920,
        stream_video_height: 1000,
        stream_video_framerate: '24p',
        stream_video_dynamic_range: 'SDR',
        stream_audio_decision: 'direct play',
        stream_audio_codec: 'eac3',
        stream_audio_bitrate: 256,
        stream_audio_channels: 6,
        stream_audio_language: 'English',
        grandparent_title: 'Kitchen Nightmares (US)',
        title: "Lyla's Family Restaurant",
        media_type: 'episode',
    });

    assert.equal(out.title, "Kitchen Nightmares (US) - Lyla's Family Restaurant");
    assert.equal(out.mediaType, 'episode');

    const bySection = Object.fromEntries(out.sections.map((section) => [section.id, section]));
    const byLabel = (section, label) => section.rows.find((row) => row.label === label);

    assert.equal(byLabel(bySection.media, 'Bitrate').source, '2072 kbps');
    assert.equal(byLabel(bySection.media, 'Bitrate').stream, '2072 kbps');
    assert.equal(byLabel(bySection.media, 'Resolution').source, '1080p');
    assert.equal(byLabel(bySection.media, 'Quality').stream, 'Original');
    assert.equal(byLabel(bySection.media, 'Container').source, 'mkv');
    assert.equal(byLabel(bySection.media, 'Container').stream, 'Direct Play');
    assert.equal(byLabel(bySection.media, 'Container').streamTone, 'direct');

    assert.equal(byLabel(bySection.video, 'Codec').source, 'HEVC');
    assert.equal(byLabel(bySection.video, 'Codec').stream, 'Direct Play');
    assert.equal(byLabel(bySection.video, 'Height').stream, '1000');
    assert.equal(byLabel(bySection.video, 'Aspect Ratio').source, '1.78');
    assert.equal(byLabel(bySection.video, 'Aspect Ratio').stream, null);

    assert.equal(byLabel(bySection.audio, 'Codec').source, 'EAC3');
    assert.equal(byLabel(bySection.audio, 'Channels').source, '6');
    assert.equal(byLabel(bySection.audio, 'Language').stream, 'English');
    assert.equal(bySection.subtitles, undefined);
});

test('mapTautulliStreamData shows transcode output codec and optional subtitles', () => {
    const out = mapTautulliStreamData({
        video_codec: 'hevc',
        stream_video_decision: 'transcode',
        stream_video_codec: 'h264',
        subtitle_codec: 'srt',
        stream_subtitle_decision: 'copy',
        stream_subtitle_codec: 'srt',
        stream_subtitle_language: 'English',
    });
    const video = out.sections.find((section) => section.id === 'video');
    const codec = video.rows.find((row) => row.label === 'Codec');
    assert.equal(codec.stream, 'Transcode · H264');
    assert.equal(codec.streamTone, 'transcode');

    const subs = out.sections.find((section) => section.id === 'subtitles');
    assert.equal(subs.rows[0].stream, 'Direct Stream · SRT');
    assert.equal(subs.rows[0].streamTone, 'copy');
});
