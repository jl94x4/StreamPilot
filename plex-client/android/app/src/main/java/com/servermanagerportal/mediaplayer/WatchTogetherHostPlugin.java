package com.servermanagerportal.mediaplayer;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lets this device host a Watch Together room itself. The room logic stays in the web layer (the
 * same engine the relay runs); this plugin only provides what a WebView cannot: a listening
 * socket, and a port opened on the router.
 *
 * Events to the web layer: hostConnect {connId, query, remote, local}, hostMessage {connId, data},
 * hostClosed {connId}. The web layer answers a connect with accept / reject.
 */
@CapacitorPlugin(name = "WatchTogetherHost")
public class WatchTogetherHostPlugin extends Plugin {
    /** Preferred port: friends can also forward it by hand if UPnP is off. */
    private static final int DEFAULT_PORT = 47653;
    private static final int LEASE_SECONDS = 4 * 60 * 60;

    private MiniWsServer server;
    private final UpnpPortMapper mapper = new UpnpPortMapper();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private int mappedExternalPort;

    private final MiniWsServer.Listener listener = new MiniWsServer.Listener() {
        @Override
        public void onConnect(MiniWsServer.Conn conn, String path, String query, String remote) {
            JSObject event = new JSObject();
            event.put("connId", conn.id);
            event.put("query", query);
            event.put("remote", remote);
            event.put("local", isLoopback(remote));
            notifyListeners("hostConnect", event);
        }

        @Override
        public void onMessage(MiniWsServer.Conn conn, String text) {
            JSObject event = new JSObject();
            event.put("connId", conn.id);
            event.put("data", text);
            notifyListeners("hostMessage", event);
        }

        @Override
        public void onClose(MiniWsServer.Conn conn) {
            JSObject event = new JSObject();
            event.put("connId", conn.id);
            notifyListeners("hostClosed", event);
        }
    };

    private static boolean isLoopback(String remote) {
        return "127.0.0.1".equals(remote) || "::1".equals(remote) || "0:0:0:0:0:0:0:1".equals(remote);
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        try {
            if (server == null) server = new MiniWsServer(listener);
            int wanted = call.getInt("port", DEFAULT_PORT);
            int port = server.start(wanted);
            JSObject ret = new JSObject();
            ret.put("port", port);
            JSArray ips = new JSArray();
            for (String ip : lanAddresses()) ips.put(ip);
            ret.put("lanIps", ips);
            List<String> lan = lanAddresses();
            ret.put("lan", lan.isEmpty() ? "" : lan.get(0));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start the room server: " + e.getMessage());
        }
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        stopServer();
        call.resolve();
    }

    @PluginMethod
    public void accept(PluginCall call) {
        MiniWsServer.Conn conn = connection(call);
        if (conn != null) conn.accept();
        call.resolve();
    }

    @PluginMethod
    public void reject(PluginCall call) {
        MiniWsServer.Conn conn = connection(call);
        if (conn != null) conn.reject(call.getInt("status", 403));
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        MiniWsServer.Conn conn = connection(call);
        String data = call.getString("data", "");
        if (conn != null && data != null) conn.send(data);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        MiniWsServer.Conn conn = connection(call);
        if (conn != null) conn.close();
        call.resolve();
    }

    private MiniWsServer.Conn connection(PluginCall call) {
        MiniWsServer current = server;
        return current == null ? null : current.find(call.getString("connId"));
    }

    /** Opens the port on the router (UPnP). Resolves with the result either way. */
    @PluginMethod
    public void mapPort(PluginCall call) {
        final int port = call.getInt("port", server == null ? DEFAULT_PORT : server.port());
        final String lan = call.getString("lan", firstLan());
        worker.execute(() -> {
            WifiManager.MulticastLock lock = null;
            try {
                WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    lock = wifi.createMulticastLock("streampilot-upnp");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
            } catch (SecurityException | IllegalStateException ignored) {
                /* discovery may still work without the lock */
            }
            UpnpPortMapper.Result result;
            try {
                result = mapper.map(lan, port, port, LEASE_SECONDS);
            } finally {
                if (lock != null && lock.isHeld()) lock.release();
            }
            JSObject ret = new JSObject();
            ret.put("ok", result.ok);
            ret.put("externalIp", result.externalIp);
            ret.put("externalPort", result.externalPort);
            ret.put("publicAddress", result.publicAddress);
            ret.put("reason", result.reason);
            if (result.ok) mappedExternalPort = result.externalPort;
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void unmapPort(PluginCall call) {
        final int external = mappedExternalPort;
        mappedExternalPort = 0;
        worker.execute(() -> {
            if (external > 0) mapper.unmap(external);
            call.resolve();
        });
    }

    private synchronized void stopServer() {
        if (server != null) {
            server.stop();
            server = null;
        }
        final int external = mappedExternalPort;
        mappedExternalPort = 0;
        if (external > 0) worker.execute(() -> mapper.unmap(external));
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
        worker.shutdown();
        super.handleOnDestroy();
    }

    private String firstLan() {
        List<String> lan = lanAddresses();
        return lan.isEmpty() ? "" : lan.get(0);
    }

    /** This device's IPv4 addresses on local networks, Wi-Fi / Ethernet first. */
    static List<String> lanAddresses() {
        List<String> preferred = new ArrayList<>();
        List<String> other = new ArrayList<>();
        try {
            for (NetworkInterface nic : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nic.isUp() || nic.isLoopback() || nic.isVirtual()) continue;
                String name = nic.getName() == null ? "" : nic.getName().toLowerCase();
                boolean home = name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("en");
                for (InetAddress address : Collections.list(nic.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || !address.isSiteLocalAddress()) continue;
                    (home ? preferred : other).add(address.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            /* no interfaces */
        }
        preferred.addAll(other);
        return preferred;
    }
}
