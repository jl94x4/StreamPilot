package com.servermanagerportal.mediaplayer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Opens a port on the home router with UPnP (the "Internet Gateway Device" protocol), so friends
 * outside the network can reach a Watch Together room hosted on this device. Best effort: many
 * routers support it, some have it switched off, and connections behind carrier-grade NAT have no
 * router of their own to ask. Every step has a short timeout and failure is just a result, never
 * an exception.
 *
 * No Android dependencies, so it can be run and tested on a desktop JVM.
 */
final class UpnpPortMapper {
    static final class Result {
        boolean ok;
        /** The router's address on the internet, when it said. */
        String externalIp = "";
        int externalPort;
        /** Why it did not work, in words a person can act on. */
        String reason = "";
        /** True when the external address is a real public one (not CGNAT / private). */
        boolean publicAddress;
    }

    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int DISCOVERY_MS = 2500;
    private static final int HTTP_MS = 4000;

    private String controlUrl;
    private String serviceType;
    private String boundLanIp = "";

    /** Maps externalPort -> internalPort on this device. Tries a few other ports if it is taken. */
    synchronized Result map(String lanIp, int internalPort, int preferredExternalPort, int leaseSeconds) {
        Result result = new Result();
        if (lanIp == null || lanIp.isEmpty()) {
            result.reason = "No local network address.";
            return result;
        }
        boundLanIp = lanIp;
        try {
            if (!discover(lanIp)) {
                result.reason = "No router answered. UPnP may be switched off on it, or this device is not on a home network.";
                return result;
            }
            String externalIp = getExternalIp();
            if (externalIp.isEmpty() || "0.0.0.0".equals(externalIp)) {
                result.reason = "The router did not report an internet address.";
                return result;
            }
            result.externalIp = externalIp;
            result.publicAddress = isPublicIpv4(externalIp);
            int port = preferredExternalPort > 0 ? preferredExternalPort : internalPort;
            String lastError = "";
            for (int attempt = 0; attempt < 6; attempt++) {
                int candidate = attempt == 0 ? port : 40000 + (int) (Math.random() * 20000);
                String error = addMapping(lanIp, candidate, internalPort, leaseSeconds);
                if (error.isEmpty()) {
                    result.ok = true;
                    result.externalPort = candidate;
                    break;
                }
                lastError = error;
                if (error.contains("725")) {
                    // Router only takes permanent mappings.
                    error = addMapping(lanIp, candidate, internalPort, 0);
                    if (error.isEmpty()) {
                        result.ok = true;
                        result.externalPort = candidate;
                        break;
                    }
                    lastError = error;
                }
                if (!error.contains("718") && !error.contains("ConflictInMappingEntry")) break;
            }
            if (!result.ok) {
                result.reason = "The router refused to open a port" + (lastError.isEmpty() ? "." : " (" + lastError + ").");
                return result;
            }
            if (!result.publicAddress) {
                result.reason = "The router's address (" + externalIp + ") is not a public one, so it is behind another router "
                    + "or carrier-grade NAT: people outside your network cannot reach it.";
            }
        } catch (IOException | RuntimeException e) {
            result.ok = false;
            result.reason = "Could not talk to the router (" + e.getClass().getSimpleName() + ").";
        }
        return result;
    }

    synchronized void unmap(int externalPort) {
        if (controlUrl == null || externalPort <= 0) return;
        try {
            String args = "<NewRemoteHost></NewRemoteHost><NewExternalPort>" + externalPort
                + "</NewExternalPort><NewProtocol>TCP</NewProtocol>";
            soap("DeletePortMapping", args);
        } catch (IOException | RuntimeException ignored) {
            /* the lease expires on its own */
        }
    }

    /** Finds the router's control address. Read-only. */
    synchronized boolean discover(String lanIp) throws IOException {
        controlUrl = null;
        serviceType = null;
        String[] searchTargets = {
            "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
            "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
            "upnp:rootdevice",
        };
        InetAddress local = InetAddress.getByName(lanIp);
        try (DatagramSocket socket = new DatagramSocket(new InetSocketAddress(local, 0))) {
            socket.setSoTimeout(400);
            InetAddress group = InetAddress.getByName(SSDP_ADDRESS);
            for (String target : searchTargets) {
                String message = "M-SEARCH * HTTP/1.1\r\nHOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n"
                    + "MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: " + target + "\r\n\r\n";
                byte[] data = message.getBytes(StandardCharsets.US_ASCII);
                socket.send(new DatagramPacket(data, data.length, group, SSDP_PORT));
            }
            long until = System.currentTimeMillis() + DISCOVERY_MS;
            byte[] buffer = new byte[4096];
            while (System.currentTimeMillis() < until) {
                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException quiet) {
                    continue;
                }
                String reply = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.US_ASCII);
                String location = header(reply, "location");
                if (location.isEmpty()) continue;
                if (readDescription(location)) return true;
            }
        }
        return false;
    }

    private static String header(String reply, String name) {
        for (String line : reply.split("\r\n")) {
            int colon = line.indexOf(':');
            if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase(name)) {
                return line.substring(colon + 1).trim();
            }
        }
        return "";
    }

    /** Reads the device description and picks the WAN connection service. */
    private boolean readDescription(String location) {
        try {
            String xml = httpGet(location);
            Matcher services = Pattern.compile("<service>(.*?)</service>", Pattern.DOTALL).matcher(xml);
            while (services.find()) {
                String block = services.group(1);
                String type = tag(block, "serviceType");
                if (!type.contains("WANIPConnection") && !type.contains("WANPPPConnection")) continue;
                String control = tag(block, "controlURL");
                if (control.isEmpty()) continue;
                String base = tag(xml, "URLBase");
                controlUrl = resolve(location, base, control);
                serviceType = type;
                return true;
            }
        } catch (IOException | RuntimeException ignored) {
            /* not the router: try the next reply */
        }
        return false;
    }

    private static String resolve(String location, String urlBase, String control) throws IOException {
        if (control.startsWith("http://") || control.startsWith("https://")) return control;
        URL root = new URL(urlBase.isEmpty() ? location : urlBase);
        String origin = root.getProtocol() + "://" + root.getHost() + (root.getPort() > 0 ? ":" + root.getPort() : "");
        return control.startsWith("/") ? origin + control : origin + "/" + control;
    }

    private static String tag(String xml, String name) {
        Matcher m = Pattern.compile("<" + name + ">(.*?)</" + name + ">", Pattern.DOTALL).matcher(xml);
        return m.find() ? m.group(1).trim() : "";
    }

    String getExternalIp() throws IOException {
        String body = soap("GetExternalIPAddress", "");
        return tag(body, "NewExternalIPAddress");
    }

    private String addMapping(String lanIp, int externalPort, int internalPort, int leaseSeconds) throws IOException {
        String args = "<NewRemoteHost></NewRemoteHost>"
            + "<NewExternalPort>" + externalPort + "</NewExternalPort>"
            + "<NewProtocol>TCP</NewProtocol>"
            + "<NewInternalPort>" + internalPort + "</NewInternalPort>"
            + "<NewInternalClient>" + lanIp + "</NewInternalClient>"
            + "<NewEnabled>1</NewEnabled>"
            + "<NewPortMappingDescription>StreamPilot Watch Together</NewPortMappingDescription>"
            + "<NewLeaseDuration>" + leaseSeconds + "</NewLeaseDuration>";
        try {
            soap("AddPortMapping", args);
            return "";
        } catch (SoapFault fault) {
            return fault.code + (fault.description.isEmpty() ? "" : " " + fault.description);
        }
    }

    private static final class SoapFault extends IOException {
        final String code;
        final String description;

        SoapFault(String code, String description) {
            super("UPnP error " + code);
            this.code = code;
            this.description = description;
        }
    }

    private String soap(String action, String args) throws IOException {
        if (controlUrl == null) throw new IOException("no router");
        String envelope = "<?xml version=\"1.0\"?>"
            + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
            + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>"
            + "<u:" + action + " xmlns:u=\"" + serviceType + "\">" + args + "</u:" + action + ">"
            + "</s:Body></s:Envelope>";
        HttpURLConnection connection = (HttpURLConnection) new URL(controlUrl).openConnection();
        connection.setConnectTimeout(HTTP_MS);
        connection.setReadTimeout(HTTP_MS);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"");
        connection.setRequestProperty("SOAPAction", "\"" + serviceType + "#" + action + "\"");
        byte[] data = envelope.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(data.length);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(data);
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = stream == null ? "" : read(stream);
        connection.disconnect();
        if (status >= 400) {
            throw new SoapFault(tag(body, "errorCode"), tag(body, "errorDescription"));
        }
        return body;
    }

    private static String httpGet(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(HTTP_MS);
        connection.setReadTimeout(HTTP_MS);
        try (InputStream stream = connection.getInputStream()) {
            return read(stream);
        } finally {
            connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int n;
        while ((n = stream.read(buffer)) > 0 && out.size() < 256 * 1024) out.write(buffer, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    /** A routable internet address: not private, loopback, link-local or carrier-grade NAT (100.64/10). */
    static boolean isPublicIpv4(String ip) {
        String[] parts = ip == null ? new String[0] : ip.trim().split("\\.");
        if (parts.length != 4) return false;
        int[] v = new int[4];
        try {
            for (int i = 0; i < 4; i++) v[i] = Integer.parseInt(parts[i]);
        } catch (NumberFormatException e) {
            return false;
        }
        for (int part : v) if (part < 0 || part > 255) return false;
        if (v[0] == 0 || v[0] == 10 || v[0] == 127) return false;
        if (v[0] == 100 && v[1] >= 64 && v[1] <= 127) return false;
        if (v[0] == 169 && v[1] == 254) return false;
        if (v[0] == 172 && v[1] >= 16 && v[1] <= 31) return false;
        if (v[0] == 192 && v[1] == 168) return false;
        if (v[0] == 192 && v[1] == 0 && v[2] == 0) return false;
        if (v[0] >= 224) return false;
        return true;
    }

    /** Pretty name for logs. */
    String describe() {
        return String.format(Locale.US, "%s via %s", boundLanIp, controlUrl);
    }
}
