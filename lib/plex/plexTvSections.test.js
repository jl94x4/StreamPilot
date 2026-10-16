import assert from 'node:assert/strict';
import test from 'node:test';
import {
    mapLibraryIdsToPlexTvSectionIds,
    parsePlexTvServerSections,
} from './plexTvSections.js';

const SAMPLE_XML = `<?xml version="1.0"?>
<MediaContainer>
  <Server machineIdentifier="abc">
    <Section id="35723967" key="1" type="movie" title="Movies"/>
    <Section id="35723968" key="2" type="show" title="TV Shows"/>
    <Section id="35723969" key="3" type="artist" title="Music"></Section>
    <Section id="35723970" key="4" type="movie" title="4K"/>
  </Server>
</MediaContainer>`;

test('parsePlexTvServerSections reads plex.tv id and local key', () => {
    const sections = parsePlexTvServerSections(SAMPLE_XML);
    assert.equal(sections.length, 4);
    assert.deepEqual(sections[0], { plexTvId: '35723967', key: '1', title: 'Movies' });
    assert.equal(sections[2].plexTvId, '35723969');
    assert.equal(sections[2].key, '3');
});

test('mapLibraryIdsToPlexTvSectionIds maps local keys to numeric plex.tv ids', () => {
    const sections = parsePlexTvServerSections(SAMPLE_XML);
    assert.deepEqual(
        mapLibraryIdsToPlexTvSectionIds(['1', '2', '4'], sections),
        [35723967, 35723968, 35723970],
    );
});

test('mapLibraryIdsToPlexTvSectionIds accepts already-plex.tv ids and drops unknowns', () => {
    const sections = parsePlexTvServerSections(SAMPLE_XML);
    assert.deepEqual(
        mapLibraryIdsToPlexTvSectionIds(['35723967', '99', '2'], sections),
        [35723967, 35723968],
    );
    assert.deepEqual(mapLibraryIdsToPlexTvSectionIds(['1', '1', '2'], sections), [35723967, 35723968]);
    assert.deepEqual(mapLibraryIdsToPlexTvSectionIds(['1', '2', '3'], []), []);
});
