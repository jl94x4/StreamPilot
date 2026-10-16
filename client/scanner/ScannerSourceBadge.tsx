import React from 'react';
import { Cpu, FolderInput } from 'lucide-react';
import { useDiscoverI18n } from '../discovery/i18n';
import { sourceAppIconUrl, sourceAppKey, sourceAppLabel } from './eventMeta';

type Props = {
    source?: string;
    className?: string;
};

export const ScannerSourceBadge: React.FC<Props> = ({ source, className = '' }) => {
    const key = sourceAppKey(source);
    const { t } = useDiscoverI18n();
    const label = key === 'manual' ? t('scanner.filters.manual') : sourceAppLabel(source);
    if (!label) return null;
    const iconUrl = sourceAppIconUrl(source);

    return (
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted ${className}`}>
            {iconUrl ? (
                <img
                    src={iconUrl}
                    alt=""
                    className="w-3.5 h-3.5 shrink-0 object-contain"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                />
            ) : key === 'manual' ? (
                <FolderInput className="w-3.5 h-3.5 shrink-0 text-sky-300/90" />
            ) : key === 'media-automation' ? (
                <Cpu className="w-3.5 h-3.5 shrink-0 text-plex" />
            ) : null}
            {label}
        </span>
    );
};

export default ScannerSourceBadge;
