/**
 * Portal chrome used by Media Player screens.
 * Import host UI from here — not from ../screens, ../discovery, or ../shared.
 * Replace this file when Media Player becomes a standalone app.
 */

export { useDiscoverI18n } from '../discovery/i18n';
export { discoveryTheme } from '../discovery/discoveryThemeClasses';
export { DiscoverGridSizeSelect } from '../discovery/DiscoverGridSizeSelect';
export { useDiscoverGridSize } from '../discovery/useDiscoverGridSize';
export { DiscoverSectionHeader } from '../discovery/DiscoverSectionHeader';
export { Carousel } from '../discovery/Carousel';
export { DiscoveryFactWidget } from '../discovery/DiscoveryFactWidget';
export { DiscoveryLogo } from '../discovery/DiscoveryLogo';
export { MediaRatingPills } from '../discovery/MediaRatingPills';
export type { CombinedRatings } from '../discovery/mediaDetailUtils';
export { PersonProfileHeader } from '../discovery/PersonProfileHeader';
export { DiscoverPosterCard } from '../screens';
export { DiscoverHomeSkeleton, DiscoverHomeRowSkeleton, PlayerHomeHeroSkeleton, PlayerHomeSkeleton, PosterGridSkeleton } from '../shared/skeletons';
export { MediaPlayerAlphaBanner } from '../shared/BetaBadge';
export { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
export {
    discoverRowCardWidthClass,
    posterGridCardWidthStyle,
    homeRailPosterDensity,
    posterGridScaleRem,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
    upgraderLandscapeGridStyle,
} from '../shared/portalLayout';
export { CustomSelect, SettingsToggleRow } from '../shared/ui';
export { StickySaveBar } from '../shared/StickySaveBar';
export { PlexHomeSwitchModal, type PlexHomeProfile } from '../shared/PlexHomeSwitchModal';
export { portalUrl, stripBasePath } from '../shared/basePath';
export { PLAYER_EXIT_EVENT, PLAYER_LOGOUT_EVENT, exitToPortal, logoutMediaPlayer } from './paths';
export { lockBackgroundScroll } from '../shared/lockBackgroundScroll';
export { PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';
export { apiFetch } from '../shared/api';
export { ToastContainer, pushToast, type ToastMessage } from '../shared/toast';
