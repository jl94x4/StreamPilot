package com.servermanagerportal.mediaplayer;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Hosts the native TV Home (NativeHomeView) BEHIND the WebView. While it is up the WebView is
 * transparent, so the web page keeps drawing the sidebar, clock and billboard details on top of
 * the native backdrop and rows. The web app sends finished rows as JSON, and gets focus / open /
 * long-press / back / left-edge events back; the web app keeps every action.
 */
@CapacitorPlugin(name = "NativeHome")
public class NativeHomePlugin extends Plugin {

    private static final int WEB_BG = 0xFF07080C;

    private NativeHomeView view;
    private OnBackPressedCallback backCallback;
    private NativeHomeImages images;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", true);
        call.resolve(ret);
    }

    /** {rows: "<json>", focus?: bool}: bind the rows and bring the native Home up. */
    @PluginMethod
    public void show(PluginCall call) {
        final String json = call.getString("rows", "");
        final boolean focus = !Boolean.FALSE.equals(call.getBoolean("focus", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                List<NativeHomeView.Row> rows = view.parse(json);
                view.bind(rows);
                boolean wasHidden = view.getVisibility() != View.VISIBLE || view.isDetailsMode();
                view.leaveDetails();
                view.leaveBrowse();
                view.animate().cancel();
                if (pendingHide != null) {
                    pendingHide.resolve();
                    pendingHide = null;
                }
                if (wasHidden) view.setAlpha(0f);
                if (wasHidden) view.beginRestore();
                view.setVisibility(View.VISIBLE);
                view.animate().alpha(1f).setDuration(wasHidden ? 220 : 0).start();
                setWebTransparent(true);
                if (focus && (wasHidden || !view.hasFocusInside() || (web() != null && web().isFocused()))) {
                    backCallback.setEnabled(true);
                    view.restoreFocus();
                    // Safety net: back on Home and nothing at all holds the remote (a title page's views let go after
                    // the rows were focused, or the rows were not ready): put it back on the rows.
                    view.postDelayed(() -> {
                        if (view == null || view.getVisibility() != View.VISIBLE || view.isDetailsMode() || view.isBrowseMode()) return;
                        if (activity.getCurrentFocus() != null && activity.getCurrentFocus() != web()) return;
                        if (web() != null && web().isFocused()) return;
                        backCallback.setEnabled(true);
                        view.restoreFocus();
                    }, 600);
                }
                JSObject ret = new JSObject();
                ret.put("rows", rows.size());
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (view == null || view.getVisibility() != View.VISIBLE) {
                hideInternal();
                call.resolve();
                return;
            }
            // Fade out instead of cutting: the page opening on top (details) shows through while the Home
            // backdrop dissolves, so there is no flash of an empty screen while it loads its own.
            if (backCallback != null) backCallback.setEnabled(false);
            view.animate().cancel();
            pendingHide = call;
            view.animate().alpha(0f).setDuration(280).withEndAction(() -> {
                if (pendingHide != call) return; // something was shown again meanwhile: leave it
                hideInternal();
                view.setAlpha(1f);
                if (pendingHide == call) pendingHide = null;
                call.resolve();
            }).start();
        });
    }

    private PluginCall pendingHide;

    /** Movie / show page: keep the native backdrop (the picture), hide the rows. */
    @PluginMethod
    public void enterDetails(PluginCall call) {
        final String url = call.getString("url", "");
        final String rgb = call.getString("rgb", "");
        final boolean tint = !Boolean.FALSE.equals(call.getBoolean("tint", true));
        // false: only the backdrop changes (another episode took the spotlight). The remote stays where it is: taking it
        // for the WebView here pulled focus off the native episode rail and the page dropped it on the "Show" tab.
        final boolean takeFocus = !Boolean.FALSE.equals(call.getBoolean("focus", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                view.animate().cancel();
                if (pendingHide != null) {
                    pendingHide.resolve();
                    pendingHide = null;
                }
                view.setAlpha(1f);
                if (pendingHide != null) {
                    pendingHide.resolve();
                    pendingHide = null;
                }
                view.setVisibility(View.VISIBLE);
                view.enterDetails(url, rgb, tint);
                setWebTransparent(true);
                if (takeFocus) {
                    if (backCallback != null) backCallback.setEnabled(false);
                    focusWeb();
                }
                call.resolve();
            } catch (Throwable t) {
                call.reject(String.valueOf(t.getMessage()));
            }
        });
    }

    @PluginMethod
    public void setDetailsScroll(PluginCall call) {
        final double y = call.getDouble("y", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final double sy = call.getDouble("sy", -1.0);
        final Activity activity = getActivity();
        if (activity != null && view != null) {
            activity.runOnUiThread(() -> {
                if (view == null) return;
                if (h > 0 && vw > 0 && sy >= 0) {
                    // Follow the WebView's own scroll on the UI thread (like the rails), not a bridge call a frame or two late:
                    // the backdrop lagging the page made every row move judder.
                    final float hh = (float) h;
                    place("backdrop", 0f, (float) (y * h), (float) vw, hh, (float) vw, (float) sy,
                        (rx, ry, rw, rh, rvw) -> { if (view != null) view.setDetailsScroll(ry / hh); });
                } else {
                    view.setDetailsScroll((float) y);
                }
            });
        }
        call.resolve();
    }

    /** {rail: "<json>", x, y, w, h, vw}: the episode rail's cards and where the web rail sits. */
    @PluginMethod
    public void setRail(PluginCall call) {
        final String json = call.getString("rail", "");
        final String focus = call.getString("focus", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                ensureRail(activity).setItems(NativeEpisodeRail.parse(json), focus);
            } catch (Throwable ignored) {
                /* keep the web rail's data as is */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setRailRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final Activity activity = getActivity();
        // rail is read on the UI thread: setRail may still be queued there (it creates the rail)
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (rail != null) rail.setRect((float) x, (float) y, (float) w, (float) h, (float) vw);
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideRail(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && rail != null) {
            activity.runOnUiThread(() -> {
                boolean had = rail.hasFocusInside();
                rail.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void setRailSuppressed(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(() -> {
            if (rail != null) rail.setSuppressed(on);
        });
        call.resolve();
    }

    /** The page's focus landed on a hidden episode card: the native rail takes the remote on that episode. */
    @PluginMethod
    public void focusRail(PluginCall call) {
        final String key = call.getString("key", "");
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (rail != null) rail.focusKey(key);
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** {id, data: "<json>", focus}: one cast / related rail of a details page (cards + the layout measured off the web ones). */
    @PluginMethod
    public void setDetailRail(PluginCall call) {
        final String id = call.getString("id", "");
        final String json = call.getString("data", "");
        final String focus = call.getString("focus", "");
        final Activity activity = getActivity();
        if (activity == null || id.isEmpty()) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                ensureDetailRail(activity, id).setData(new org.json.JSONObject(json), focus);
            } catch (Throwable ignored) {
                /* keep the web rail's data as is */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setDetailRailRect(PluginCall call) {
        final String id = call.getString("id", "");
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final double sy = call.getDouble("sy", -1.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> { // looked up here: setDetailRail may still be queued (it creates the rail)
                NativeDetailRail target = detailRails.get(id);
                place("rail~" + id, (float) x, (float) y, (float) w, (float) h, (float) vw, (float) sy, (rx, ry, rw, rh, rvw) -> { NativeDetailRail t = detailRails.get(id); if (t != null) t.setRect(rx, ry, rw, rh, rvw); });
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideDetailRail(PluginCall call) {
        final String id = call.getString("id", "");
        final Activity activity = getActivity();
        final NativeDetailRail target = detailRails.get(id);
        if (activity != null && target != null) {
            activity.runOnUiThread(() -> {
                boolean had = target.hasFocusInside();
                target.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void setDetailRailSuppressed(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final Activity activity = getActivity();
        detailSuppressed = on;
        if (activity != null) {
            activity.runOnUiThread(() -> {
                for (NativeDetailRail r : detailRails.values()) r.setSuppressed(on);
                if (detailsText != null) detailsText.setSuppressed(on);
                if (detailActions != null) detailActions.setSuppressed(on);
                if (settingsView != null) settingsView.setSuppressed(on);
                if (searchView != null) searchView.setSuppressed(on);
                if (seasonTabs != null) seasonTabs.setSuppressed(on);
            });
        }
        call.resolve();
    }

    /** The page's focus landed on a hidden cast / related card: the native rail that has it takes the remote. */
    @PluginMethod
    public void focusDetailRail(PluginCall call) {
        final String key = call.getString("key", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            boolean found = false;
            if (detailActions != null && detailActions.hasKey(key)) {
                detailActions.focusKey(key);
                found = true;
            }
            if (!found && settingsView != null && settingsView.hasKey(key)) {
                settingsView.focusKey(key);
                found = true;
            }
            if (!found && searchView != null && searchView.hasKey(key)) {
                searchView.focusKey(key);
                found = true;
            }
            if (!found && chromeView != null && chromeView.hasKey(key)) {
                chromeView.focusKey(key);
                found = true;
            }
            if (!found && libHeader != null && libHeader.hasKey(key)) {
                libHeader.focusKey(key);
                found = true;
            }
            if (!found && seasonTabs != null && seasonTabs.hasKey(key)) {
                seasonTabs.focusKey(key);
                found = true;
            }
            for (NativeDetailRail r : detailRails.values()) {
                if (found) break;
                if (r.hasKey(key)) {
                    r.focusKey(key);
                    found = true;
                    break;
                }
            }
            JSObject res = new JSObject();
            res.put("found", found);
            call.resolve(res);
        });
    }

    /** {data: "<json>", vw, fresh, rgb, focus}: a library's Browse grid (cards + the page's layout numbers). */
    @PluginMethod
    public void setBrowse(PluginCall call) {
        final String json = call.getString("data", "");
        final double vw = call.getDouble("vw", 0.0);
        final boolean fresh = Boolean.TRUE.equals(call.getBoolean("fresh", false));
        final String rgb = call.getString("rgb", "");
        final boolean focus = !Boolean.FALSE.equals(call.getBoolean("focus", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureView(activity);
                ensureBrowse(activity);
                boolean wasHidden = view.getVisibility() != View.VISIBLE || !view.isBrowseMode();
                view.animate().cancel();
                if (pendingHide != null) {
                    pendingHide.resolve();
                    pendingHide = null;
                }
                if (pendingHide != null) {
                    pendingHide.resolve();
                    pendingHide = null;
                }
                view.leaveDetails();
                view.enterBrowse(rgb);
                if (wasHidden) view.setAlpha(0f);
                view.setVisibility(View.VISIBLE);
                view.animate().alpha(1f).setDuration(wasHidden ? 220 : 0).start();
                setWebTransparent(true);
                browse.setData(json, (float) vw, fresh);
                if (focus && (wasHidden || !browse.hasFocusInside() || (web() != null && web().isFocused()))) {
                    backCallback.setEnabled(true);
                    browse.restoreFocus();
                }
            } catch (Throwable ignored) {
                /* keep what is shown */
            }
            call.resolve();
        });
    }

    /** The page's hidden copy of this card got focus (back from the header / A-Z bar): the grid takes the remote. */
    @PluginMethod
    public void focusBrowse(PluginCall call) {
        final String key = call.getString("key", "");
        final Activity activity = getActivity();
        if (activity != null && browse != null) {
            activity.runOnUiThread(() -> {
                if (backCallback != null) backCallback.setEnabled(true);
                browse.focusKey(key);
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** Run a D-pad key through the web page ("up" | "down" | "left" | "right") after a rail hand-off. */
    @PluginMethod
    public void injectKey(PluginCall call) {
        final String dir = call.getString("dir", "");
        final Activity activity = getActivity();
        final WebView web = web();
        if (activity == null || web == null) {
            call.resolve();
            return;
        }
        int code = "up".equals(dir) ? android.view.KeyEvent.KEYCODE_DPAD_UP
            : "down".equals(dir) ? android.view.KeyEvent.KEYCODE_DPAD_DOWN
            : "left".equals(dir) ? android.view.KeyEvent.KEYCODE_DPAD_LEFT
            : "right".equals(dir) ? android.view.KeyEvent.KEYCODE_DPAD_RIGHT
            : "shift".equals(dir) ? android.view.KeyEvent.KEYCODE_SHIFT_LEFT : 0;
        final int keyCode = code;
        activity.runOnUiThread(() -> {
            if (keyCode == 0) {
                call.resolve();
                return;
            }
            focusWebView(web);
            // The page needs a beat to take window focus before it accepts keys.
            web.postDelayed(() -> {
                long t = android.os.SystemClock.uptimeMillis();
                web.dispatchKeyEvent(new android.view.KeyEvent(t, t, android.view.KeyEvent.ACTION_DOWN, keyCode, 0));
                web.postDelayed(() -> {
                    long u = android.os.SystemClock.uptimeMillis();
                    web.dispatchKeyEvent(new android.view.KeyEvent(t, u, android.view.KeyEvent.ACTION_UP, keyCode, 0));
                }, 40);
                call.resolve();
            }, 90);
        });
    }

    /** Give the keys back to the web page (sidebar). */
    @PluginMethod
    public void releaseFocus(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (backCallback != null) backCallback.setEnabled(false);
                // The page asked for the remote for good (a web row): no native highlight may linger.
                NativeDetailRail.releaseHeldLooks();
                focusWeb();
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** The billboard fade colour changed with the artwork ("r g b"). */
    @PluginMethod
    public void setSurface(PluginCall call) {
        final String rgb = call.getString("rgb", "");
        final Activity activity = getActivity();
        if (activity != null && view != null) {
            activity.runOnUiThread(() -> view.setSurfaceColor(rgb));
        }
        call.resolve();
    }

    /** Settings: focus ring colour ("r g b", empty = default) and thickness factor. */
    /** Settings: the app font for the native screens. A change drops the native views so they are rebuilt in it. */
    @PluginMethod
    public void setFont(PluginCall call) {
        final String key = call.getString("key", "default");
        final Activity activity = getActivity();
        if (!NativeFonts.setKey(key)) {
            call.resolve();
            return;
        }
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            // Any native screen showing now was built with the old font: tell the page, which reloads so every screen is
            // rebuilt (tearing them down alone left the current screen blank - it looked like a crash).
            boolean had = view != null || settingsView != null || detailActions != null || detailsText != null
                || seasonTabs != null || libHeader != null || chromeView != null || searchView != null || rail != null
                || !detailRails.isEmpty() || menu != null;
            try {
                resetViews(activity);
            } catch (Throwable ignored) {
                /* rebuilt lazily */
            }
            JSObject res = new JSObject();
            res.put("reset", had);
            call.resolve(res);
        });
    }

    /** Remove every native overlay so the next show builds fresh ones (new font). */
    private void resetViews(Activity activity) {
        if (menu != null) {
            ViewGroup p = menu.getParent() instanceof ViewGroup ? (ViewGroup) menu.getParent() : null;
            if (p != null) p.removeView(menu);
            menu = null;
        }
        for (NativeDetailRail r : detailRails.values()) {
            r.clear();
            if (r.getParent() instanceof ViewGroup) ((ViewGroup) r.getParent()).removeView(r);
        }
        detailRails.clear();
        if (detailsText != null) {
            detailsText.clear();
            if (detailsText.getParent() instanceof ViewGroup) ((ViewGroup) detailsText.getParent()).removeView(detailsText);
            detailsText = null;
        }
        if (seasonTabs != null) {
            seasonTabs.clear();
            if (seasonTabs.getParent() instanceof ViewGroup) ((ViewGroup) seasonTabs.getParent()).removeView(seasonTabs);
            seasonTabs = null;
        }
        if (detailActions != null) {
            detailActions.clear();
            if (detailActions.getParent() instanceof ViewGroup) ((ViewGroup) detailActions.getParent()).removeView(detailActions);
            detailActions = null;
        }
        if (settingsView != null) {
            settingsView.clear();
            if (settingsView.getParent() instanceof ViewGroup) ((ViewGroup) settingsView.getParent()).removeView(settingsView);
            settingsView = null;
        }
        if (searchView != null) {
            searchView.clear();
            if (searchView.getParent() instanceof ViewGroup) ((ViewGroup) searchView.getParent()).removeView(searchView);
            searchView = null;
        }
        if (libHeader != null) {
            libHeader.clear();
            if (libHeader.getParent() instanceof ViewGroup) ((ViewGroup) libHeader.getParent()).removeView(libHeader);
            libHeader = null;
        }
        if (chromeView != null) {
            chromeView.clear();
            if (chromeView.getParent() instanceof ViewGroup) ((ViewGroup) chromeView.getParent()).removeView(chromeView);
            chromeView = null;
        }
        if (rail != null) {
            rail.clear();
            if (rail.getParent() instanceof ViewGroup) ((ViewGroup) rail.getParent()).removeView(rail);
            rail = null;
        }
        browse = null; // lives inside the Home view
        if (view != null) {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view = null;
        }
        if (backCallback != null) {
            backCallback.remove();
            backCallback = null;
        }
        pendingHide = null;
        setWebTransparent(false);
    }

    @PluginMethod
    public void setRing(PluginCall call) {
        final String rgb = call.getString("rgb", "");
        final double scale = call.getDouble("scale", 1.0);
        int color = 0;
        try {
            String[] p = rgb.trim().split("\s+");
            if (p.length >= 3) color = android.graphics.Color.rgb(Integer.parseInt(p[0]), Integer.parseInt(p[1]), Integer.parseInt(p[2]));
        } catch (Exception ignored) { /* default */ }
        NativeHomeView.ringColor = color;
        NativeHomeView.ringScale = (float) Math.max(0.5, Math.min(3.0, scale));
        call.resolve();
    }

    /** Settings -> Display look: poster corner radius (dp), row marker, text scale, View more card style. */
    @PluginMethod
    public void setLook(PluginCall call) {
        NativeHomeView.radiusDp = (float) Math.max(0.0, Math.min(24.0, call.getDouble("radius", 6.0)));
        NativeHomeView.rowMarker = call.getString("marker", "play");
        NativeHomeView.textScale = (float) Math.max(0.5, Math.min(2.0, call.getDouble("textScale", 1.0)));
        NativeHomeView.viewMoreStyle = call.getString("viewMore", "backdrop");
        final Activity activity = getActivity();
        final NativeHomeView home = view;
        if (activity == null || home == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                home.applyLook();
            } catch (Throwable ignored) {
                /* next bind picks it up */
            }
            call.resolve();
        });
    }

    /** {data: "<json>"}: the Home billboard copy, drawn natively; clearBillboard when the page owns it again. */
    @PluginMethod
    public void setBillboard(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        final NativeHomeView home = view;
        if (activity == null || home == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                home.setBillboard(json);
            } catch (Throwable ignored) {
                /* next update */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void clearBillboard(PluginCall call) {
        final Activity activity = getActivity();
        final NativeHomeView home = view;
        if (activity == null || home == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                home.clearBillboard();
            } catch (Throwable ignored) {
                /* gone */
            }
            call.resolve();
        });
    }

    private NativeSeasonTabs seasonTabs;

    private NativeSeasonTabs ensureSeasonTabs(Activity activity) {
        if (seasonTabs != null) return seasonTabs;
        ensureView(activity);
        seasonTabs = new NativeSeasonTabs(activity, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(seasonTabs, new android.widget.FrameLayout.LayoutParams(1, 1));
        seasonTabs.setSuppressed(detailSuppressed);
        return seasonTabs;
    }

    @PluginMethod
    public void setSeasonTabs(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureSeasonTabs(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web bar */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSeasonTabsRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final double sy = call.getDouble("sy", -1.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                place("tabs", (float) x, (float) y, (float) w, (float) h, (float) vw, (float) sy, (rx, ry, rw, rh, rvw) -> { if (seasonTabs != null) seasonTabs.setRect(rx, ry, rw, rh, rvw); });
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideSeasonTabs(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && seasonTabs != null) {
            activity.runOnUiThread(() -> {
                boolean had = seasonTabs.hasFocusInside();
                seasonTabs.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeDetailActions detailActions;

    private NativeDetailActions ensureDetailActions(Activity activity) {
        if (detailActions != null) return detailActions;
        ensureView(activity);
        detailActions = new NativeDetailActions(activity, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(detailActions, new android.widget.FrameLayout.LayoutParams(1, 1));
        detailActions.setSuppressed(detailSuppressed);
        return detailActions;
    }

    /** {data: "<json>"}: the action buttons row of a details page (measured off the web buttons). */
    @PluginMethod
    public void setDetailActions(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureDetailActions(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web row */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setDetailActionsRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final double sy = call.getDouble("sy", -1.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                place("actions", (float) x, (float) y, (float) w, (float) h, (float) vw, (float) sy, (rx, ry, rw, rh, rvw) -> { if (detailActions != null) detailActions.setRect(rx, ry, rw, rh, rvw); });
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideDetailActions(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && detailActions != null) {
            activity.runOnUiThread(() -> {
                boolean had = detailActions.hasFocusInside();
                detailActions.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeLibHeader libHeader;

    private NativeLibHeader ensureLibHeader(Activity activity) {
        if (libHeader != null) return libHeader;
        ensureView(activity);
        libHeader = new NativeLibHeader(activity, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(libHeader, new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (chromeView != null) chromeView.bringToFront();
        return libHeader;
    }

    /** {data: "<json>"}: a library page's title and tabs, measured off the web page. */
    @PluginMethod
    public void setLibHeader(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureLibHeader(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web header */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void hideLibHeader(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && libHeader != null) {
            activity.runOnUiThread(() -> {
                boolean had = libHeader.hasFocusInside();
                libHeader.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeChromeView chromeView;

    private NativeChromeView ensureChrome(Activity activity) {
        if (chromeView != null) return chromeView;
        ensureView(activity);
        chromeView = new NativeChromeView(activity, railListener, images);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(chromeView, new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        chromeView.bringToFront();
        return chromeView;
    }

    /** {data: "<json>"}: the side menu and the clock, measured off the web page. */
    @PluginMethod
    public void setChrome(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureChrome(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web chrome */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void hideChrome(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && chromeView != null) {
            activity.runOnUiThread(() -> {
                boolean had = chromeView.hasFocusInside();
                chromeView.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeSearchView searchView;

    private NativeSearchView ensureSearch(Activity activity) {
        if (searchView != null) return searchView;
        ensureView(activity);
        searchView = new NativeSearchView(activity, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(searchView, new android.widget.FrameLayout.LayoutParams(1, 1));
        searchView.setSuppressed(detailSuppressed);
        return searchView;
    }

    /** {data: "<json>"}: the search panel (title, typed text, keyboard) measured off the web page. */
    @PluginMethod
    public void setSearch(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureSearch(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web page */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSearchRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (searchView != null) searchView.setRect((float) x, (float) y, (float) w, (float) h, (float) vw);
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideSearch(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && searchView != null) {
            activity.runOnUiThread(() -> {
                boolean had = searchView.hasFocusInside();
                searchView.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeSettingsView settingsView;

    private NativeSettingsView ensureSettings(Activity activity) {
        if (settingsView != null) return settingsView;
        ensureView(activity);
        settingsView = new NativeSettingsView(activity, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(settingsView, new android.widget.FrameLayout.LayoutParams(1, 1));
        settingsView.setSuppressed(detailSuppressed);
        return settingsView;
    }

    /** {data: "<json>"}: the Settings screen (tabs, rows, Save) scraped off the web page. */
    @PluginMethod
    public void setSettings(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureSettings(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web page */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSettingsRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (settingsView != null) settingsView.setRect((float) x, (float) y, (float) w, (float) h, (float) vw);
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideSettings(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null && settingsView != null) {
            activity.runOnUiThread(() -> {
                boolean had = settingsView.hasFocusInside();
                settingsView.clear();
                if (had) {
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeDetailsText detailsText;

    private NativeDetailsText ensureDetailsText(Activity activity) {
        if (detailsText != null) return detailsText;
        ensureView(activity);
        if (images == null) images = new NativeHomeImages(activity.getApplicationContext());
        detailsText = new NativeDetailsText(activity, images);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(detailsText, new android.widget.FrameLayout.LayoutParams(1, 1));
        detailsText.setSuppressed(detailSuppressed);
        return detailsText;
    }

    /** {data: "<json>"}: the movie / show page's text blocks (identity, meta chips + ratings, synopsis). */
    @PluginMethod
    public void setDetailsText(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                ensureDetailsText(activity).setData(new org.json.JSONObject(json));
            } catch (Throwable ignored) {
                /* keep the web text */
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setDetailsTextRect(PluginCall call) {
        final double x = call.getDouble("x", 0.0);
        final double y = call.getDouble("y", 0.0);
        final double w = call.getDouble("w", 0.0);
        final double h = call.getDouble("h", 0.0);
        final double vw = call.getDouble("vw", 0.0);
        final double sy = call.getDouble("sy", -1.0);
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                place("text", (float) x, (float) y, (float) w, (float) h, (float) vw, (float) sy, (rx, ry, rw, rh, rvw) -> { if (detailsText != null) detailsText.setRect(rx, ry, rw, rh, rvw); });
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void hideDetailsText(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                if (detailsText != null) detailsText.clear();
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    private NativeMenuView menu;

    /** Hands the remote to the page, unless the native menu is up (it keeps the keys until it closes). */
    private void focusWeb() {
        if (menu != null && menu.getVisibility() == View.VISIBLE) return;
        WebView web = web();
        if (web != null) focusWebView(web);
    }

    /** {data: "<json>"}: the title context menu, drawn above the page. Called again when its rows change. */
    @PluginMethod
    public void setMenu(PluginCall call) {
        final String json = call.getString("data", "");
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (menu == null) {
                    ensureView(activity);
                    if (images == null) images = new NativeHomeImages(activity.getApplicationContext());
                    menu = new NativeMenuView(activity, images, new NativeMenuView.Listener() {
                        @Override
                        public void onPick(int index, String sub) {
                            emit("menuPick", String.valueOf(index), sub);
                        }

                        @Override
                        public void onBack() {
                            emit("menuBack", "", "");
                        }

                        @Override
                        public void onActivity() {
                            emit("activity", "", "");
                        }
                    });
                    ViewGroup parent = activity.findViewById(android.R.id.content);
                    parent.addView(menu, new android.widget.FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                }
                menu.setData(json);
            } catch (Throwable ignored) {
                /* the web sheet is still there */
            }
            call.resolve();
        });
    }

    /** The menu closed: remove it and give the remote back to the page. */
    @PluginMethod
    public void hideMenu(PluginCall call) {
        final boolean focusWeb = !Boolean.FALSE.equals(call.getBoolean("focusWeb", true));
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (menu != null) menu.hideMenu();
            WebView web = web();
            if (focusWeb && web != null) focusWebView(web);
            call.resolve();
        });
    }

    /** {on}: the black "starting next episode" cover over the whole app (see PlaybackCover). */
    @PluginMethod
    public void setPlaybackCover(PluginCall call) {
        if (Boolean.TRUE.equals(call.getBoolean("on", false))) PlaybackCover.show();
        else PlaybackCover.hide();
        call.resolve();
    }

    /** The sidebar opened (true) or closed (false) over the rows. */
    @PluginMethod
    public void setBlocked(PluginCall call) {
        final boolean blocked = Boolean.TRUE.equals(call.getBoolean("blocked", false));
        final Activity activity = getActivity();
        if (activity != null && view != null) {
            activity.runOnUiThread(() -> {
                view.setBlocked(blocked);
                if (blocked) {
                    if (backCallback != null) backCallback.setEnabled(false);
                    WebView web = web();
                    if (web != null) focusWebView(web);
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** Sidebar open: the web page shifts right by this many px (1920 layout); the native rows follow. */
    @PluginMethod
    public void setRowsShift(PluginCall call) {
        final double px = call.getDouble("px", 0.0);
        final Activity activity = getActivity();
        if (activity != null && view != null) activity.runOnUiThread(() -> view.setRowsShift((float) px));
        call.resolve();
    }

    /** The web page handed focus back to the rows (Right from the sidebar). */
    @PluginMethod
    public void focusRows(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                WebView web = web();
                boolean pageHasIt = web != null && web.isFocused();
                if (view != null && pendingHide == null && view.getVisibility() == View.VISIBLE && (pageHasIt || !view.hasFocusInside())) {
                    backCallback.setEnabled(true);
                    view.restoreFocus();
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** The web app had nothing to do for Back on Home: leave the app like the old Home did. */
    @PluginMethod
    public void exitApp(PluginCall call) {
        final Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(activity::finish);
        call.resolve();
    }

    // Details overlays are placed from the page's rects. The page scrolls on its own, so each rect carries the scroll
    // it was measured at and the overlay follows the WebView's scroll on the UI thread, in step with the page.
    private interface RectSetter {
        void set(float x, float y, float w, float h, float vw);
    }

    private final java.util.Map<String, Runnable> anchored = new java.util.HashMap<>();
    private boolean scrollHooked;
    private boolean scrollSeen;

    private void place(String id, float x, float y, float w, float h, float vw, float sy, RectSetter setter) {
        Runnable apply = () -> {
            WebView web = web();
            float k = web != null && vw > 0 ? web.getWidth() / vw : 0f;
            float dy = 0f;
            if (sy >= 0f && scrollSeen && k > 0f) dy = web.getScrollY() / k - sy;
            setter.set(x, y - dy, w, h, vw);
        };
        anchored.put(id, apply);
        apply.run();
        WebView web = web();
        if (!scrollHooked && web != null && sy > 0f) {
            scrollHooked = true;
            web.setOnScrollChangeListener((v, sx, sY, ox, oY) -> {
                if (sY != 0) scrollSeen = true;
                for (Runnable r : new java.util.ArrayList<>(anchored.values())) r.run();
            });
        }
    }

    /**
     * Give the WebView the remote without a direction. A plain requestFocus() is FOCUS_DOWN, and Chromium answers a
     * directional focus with its initial-focus walk over the whole page (100ms+ on a title page, every Up / Down that
     * hands the remote to the page) and lands on the page's first button, which then has to be put right.
     */
    static void focusWebView(WebView web) {
        if (web == null) return;
        if (!web.requestFocus(0, null)) web.requestFocus();
    }

    private WebView web() {
        try {
            return getBridge() == null ? null : getBridge().getWebView();
        } catch (Throwable t) {
            return null;
        }
    }

    private void hideInternal() {
        if (rail != null) rail.clear();
        if (view != null) {
            view.leaveDetails();
            view.leaveBrowse();
            view.setVisibility(View.GONE);
        }
        if (backCallback != null) backCallback.setEnabled(false);
        setWebTransparent(false);
        WebView web = web();
        if (web != null) focusWebView(web);
    }

    private void setWebTransparent(boolean transparent) {
        WebView web = web();
        if (web == null) return;
        web.setBackgroundColor(transparent ? Color.TRANSPARENT : WEB_BG);
    }

    private void ensureView(Activity activity) {
        if (view != null) return;
        if (images == null) images = new NativeHomeImages(activity.getApplicationContext());
        view = new NativeHomeView(activity, images, new NativeHomeView.Listener() {
            @Override
            public void onOpen(String rowId, String key) {
                emit("open", rowId, key);
            }

            @Override
            public void onLongPress(String rowId, String key) {
                emit("longPress", rowId, key);
            }

            @Override
            public void onFocus(String rowId, String key) {
                emit("focus", rowId, key);
            }

            @Override
            public void onReleaseAfterHold() {
                if (backCallback != null) backCallback.setEnabled(false);
                focusWeb();
                emit("holdEnd", "", "");
            }

            @Override
            public void onDetailsSurface(String rgb) {
                emit("detailsSurface", rgb, "");
            }

            @Override
            public void onActivity() {
                emit("activity", "", "");
            }

            @Override
            public void onEdgeUp() {
                if (backCallback != null) backCallback.setEnabled(false);
                focusWeb();
                emit("edgeUp", "", "");
            }

            @Override
            public void onEdgeLeft() {
                if (backCallback != null) backCallback.setEnabled(false);
                // Hand the remote to the page right here (no round trip), then tell it to open the sidebar.
                focusWeb();
                emit("edgeLeft", "", "");
            }
        });
        railListener = new NativeEpisodeRail.Listener() {
            @Override
            public void onOpen(String key) {
                emit("railOpen", "", key);
            }

            @Override
            public void onLongPress(String key) {
                emit("railLongPress", "", key);
            }

            @Override
            public void onFocus(String key) {
                emit("railFocus", "", key);
            }

            @Override
            public void onHandoff(String dir, String key) {
                // The page takes the remote now; it focuses the hidden card, then sends the key back (injectKey).
                focusWeb();
                emit("railHandoff", dir, key);
            }

            @Override
            public void onVertical(String dir, String key) {
                // No focusWeb: the page usually answers by focusing another native row, and the WebView taking
                // the remote first is what made the highlight blink. It releases the remote itself if it cannot.
                emit("railVertical", dir, key);
            }

            @Override
            public void onActivity() {
                emit("railActivity", "", "");
            }

            @Override
            public void onHoldEnd() {
                focusWeb();
                emit("railHoldEnd", "", "");
            }
        };
        view.setVisibility(View.GONE);
        WebView web = web();
        ViewGroup parent = web != null && web.getParent() instanceof ViewGroup
            ? (ViewGroup) web.getParent()
            : activity.findViewById(android.R.id.content);
        // Behind the WebView: the page's own layers draw over the native backdrop and rows.
        int index = web != null ? Math.max(0, parent.indexOfChild(web)) : 0;
        parent.addView(view, index, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        backCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                emit("back", "", "");
            }
        };
        // Registered after MainActivity's own Back handler, so it runs first while enabled.
        ((ComponentActivity) activity).getOnBackPressedDispatcher()
            .addCallback((ComponentActivity) activity, backCallback);
    }

    private NativeBrowseGrid browse;

    private NativeBrowseGrid ensureBrowse(Activity activity) {
        if (browse != null) return browse;
        browse = new NativeBrowseGrid(activity, images, new NativeBrowseGrid.Listener() {
            @Override
            public void onOpen(String key) {
                emit("browseOpen", "", key);
            }

            @Override
            public void onLongPress(String key) {
                emit("browseLongPress", "", key);
            }

            @Override
            public void onFocus(String key, int index) {
                emit("browseFocus", String.valueOf(index), key);
            }

            @Override
            public void onHandoff(String dir, String key) {
                if (backCallback != null) backCallback.setEnabled(false);
                focusWeb();
                emit("browseHandoff", dir, key);
            }

            @Override
            public void onEdgeLeft() {
                if (backCallback != null) backCallback.setEnabled(false);
                focusWeb();
                emit("edgeLeft", "", "");
            }

            @Override
            public void onActivity() {
                emit("activity", "", "");
            }

            @Override
            public void onHoldEnd() {
                if (backCallback != null) backCallback.setEnabled(false);
                focusWeb();
                emit("holdEnd", "", "");
            }

            @Override
            public void onScroll(float y) {
                if (libHeader != null) libHeader.setScroll(y);
                emit("browseScroll", "", String.valueOf(y));
            }
        });
        view.attachBrowse(browse);
        return browse;
    }

    private NativeEpisodeRail.Listener railListener;
    private NativeEpisodeRail rail;
    private final java.util.Map<String, NativeDetailRail> detailRails = new java.util.HashMap<>();
    private boolean detailSuppressed;

    private NativeDetailRail ensureDetailRail(Activity activity, String id) {
        NativeDetailRail existing = detailRails.get(id);
        if (existing != null) return existing;
        ensureView(activity);
        if (images == null) images = new NativeHomeImages(activity.getApplicationContext());
        NativeDetailRail made = new NativeDetailRail(activity, id, images, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content);
        parent.addView(made, new android.widget.FrameLayout.LayoutParams(1, 1));
        made.setSuppressed(detailSuppressed);
        detailRails.put(id, made);
        return made;
    }

    /** The episode rail sits ABOVE the WebView (the page's scrims would darken it behind). */
    private NativeEpisodeRail ensureRail(Activity activity) {
        if (rail != null) return rail;
        ensureView(activity);
        if (images == null) images = new NativeHomeImages(activity.getApplicationContext());
        rail = new NativeEpisodeRail(activity, images, railListener);
        ViewGroup parent = activity.findViewById(android.R.id.content); // a FrameLayout over everything
        parent.addView(rail, new android.widget.FrameLayout.LayoutParams(1, 1));
        return rail;
    }

    private void emit(String event, String rowId, String key) {
        JSObject data = new JSObject();
        data.put("rowId", rowId);
        data.put("key", key);
        notifyListeners(event, data);
    }
}
