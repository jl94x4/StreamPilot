package com.servermanagerportal.mediaplayer;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * A small WebSocket (RFC 6455) server for Watch Together rooms hosted on this device.
 *
 * It only speaks the little the room protocol needs: text messages, ping/pong and close. It does
 * no authentication itself. Each connection is handed to the {@link Listener} before it is
 * accepted, and stays pending until the listener calls {@link Conn#accept()} or
 * {@link Conn#reject(int)}, so the app can check the invite first.
 *
 * No Android dependencies, so it can be run and tested on a desktop JVM.
 */
final class MiniWsServer {
    interface Listener {
        /** A client asked to connect. Call conn.accept() or conn.reject(status). */
        void onConnect(Conn conn, String path, String query, String remoteAddress);

        void onMessage(Conn conn, String text);

        /** Called once for every accepted connection, after it closes. */
        void onClose(Conn conn);
    }

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final int MAX_HEADER_BYTES = 8192;
    private static final int MAX_MESSAGE_BYTES = 128 * 1024;
    private static final int MAX_CONNECTIONS = 32;
    private static final int HANDSHAKE_TIMEOUT_MS = 8000;
    private static final int DECISION_TIMEOUT_MS = 8000;
    private static final int PING_EVERY_SECONDS = 25;
    private static final int IDLE_TIMEOUT_MS = 75_000;

    private final Listener listener;
    private final Map<String, Conn> conns = new ConcurrentHashMap<>();
    /** Connections waiting for the app to accept or reject them. */
    private final Map<String, Conn> pendingConns = new ConcurrentHashMap<>();
    private volatile ServerSocket serverSocket;
    private volatile boolean running;
    private ExecutorService pool;
    private ScheduledExecutorService pinger;

    MiniWsServer(Listener listener) {
        this.listener = listener;
    }

    /** Starts on the wanted port, or any free one if it is taken. Returns the port in use. */
    synchronized int start(int wantedPort) throws IOException {
        if (running) return serverSocket.getLocalPort();
        ServerSocket socket = new ServerSocket();
        socket.setReuseAddress(true);
        try {
            socket.bind(new InetSocketAddress(wantedPort));
        } catch (IOException taken) {
            socket.close();
            socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(0));
        }
        serverSocket = socket;
        running = true;
        pool = Executors.newCachedThreadPool();
        pinger = Executors.newSingleThreadScheduledExecutor();
        pinger.scheduleWithFixedDelay(this::pingAll, PING_EVERY_SECONDS, PING_EVERY_SECONDS, TimeUnit.SECONDS);
        final ServerSocket accepting = socket;
        Thread acceptThread = new Thread(() -> acceptLoop(accepting), "wt-host-accept");
        acceptThread.setDaemon(true);
        acceptThread.start();
        return socket.getLocalPort();
    }

    synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
            /* closing */
        }
        serverSocket = null;
        for (Conn conn : conns.values()) conn.close();
        conns.clear();
        if (pinger != null) pinger.shutdownNow();
        if (pool != null) pool.shutdownNow();
        pinger = null;
        pool = null;
    }

    boolean isRunning() {
        return running;
    }

    int port() {
        ServerSocket socket = serverSocket;
        return socket == null ? 0 : socket.getLocalPort();
    }

    /** An open connection, or one still waiting to be accepted. */
    Conn find(String id) {
        if (id == null) return null;
        Conn open = conns.get(id);
        return open != null ? open : pendingConns.get(id);
    }

    private void acceptLoop(ServerSocket socket) {
        while (running) {
            try {
                Socket client = socket.accept();
                if (conns.size() >= MAX_CONNECTIONS) {
                    try {
                        client.close();
                    } catch (IOException ignored) {
                        /* refused */
                    }
                    continue;
                }
                ExecutorService executor = pool;
                if (executor == null) {
                    client.close();
                    return;
                }
                executor.execute(() -> serve(client));
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void pingAll() {
        for (Conn conn : conns.values()) conn.sendFrame(0x9, new byte[0]);
    }

    private void serve(Socket socket) {
        Conn conn = new Conn(socket);
        try {
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(HANDSHAKE_TIMEOUT_MS);
            if (!handshake(conn)) return;
            socket.setSoTimeout(IDLE_TIMEOUT_MS);
            conns.put(conn.id, conn);
            frameLoop(conn);
        } catch (IOException ignored) {
            /* connection dropped */
        } finally {
            boolean wasOpen = conns.remove(conn.id) != null;
            conn.closeSocket();
            if (wasOpen) {
                try {
                    listener.onClose(conn);
                } catch (RuntimeException ignored) {
                    /* listener failure must not leak */
                }
            }
        }
    }

    /** Reads the upgrade request, asks the listener, and answers. True when upgraded. */
    private boolean handshake(Conn conn) throws IOException {
        InputStream in = conn.socket.getInputStream();
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        while (true) {
            int b = in.read();
            if (b < 0) return false;
            head.write(b);
            if (head.size() > MAX_HEADER_BYTES) {
                conn.writeRaw("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n");
                return false;
            }
            int n = head.size();
            if (n >= 4) {
                byte[] bytes = head.toByteArray();
                if (bytes[n - 4] == '\r' && bytes[n - 3] == '\n' && bytes[n - 2] == '\r' && bytes[n - 1] == '\n') break;
            }
        }
        String request = new String(head.toByteArray(), StandardCharsets.ISO_8859_1);
        String[] lines = request.split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 3 || !"GET".equals(first[0])) {
            conn.writeRaw("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
            return false;
        }
        String target = first[1];
        String path = target;
        String query = "";
        int q = target.indexOf('?');
        if (q >= 0) {
            path = target.substring(0, q);
            query = target.substring(q + 1);
        }
        String upgrade = null;
        String key = null;
        String version = null;
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon < 0) continue;
            String name = lines[i].substring(0, colon).trim().toLowerCase(Locale.US);
            String value = lines[i].substring(colon + 1).trim();
            if ("upgrade".equals(name)) upgrade = value;
            else if ("sec-websocket-key".equals(name)) key = value;
            else if ("sec-websocket-version".equals(name)) version = value;
        }
        if (upgrade == null || !upgrade.toLowerCase(Locale.US).contains("websocket") || key == null) {
            conn.writeRaw("HTTP/1.1 426 Upgrade Required\r\nUpgrade: websocket\r\nConnection: close\r\n\r\n");
            return false;
        }
        if (!"13".equals(version)) {
            conn.writeRaw("HTTP/1.1 400 Bad Request\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n");
            return false;
        }
        if (!"/wt".equals(path) && !"/wt/".equals(path)) {
            conn.writeRaw("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            return false;
        }
        conn.key = key;
        String remote = conn.socket.getInetAddress() == null ? "" : conn.socket.getInetAddress().getHostAddress();
        conn.remoteAddress = remote;
        pendingConns.put(conn.id, conn);
        try {
            listener.onConnect(conn, path, query, remote);
            if (!conn.decision.await(DECISION_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                conn.writeRaw("HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n");
                return false;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            pendingConns.remove(conn.id);
        }
        if (!conn.accepted) {
            int status = conn.rejectStatus;
            conn.writeRaw("HTTP/1.1 " + status + " " + statusText(status) + "\r\nConnection: close\r\n\r\n");
            return false;
        }
        String accept;
        try {
            MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
            accept = Base64.getEncoder().encodeToString(sha1.digest((key + GUID).getBytes(StandardCharsets.ISO_8859_1)));
        } catch (java.security.NoSuchAlgorithmException e) {
            return false;
        }
        conn.writeRaw("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n");
        conn.open = true;
        conn.upgraded.countDown();
        return true;
    }

    private static String statusText(int status) {
        switch (status) {
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 429: return "Too Many Requests";
            default: return "Forbidden";
        }
    }

    private void frameLoop(Conn conn) throws IOException {
        InputStream in = conn.socket.getInputStream();
        ByteArrayOutputStream message = new ByteArrayOutputStream();
        boolean inText = false;
        while (running && conn.open) {
            int b0;
            try {
                b0 = in.read();
            } catch (SocketTimeoutException idle) {
                // Nothing at all (not even a pong) for the idle window: the peer is gone.
                return;
            }
            if (b0 < 0) return;
            int b1 = readByte(in);
            boolean fin = (b0 & 0x80) != 0;
            int opcode = b0 & 0x0f;
            boolean masked = (b1 & 0x80) != 0;
            long length = b1 & 0x7f;
            if (length == 126) {
                length = (readByte(in) << 8) | readByte(in);
            } else if (length == 127) {
                length = 0;
                for (int i = 0; i < 8; i++) length = (length << 8) | readByte(in);
            }
            if (!masked) {
                // Clients must mask every frame (RFC 6455 5.1).
                conn.sendClose(1002);
                return;
            }
            if (length < 0 || length > MAX_MESSAGE_BYTES) {
                conn.sendClose(1009);
                return;
            }
            byte[] mask = new byte[4];
            readFully(in, mask);
            byte[] payload = new byte[(int) length];
            readFully(in, payload);
            for (int i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

            if (opcode == 0x8) {
                conn.sendClose(1000);
                return;
            }
            if (opcode == 0x9) {
                conn.sendFrame(0xA, payload);
                continue;
            }
            if (opcode == 0xA) continue;
            if (opcode == 0x1 || opcode == 0x0) {
                if (opcode == 0x1) {
                    message.reset();
                    inText = true;
                } else if (!inText) {
                    conn.sendClose(1002);
                    return;
                }
                message.write(payload);
                if (message.size() > MAX_MESSAGE_BYTES) {
                    conn.sendClose(1009);
                    return;
                }
                if (fin) {
                    inText = false;
                    String text = new String(message.toByteArray(), StandardCharsets.UTF_8);
                    message.reset();
                    try {
                        listener.onMessage(conn, text);
                    } catch (RuntimeException ignored) {
                        /* a bad message must not drop the connection */
                    }
                }
                continue;
            }
            // Binary and anything else: not part of the protocol.
            conn.sendClose(1003);
            return;
        }
    }

    private static int readByte(InputStream in) throws IOException {
        int b = in.read();
        if (b < 0) throw new EOFException();
        return b;
    }

    private static void readFully(InputStream in, byte[] target) throws IOException {
        int read = 0;
        while (read < target.length) {
            int n = in.read(target, read, target.length - read);
            if (n < 0) throw new EOFException();
            read += n;
        }
    }

    /** One connection. */
    final class Conn {
        final String id = UUID.randomUUID().toString();
        final Socket socket;
        String remoteAddress = "";
        String key;
        final CountDownLatch decision = new CountDownLatch(1);
        /** Counted down once the 101 response is written: frames must not overtake it. */
        final CountDownLatch upgraded = new CountDownLatch(1);
        volatile boolean accepted;
        volatile int rejectStatus = 403;
        volatile boolean open;
        private final Object writeLock = new Object();

        Conn(Socket socket) {
            this.socket = socket;
        }

        void accept() {
            accepted = true;
            decision.countDown();
        }

        void reject(int status) {
            rejectStatus = status;
            accepted = false;
            decision.countDown();
        }

        void send(String text) {
            sendFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
        }

        void close() {
            if (open) sendClose(1000);
            else reject(403);
            closeSocket();
        }

        void sendClose(int code) {
            sendFrame(0x8, new byte[] {(byte) (code >> 8), (byte) code});
            open = false;
        }

        void sendFrame(int opcode, byte[] payload) {
            if (!open && opcode != 0x8) {
                // Accepted but the upgrade response is still going out (the app replies the instant it
                // accepts): wait for it rather than drop the first message.
                if (accepted) {
                    try {
                        upgraded.await(2000, TimeUnit.MILLISECONDS);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
                if (!open) return;
            }
            synchronized (writeLock) {
                try {
                    OutputStream out = socket.getOutputStream();
                    ByteArrayOutputStream frame = new ByteArrayOutputStream(payload.length + 10);
                    frame.write(0x80 | opcode);
                    if (payload.length < 126) {
                        frame.write(payload.length);
                    } else if (payload.length < 65536) {
                        frame.write(126);
                        frame.write(payload.length >> 8);
                        frame.write(payload.length);
                    } else {
                        frame.write(127);
                        for (int shift = 56; shift >= 0; shift -= 8) frame.write((int) ((long) payload.length >> shift));
                    }
                    frame.write(payload);
                    out.write(frame.toByteArray());
                    out.flush();
                } catch (IOException e) {
                    closeSocket();
                }
            }
        }

        void writeRaw(String text) throws IOException {
            synchronized (writeLock) {
                OutputStream out = socket.getOutputStream();
                out.write(text.getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
            }
        }

        void closeSocket() {
            open = false;
            try {
                socket.close();
            } catch (IOException ignored) {
                /* already closed */
            }
        }
    }
}
