import React,{ useCallback,useEffect,useState } from 'react';

import { apiFetch } from '../shared/api';
import { PLEX_ICON_URL,portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import { LoginBrandMark } from '../shared/LoginBrandMark';
import { Loader } from '../shared/toast';
import { LivePlexStats } from './login';


type InviteProblem = { title: string; body: string; retryable: boolean };

/** Turn a raw server message into something a new member can act on. */
const describeInviteProblem = (raw: string | null | undefined): InviteProblem => {
    const message = String(raw || '').trim();
    if (/expired/i.test(message)) {
        return {
            title: 'This invite has expired',
            body: 'Ask whoever sent it for a fresh invite link. Invites only work for a limited time.',
            retryable: false,
        };
    }
    if (/already (been )?(used|claimed|redeemed)|fully claimed|no (uses|claims) left|limit reached|used up/i.test(message)) {
        return {
            title: 'This invite has already been used',
            body: 'Each invite can only be claimed a limited number of times. Ask for a new link, or sign in if you already joined.',
            retryable: false,
        };
    }
    if (/invalid|not found|unknown|no such|revoked|disabled/i.test(message)) {
        return {
            title: 'This invite link is not valid',
            body: 'Check that you copied the whole link. If it still fails, ask for a new invite.',
            retryable: false,
        };
    }
    return {
        title: 'We could not finish that',
        body: message || 'Something went wrong while claiming your invite. Please try again.',
        retryable: true,
    };
};

const InviteSteps: React.FC<{ current: 1 | 2 | 3 }> = ({ current }) => {
    const steps = ['Sign in with Plex', 'Accept in Plex', 'Start watching'];
    return (
        <ol className="mb-8 flex w-full max-w-sm items-center justify-between gap-2 text-[11px] font-bold" aria-label="Steps to join">
            {steps.map((label, index) => {
                const n = (index + 1) as 1 | 2 | 3;
                const done = n < current;
                const active = n === current;
                return (
                    <li key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                        <span
                            className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                                done ? 'border-plex bg-plex text-background'
                                    : active ? 'border-plex text-plex'
                                        : 'border-white/20 text-muted'
                            }`}
                            aria-current={active ? 'step' : undefined}
                        >
                            {done ? '✓' : n}
                        </span>
                        <span className={`text-center leading-tight ${active || done ? 'text-text' : 'text-muted/70'}`}>{label}</span>
                    </li>
                );
            })}
        </ol>
    );
};

export const PublicInviteClaim: React.FC<{ code: string }> = ({ code }) => {
    const [info, setInfo] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [claimed, setClaimed] = useState(false);
    const [isClaiming, setIsClaiming] = useState(false);
    const [claimProblem, setClaimProblem] = useState<InviteProblem | null>(null);

    useEffect(() => {
        apiFetch(`/api/invites/${code}/info`).then(setInfo).catch(e => setError(e.message || 'Invalid invite link'));
    }, [code]);

    const handleClaim = useCallback(async (token: string) => {
        setIsClaiming(true);
        try {
            await apiFetch(`/api/invites/${code}/claim`, {
                method: 'POST',
                body: JSON.stringify({ pinId: token })
            });
            setClaimed(true);
        } catch (e: any) {
            const problem = describeInviteProblem(e?.message || 'Failed to claim invite');
            if (problem.retryable) setClaimProblem(problem);
            else setError(e?.message || 'Failed to claim invite');
        } finally {
            setIsClaiming(false);
        }
    }, [code]);

    useEffect(() => {
        const hash = window.location.hash;
        if (hash.startsWith('#auth/')) {
            const token = hash.split('/')[1];
            if (token) {
                window.location.hash = ''; // clear hash
                handleClaim(token);
            }
        }
    }, [handleClaim]);

    const handlePlexLogin = async () => {
        setIsClaiming(true);
        setError(null);
        setClaimProblem(null);
        try {
            const data = await apiFetch('/api/auth/plex/login', { method: 'POST' });
            const clientId = data.clientIdentifier || data.clientId || '';
            const forwardUrl = window.location.origin + portalUrl('/invite/' + code) + '#auth/' + data.id;
            const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${data.code}&context[device][product]=StreamPilot&forwardUrl=${encodeURIComponent(forwardUrl)}`;
            window.location.href = authUrl;
        } catch (error) {
            setError('Failed to initiate Plex login');
            setIsClaiming(false);
        }
    };

    if (error) {
        const problem = describeInviteProblem(error);
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md w-full animate-fade-in mx-auto px-4 mt-20">
                <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-2xl w-full">
                    <h2 className="text-2xl font-bold text-red-500 mb-4">{problem.title}</h2>
                    <p className="text-text">{problem.body}</p>
                    <a href={portalUrl('/')} className="mt-6 inline-block text-plex hover:underline font-bold">Return to Home</a>
                </div>
            </div>
        );
    }

    if (claimed) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-md w-full animate-fade-in mx-auto px-4 mt-20">
            <InviteSteps current={2} />
            <div className="bg-green-500/10 border border-green-500/30 p-8 rounded-2xl w-full">
                <h2 className="text-3xl font-bold text-green-500 mb-4">Success!</h2>
                <p className="text-text mb-6">You have successfully claimed your invite to <strong className="text-plex">{info?.serverName}</strong>. Check your email or open Plex to accept the shared server invite!</p>
                <a href={portalUrl('/')} className="inline-block px-6 py-3 bg-plex text-background font-bold rounded-lg hover:bg-plex-hover transition-colors shadow-lg">Go to Dashboard</a>
            </div>
        </div>
    );

    if (!info) return <Loader isLoading={true} />;

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg w-full animate-fade-in mx-auto px-4 mt-20">
            <div className="relative mb-8 flex justify-center w-full max-w-lg px-2">
                {!(info.customLoginLogoUrl || info.customLogoUrl || info.thumb) ? (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-16 bg-plex/20 rounded-full blur-[50px] pointer-events-none" />
                ) : (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-plex rounded-full blur-[50px] opacity-20 pointer-events-none" />
                )}
                <LoginBrandMark
                    size="lg"
                    src={info.customLoginLogoUrl || info.customLogoUrl || info.thumb
                        ? resolvePortalAssetUrl(info.customLoginLogoUrl || info.customLogoUrl || info.thumb)
                        : null}
                    circleFrame={Boolean(info.customLoginLogoUrl || info.customLogoUrl || info.thumb) && info.loginLogoCircleFrame !== false}
                    className="drop-shadow-[0_0_15px_rgba(229,160,13,0.25)]"
                />
            </div>

            <InviteSteps current={1} />
            <h1 className="text-4xl md:text-5xl font-bold text-text mb-4">You've been invited!</h1>
            <p className="text-xl text-muted mb-8 leading-relaxed">
                You have been invited to join <strong className="text-plex">{info.serverName}</strong> for a period of <strong className="text-plex">{info.durationDays} days</strong>.
            </p>

            {info.showPublicLibraryStats !== false && (
                <div className="w-full mb-8">
                    <LivePlexStats />
                </div>
            )}

            {claimProblem ? (
                <div role="alert" className="mb-5 w-full max-w-sm rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-100">
                    <p className="font-bold">{claimProblem.title}</p>
                    <p className="mt-1 text-amber-100/80">{claimProblem.body}</p>
                </div>
            ) : null}
            <button
                onClick={handlePlexLogin}
                disabled={isClaiming}
                className="w-full max-w-sm px-6 py-4 bg-plex text-background text-lg font-bold rounded-xl hover:bg-plex-hover transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-plex/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {!isClaiming ? (
                    <img src={PLEX_ICON_URL} alt="" className="w-6 h-6 object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ) : null}
                {isClaiming ? 'Claiming...' : (claimProblem ? 'Try again with Plex' : 'Sign in with Plex to Claim')}
            </button>
            <p className="mt-6 text-sm text-muted">You will be redirected to Plex.tv to securely authenticate your account.</p>
        </div>
    );
};
