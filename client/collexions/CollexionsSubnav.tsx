import React, { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Image,
    Sparkles,
    Clock,
    BarChart3,
    Settings,
    ScrollText,
    Rows3,
} from 'lucide-react';
import { CustomSelect } from '../shared/ui';
import { DashboardSubnav, dashboardSubnavLinkClass } from '../shared/dashboard/DashboardChrome';

const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/gallery', label: 'Gallery', icon: Image },
    { to: '/hubs', label: 'Hubs', icon: Rows3 },
    { to: '/creator', label: 'Creator', icon: Sparkles },
    { to: '/jobs', label: 'Jobs', icon: Clock },
    { to: '/stats', label: 'Stats', icon: BarChart3 },
    { to: '/config', label: 'Config', icon: Settings },
    { to: '/logs', label: 'Logs', icon: ScrollText },
];

const matchNavItem = (pathname: string) => {
    const path = pathname || '/';
    const exact = navItems.find((item) => item.end && (path === '/' || path === ''));
    if (exact) return exact;
    return (
        navItems.find((item) => !item.end && (path === item.to || path.startsWith(`${item.to}/`)))
        || navItems[0]
    );
};

export const CollexionsSubnav: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const active = useMemo(() => matchNavItem(location.pathname), [location.pathname]);

    return (
        <>
            <div className="md:hidden mb-4">
                <label className="text-muted text-xs uppercase tracking-wider font-bold mb-2 block">
                    Collexions section
                </label>
                <CustomSelect
                    id="collexions-section-select"
                    value={active.to}
                    onChange={(val) => navigate(val)}
                    options={navItems.map((item) => {
                        const Icon = item.icon;
                        return {
                            label: item.label,
                            value: item.to,
                            icon: <Icon className="w-4 h-4" />,
                        };
                    })}
                />
            </div>

            <DashboardSubnav className="mb-5">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    return (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) =>
                                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${dashboardSubnavLinkClass(isActive)}`
                            }
                        >
                            <Icon className="w-4 h-4 flex-shrink-0" />
                            <span>{item.label}</span>
                        </NavLink>
                    );
                })}
            </DashboardSubnav>
        </>
    );
};
