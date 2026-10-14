package cn.huikuanleida.app;

import java.net.URI;
import java.nio.charset.StandardCharsets;

final class FileSavePolicy {
    static boolean allowsOrigin(String url, boolean uiTest) {
        try {
            URI uri = new URI(url);
            if (uri.getRawUserInfo() != null) return false;
            if ("https".equals(uri.getScheme()) && "huikuanleida.cn".equals(uri.getHost()))
                return uri.getPort() == -1 || uri.getPort() == 443;
            return uiTest && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() == 18765;
        } catch (Exception ignored) { return false; }
    }
    static String validate(String name, String content, String mime) {
        if (name == null || name.isBlank() || name.length() > 180 || name.matches(".*[\\\\/\\p{Cntrl}].*"))
            throw new IllegalArgumentException("文件名无效");
        String extension = "application/json".equals(mime) ? ".json" : "text/calendar".equals(mime) ? ".ics" : null;
        if (extension == null || !name.endsWith(extension)) throw new IllegalArgumentException("不支持的文件类型");
        if (content == null || content.getBytes(StandardCharsets.UTF_8).length > 10 * 1024 * 1024)
            throw new IllegalArgumentException("导出文件过大");
        return name;
    }
}
