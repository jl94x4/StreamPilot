package com.servermanagerportal.mediaplayer;

import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.util.DisplayMetrics;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceUi")
public class DeviceUiPlugin extends Plugin {

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isTv", isTelevisionDevice());
        DisplayMetrics dm = getContext().getResources().getDisplayMetrics();
        ret.put("widthPixels", dm.widthPixels);
        ret.put("heightPixels", dm.heightPixels);
        ret.put("density", dm.density);
        call.resolve(ret);
    }

    private boolean isTelevisionDevice() {
        PackageManager pm = getContext().getPackageManager();
        if (pm != null && (
            pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || pm.hasSystemFeature("android.software.leanback")
        )) {
            return true;
        }
        int uiMode = getContext().getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK;
        return uiMode == Configuration.UI_MODE_TYPE_TELEVISION;
    }
}
